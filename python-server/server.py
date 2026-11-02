#!/usr/bin/env python3
# 码桥 QR Bridge 2.1.0 - Python 兼容启动器
# 仅使用 Python 标准库；文件传输逻辑全部在浏览器本地完成。
import argparse
import base64
import json
import mimetypes
import os
import signal
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from urllib.parse import unquote, urlsplit

try:
    from http.server import ThreadingHTTPServer
except ImportError:
    class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
        daemon_threads = True

VERSION = "2.1.0"
ROOT = os.path.dirname(os.path.abspath(__file__))
WEB_ROOT = os.path.join(ROOT, "web")
if not os.path.isdir(WEB_ROOT):
    # Source checkout: reuse the shared web app instead of a duplicated copy.
    alternative = os.path.abspath(os.path.join(ROOT, "..", "app", "web"))
    if os.path.isdir(alternative):
        WEB_ROOT = alternative
MAX_FILE_BYTES = 512 * 1024 * 1024
HEARTBEAT_TIMEOUT = 10 * 60


def default_log_path():
    if sys.platform.startswith("win"):
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        return os.path.join(base, "QRBridge", "qrbridge.log")
    base = os.environ.get("XDG_CACHE_HOME") or os.path.join(os.path.expanduser("~"), ".cache")
    return os.path.join(base, "qrbridge", "qrbridge.log")


class Logger:
    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            self.file = open(path, "a", encoding="utf-8")
        except Exception:
            self.file = None

    def write(self, message):
        line = time.strftime("%Y-%m-%d %H:%M:%S") + " " + message
        with self.lock:
            try:
                print(line, file=sys.stderr, flush=True)
            except Exception:
                pass
            if self.file:
                try:
                    self.file.write(line + "\n")
                    self.file.flush()
                except Exception:
                    pass

    def close(self):
        if self.file:
            try:
                self.file.close()
            except Exception:
                pass


class App:
    def __init__(self, server, token, logger):
        self.server = server
        self.token = token
        self.logger = logger
        self.base_path = "/s/" + token + "/"
        self.started = time.time()
        self.last_seen = 0.0
        self.closing = threading.Event()

    def url(self):
        host, port = self.server.server_address[:2]
        return "http://127.0.0.1:%d%s" % (port, self.base_path)

    def stop(self):
        if self.closing.is_set():
            return
        self.closing.set()
        threading.Thread(target=self.server.shutdown, daemon=True).start()


def security_headers(handler, content_type, length):
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(length))
    handler.send_header("Cache-Control", "no-store, max-age=0")
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.send_header("X-Frame-Options", "DENY")
    handler.send_header("Referrer-Policy", "no-referrer")
    handler.send_header("Permissions-Policy", "camera=(self), microphone=(), geolocation=()")
    handler.send_header("Cross-Origin-Opener-Policy", "same-origin")
    handler.send_header("Cross-Origin-Resource-Policy", "same-origin")
    handler.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; connect-src 'self' data:; worker-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
    handler.send_header("Connection", "close")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "QRBridge/" + VERSION
    sys_version = ""

    def log_message(self, fmt, *args):
        self.server.app.logger.write("HTTP " + (fmt % args))

    def log_error(self, fmt, *args):
        self.server.app.logger.write("HTTP error " + (fmt % args))

    def send_json(self, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        security_headers(self, "application/json; charset=utf-8", len(data))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def not_found(self):
        data = b"404 not found\n"
        self.send_response(404)
        security_headers(self, "text/plain; charset=utf-8", len(data))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def bad_method(self):
        data = b"method not allowed\n"
        self.send_response(405)
        self.send_header("Allow", "GET, HEAD, POST")
        security_headers(self, "text/plain; charset=utf-8", len(data))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def relative_path(self, raw_path):
        app = self.server.app
        path = unquote(urlsplit(raw_path).path)
        if path == app.base_path[:-1]:
            return None, True
        if not path.startswith(app.base_path):
            return None, False
        rel = path[len(app.base_path):] or "index.html"
        return rel, False

    def do_HEAD(self):
        self.handle_get(head=True)

    def do_GET(self):
        self.handle_get(head=False)

    def handle_get(self, head=False):
        app = self.server.app
        path = unquote(urlsplit(self.path).path)
        if path in ("/", ""):
            self.send_response(302)
            self.send_header("Location", app.base_path)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        rel, needs_redirect = self.relative_path(self.path)
        if needs_redirect:
            self.send_response(302)
            self.send_header("Location", app.base_path)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if rel is None:
            self.not_found()
            return
        if rel == "api/info":
            self.send_json({
                "name": "码桥 QR Bridge",
                "version": VERSION,
                "pythonVersion": sys.version.split()[0],
                "maxFileBytes": MAX_FILE_BYTES,
                "offline": True,
            })
            return
        if rel == "api/ping":
            self.send_json({"ok": True})
            return
        if rel.startswith("api/"):
            self.not_found()
            return
        self.serve_file(rel, head)

    def do_POST(self):
        app = self.server.app
        rel, _ = self.relative_path(self.path)
        if rel == "api/ping":
            app.last_seen = time.time()
            self.send_json({"ok": True})
            return
        if rel == "api/quit":
            if self.headers.get("X-QR-Bridge") != "quit":
                data = b"bad request\n"
                self.send_response(400)
                security_headers(self, "text/plain; charset=utf-8", len(data))
                self.end_headers()
                self.wfile.write(data)
                return
            self.send_json({"ok": True})
            threading.Timer(0.2, app.stop).start()
            return
        self.not_found()

    def serve_file(self, rel, head):
        app = self.server.app
        if "\x00" in rel:
            self.not_found()
            return
        parts = rel.replace("\\", "/").split("/")
        if ".." in parts or rel.startswith("/"):
            self.not_found()
            return
        full = os.path.realpath(os.path.join(WEB_ROOT, rel))
        if full != WEB_ROOT and not full.startswith(WEB_ROOT + os.sep):
            self.not_found()
            return
        if not os.path.isfile(full):
            self.not_found()
            return
        try:
            with open(full, "rb") as handle:
                data = handle.read()
        except Exception:
            self.not_found()
            return
        ext = os.path.splitext(full)[1].lower()
        content_type = {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".svg": "image/svg+xml",
            ".json": "application/json; charset=utf-8",
            ".png": "image/png",
            ".wasm": "application/wasm",
        }.get(ext) or mimetypes.guess_type(full)[0] or "application/octet-stream"
        self.send_response(200)
        security_headers(self, content_type, len(data))
        self.end_headers()
        if not head:
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass


def random_token():
    raw = os.urandom(18)
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def watchdog(app):
    while not app.closing.is_set():
        time.sleep(30)
        if app.last_seen and (time.time() - app.last_seen) > HEARTBEAT_TIMEOUT:
            app.logger.write("页面超过 10 分钟没有心跳，自动退出")
            app.stop()
            return


def open_browser(url, logger):
    try:
        if webbrowser.open(url):
            return
    except Exception:
        pass
    logger.write("无法自动打开浏览器，请手动访问: " + url)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--print-url", action="store_true")
    parser.add_argument("--log", default="")
    parser.add_argument("--version", action="store_true")
    args = parser.parse_args()
    if args.version:
        print("码桥 QR Bridge %s (Python %s)" % (VERSION, sys.version.split()[0]))
        return
    logger = Logger(args.log or default_log_path())
    token = random_token()
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    except Exception as exc:
        logger.write("无法监听本地端口: %s" % exc)
        return 1
    app = App(server, token, logger)
    server.app = app
    url = app.url()
    logger.write("码桥 QR Bridge %s 已启动" % VERSION)
    logger.write("访问地址: " + url)
    logger.write("监听: 127.0.0.1:%d（仅本机）" % server.server_address[1])
    if args.print_url:
        print(url, flush=True)
    threading.Thread(target=watchdog, args=(app,), daemon=True).start()
    if not args.no_browser:
        threading.Timer(0.3, lambda: open_browser(url, logger)).start()

    def on_signal(signum, frame):
        app.stop()

    try:
        signal.signal(signal.SIGINT, on_signal)
        signal.signal(signal.SIGTERM, on_signal)
    except Exception:
        pass
    try:
        server.serve_forever(poll_interval=0.3)
    except KeyboardInterrupt:
        pass
    finally:
        try:
            server.server_close()
        except Exception:
            pass
        logger.write("码桥已退出")
        logger.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
