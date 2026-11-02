// 码桥 QR Bridge
// 一个零外部依赖的本地离线二维码文件传输工具。
package main

import (
	"context"
	"crypto/rand"
	"embed"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

//go:embed web
var embeddedWeb embed.FS

var (
	version   = "2.1.0"
	buildTime = "unknown"
)

const (
	maxFileBytes     = 8 * 1024 * 1024
	heartbeatTimeout = 10 * time.Minute
)

type app struct {
	token     string
	version   string
	lastSeen  atomic.Int64
	shutdown  chan struct{}
	closeOnce sync.Once
	startedAt time.Time
}

func main() {
	var (
		port      = flag.Int("port", 0, "本地监听端口，0 表示自动选择")
		noBrowser = flag.Bool("no-browser", false, "不自动打开浏览器")
		logPath   = flag.String("log", "", "日志文件路径")
		showVer   = flag.Bool("version", false, "显示版本号")
		showURL   = flag.Bool("print-url", false, "把访问地址输出到标准输出")
	)
	flag.Parse()

	if *showVer {
		fmt.Printf("码桥 QR Bridge %s (%s, %s)\n", version, buildTime, runtime.Version())
		return
	}

	logFile := setupLogging(*logPath)
	if logFile != nil {
		defer logFile.Close()
	}

	webRoot, err := fs.Sub(embeddedWeb, "web")
	if err != nil {
		log.Fatalf("加载内置页面失败: %v", err)
	}

	application := &app{
		token:     randomToken(18),
		version:   version,
		shutdown:  make(chan struct{}),
		startedAt: time.Now(),
	}

	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		log.Fatalf("无法监听本地端口: %v", err)
	}
	actualPort := listener.Addr().(*net.TCPAddr).Port
	basePath := "/s/" + application.token + "/"
	url := fmt.Sprintf("http://127.0.0.1:%d%s", actualPort, basePath)

	handler := application.routes(webRoot, basePath)
	server := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 8 * time.Second,
		IdleTimeout:       90 * time.Second,
	}

	log.Printf("码桥 QR Bridge %s 已启动", version)
	log.Printf("访问地址: %s", url)
	log.Printf("监听: 127.0.0.1:%d（仅本机，不对外开放）", actualPort)
	if *showURL {
		fmt.Println(url)
	}

	go func() {
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Printf("HTTP 服务异常退出: %v", err)
			application.triggerShutdown()
		}
	}()

	if !*noBrowser {
		go func() {
			time.Sleep(250 * time.Millisecond)
			if err := openBrowser(url); err != nil {
				log.Printf("自动打开浏览器失败: %v", err)
				notifyUser("码桥已启动", "请手动打开浏览器访问：\n"+url)
			}
		}()
	}

	go application.watchdog()

	signalCh := make(chan os.Signal, 1)
	signal.Notify(signalCh, os.Interrupt, syscall.SIGTERM)
	select {
	case <-signalCh:
		log.Printf("收到退出信号")
	case <-application.shutdown:
		log.Printf("收到退出请求")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Printf("关闭 HTTP 服务: %v", err)
	}
	log.Printf("码桥已退出")
}

func (a *app) routes(webRoot fs.FS, basePath string) http.Handler {
	inner := http.NewServeMux()
	inner.HandleFunc("/api/ping", a.handlePing)
	inner.HandleFunc("/api/info", a.handleInfo)
	inner.HandleFunc("/api/quit", a.handleQuit)
	inner.Handle("/", staticHandler(webRoot))

	secured := securityHeaders(inner)
	root := http.NewServeMux()
	root.Handle(basePath, http.StripPrefix(strings.TrimSuffix(basePath, "/"), secured))
	root.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			http.Redirect(w, r, basePath, http.StatusFound)
			return
		}
		http.NotFound(w, r)
	})
	return root
}

func (a *app) handlePing(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	a.lastSeen.Store(time.Now().UnixNano())
	writeJSON(w, map[string]any{"ok": true})
}

func (a *app) handleInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, map[string]any{
		"name":         "码桥 QR Bridge",
		"version":      a.version,
		"goVersion":    runtime.Version(),
		"maxFileBytes": maxFileBytes,
		"offline":      true,
	})
}

func (a *app) handleQuit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if r.Header.Get("X-QR-Bridge") != "quit" {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	writeJSON(w, map[string]any{"ok": true})
	go func() {
		time.Sleep(180 * time.Millisecond)
		a.triggerShutdown()
	}()
}

func (a *app) triggerShutdown() {
	a.closeOnce.Do(func() {
		close(a.shutdown)
	})
}

func (a *app) watchdog() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-a.shutdown:
			return
		case <-ticker.C:
			seen := a.lastSeen.Load()
			if seen == 0 {
				continue
			}
			if time.Since(time.Unix(0, seen)) > heartbeatTimeout {
				log.Printf("页面已 %s 没有心跳，自动退出", heartbeatTimeout)
				a.triggerShutdown()
				return
			}
		}
	}
}

func staticHandler(webRoot fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(webRoot))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		cleanPath := path.Clean("/" + r.URL.Path)
		relative := strings.TrimPrefix(cleanPath, "/")
		if relative == "" {
			relative = "index.html"
		}
		if strings.HasSuffix(r.URL.Path, "/") && relative != "index.html" {
			http.NotFound(w, r)
			return
		}
		opened, err := webRoot.Open(relative)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		info, statErr := opened.Stat()
		opened.Close()
		if statErr != nil || info.IsDir() {
			http.NotFound(w, r)
			return
		}
		if strings.HasSuffix(relative, ".wasm") {
			w.Header().Set("Content-Type", "application/wasm")
		}
		fileServer.ServeHTTP(w, r)
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := w.Header()
		header.Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; connect-src 'self' data:; worker-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
		header.Set("X-Content-Type-Options", "nosniff")
		header.Set("X-Frame-Options", "DENY")
		header.Set("Referrer-Policy", "no-referrer")
		header.Set("Permissions-Policy", "camera=(self), microphone=(), geolocation=()")
		header.Set("Cross-Origin-Opener-Policy", "same-origin")
		header.Set("Cross-Origin-Resource-Policy", "same-origin")
		header.Set("Cache-Control", "no-store, max-age=0")
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(value)
}

func randomToken(length int) string {
	buffer := make([]byte, length)
	if _, err := rand.Read(buffer); err != nil {
		// crypto/rand 在受支持系统上不会失败；保留兜底以防极端环境。
		fallback := fmt.Sprintf("%d-%d", time.Now().UnixNano(), os.Getpid())
		return base64.RawURLEncoding.EncodeToString([]byte(fallback))
	}
	return base64.RawURLEncoding.EncodeToString(buffer)
}

func setupLogging(customPath string) *os.File {
	logPath := customPath
	if logPath == "" {
		logPath = defaultLogPath()
	}
	if logPath == "" {
		log.SetOutput(os.Stderr)
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(logPath), 0o700); err != nil {
		log.SetOutput(os.Stderr)
		log.Printf("创建日志目录失败: %v", err)
		return nil
	}
	if info, err := os.Stat(logPath); err == nil && info.Size() > 2*1024*1024 {
		_ = os.Rename(logPath, logPath+".old")
	}
	file, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		log.SetOutput(os.Stderr)
		log.Printf("打开日志文件失败: %v", err)
		return nil
	}
	log.SetOutput(io.MultiWriter(file, os.Stderr))
	log.SetFlags(log.LstdFlags)
	log.Printf("日志文件: %s", logPath)
	return file
}

func defaultLogPath() string {
	if runtime.GOOS == "windows" {
		if dir := os.Getenv("LOCALAPPDATA"); dir != "" {
			return filepath.Join(dir, "QRBridge", "qrbridge.log")
		}
	}
	if dir := os.Getenv("XDG_CACHE_HOME"); dir != "" {
		return filepath.Join(dir, "qrbridge", "qrbridge.log")
	}
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(home, ".cache", "qrbridge", "qrbridge.log")
	}
	return ""
}

func openBrowser(url string) error {
	var candidates [][]string
	switch runtime.GOOS {
	case "windows":
		candidates = [][]string{
			{"rundll32", "url.dll,FileProtocolHandler", url},
		}
	case "darwin":
		candidates = [][]string{{"open", url}}
	default:
		candidates = [][]string{
			{"xdg-open", url},
			{"gio", "open", url},
			{"sensible-browser", url},
			{"x-www-browser", url},
		}
	}

	var lastErr error
	for _, candidate := range candidates {
		if _, err := exec.LookPath(candidate[0]); err != nil {
			lastErr = err
			continue
		}
		command := exec.Command(candidate[0], candidate[1:]...)
		command.Stdout = nil
		command.Stderr = nil
		if err := command.Start(); err != nil {
			lastErr = err
			continue
		}
		go func(cmd *exec.Cmd) {
			_ = cmd.Wait()
		}(command)
		return nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("没有找到可用的浏览器启动命令")
	}
	return lastErr
}

func notifyUser(title, message string) {
	if runtime.GOOS != "linux" {
		return
	}
	if _, err := exec.LookPath("notify-send"); err != nil {
		return
	}
	_ = exec.Command("notify-send", "-a", "码桥", title, message).Start()
}
