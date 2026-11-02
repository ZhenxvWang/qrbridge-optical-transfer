// Android receiver: standard QR 4-way end-to-end test.
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9227;
const URL = process.argv[2];
const PROFILE = path.resolve('.run/chrome-android-qr-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function getJSON(url) { return new Promise((res, rej) => { http.get(url, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej); }); }
async function target() { for (let i = 0; i < 100; i++) { try { const ts = await getJSON(`http://127.0.0.1:${PORT}/json`); const p = ts.find((t) => t.type === 'page' && t.url.indexOf('127.0.0.1') >= 0); if (p) return p; } catch (e) {} await sleep(150); } throw new Error('no target'); }
function connect(url) { return new Promise((resolve, reject) => { const ws = new WebSocket(url); const pending = new Map(); const events = []; let id = 0; ws.addEventListener('open', () => resolve({ events, send(method, params) { return new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); }); }, close() { ws.close(); } })); ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const x = pending.get(m.id); pending.delete(m.id); m.error ? x.rej(new Error(JSON.stringify(m.error))) : x.res(m.result); } else if (m.method) events.push(m); }); ws.addEventListener('error', reject); }); }
async function evaluate(cdp, expression) { const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ': ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '')); return r.result.value; }
(async () => {
  fs.mkdirSync(PROFILE, { recursive: true });
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--window-size=420,900', URL], { stdio: 'ignore' });
  let cdp;
  try {
    const t = await target(); cdp = await connect(t.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await sleep(1000);
    const result = await evaluate(cdp, `(async function () {
      await new Promise((resolve, reject) => {
        var s = document.createElement('script'); s.src = 'vendor/qrcode.js';
        s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
      });
      const original = new TextEncoder().encode(JSON.stringify(Array.from({ length: 1000 }, (_, i) => ({ id: i, name: '标准二维码接收测试 ' + i, value: 'QFT2 / gzip / 4-way' }))));
      const compressed = await new Promise((resolve, reject) => fflate.gzip(original, { level: 6 }, (e, o) => e ? reject(e) : resolve(o)));
      const payload = compressed.length < original.length ? compressed : original;
      const flags = compressed.length < original.length ? 1 : 0;
      const hash = await QRBCore.sha256Hex(original);
      const chunk = 220;
      const total = QRBCore.totalChunks(payload.length, chunk);
      const chunks = QRBCore.buildChunks(payload, chunk);
      const tid = QRBCore.randomTransferId();
      const meta = QRBCore.makeMetaFrame({ transferId: tid, total, chunkSize: chunk, fileName: 'android-qr-test.json', fileSize: original.length, payloadSize: payload.length, sha256: hash, flags, channels: 4 });
      const frames = [meta];
      for (let i = 0; i < total; i++) frames.push(QRBCore.makeDataFrame({ transferId: tid, total, chunkSize: chunk, index: i, channels: 4, payload: chunks[i] }));
      function drawQR(ctx, text, left, top, box) {
        const qr = window.qrcode(0, 'L'); qr.addData(text, 'Alphanumeric'); qr.make();
        const n = qr.getModuleCount(); const cell = box / n;
        ctx.fillStyle = '#fff'; ctx.fillRect(left, top, box, box);
        ctx.fillStyle = '#000';
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(left + c * cell, top + r * cell, Math.ceil(cell), Math.ceil(cell));
      }
      const screen = document.createElement('canvas'); screen.width = 1280; screen.height = 720;
      const sctx = screen.getContext('2d');
      const grid = document.createElement('canvas'); grid.width = 1280; grid.height = 720;
      const gctx = grid.getContext('2d');
      const fake = document.createElement('canvas'); fake.width = 1280; fake.height = 720;
      const fctx = fake.getContext('2d');
      const stream = fake.captureStream(8);
      navigator.mediaDevices.getUserMedia = async function () { return stream; };
      document.getElementById('cameraBtn').click();
      await new Promise((r) => setTimeout(r, 1200));
      let cursor = 0;
      const timer = setInterval(function () {
        gctx.fillStyle = '#fff'; gctx.fillRect(0, 0, 1280, 720);
        for (let q = 0; q < 4; q++) {
          const text = frames[cursor % frames.length]; cursor++;
          const left = (q % 2) * 640 + 150, top = Math.floor(q / 2) * 360 + 10;
          drawQR(gctx, text, left, top, 340);
        }
        fctx.fillStyle = '#f4f4f4'; fctx.fillRect(0, 0, 1280, 720);
        fctx.drawImage(grid, 0, 0);
      }, 500);
      await new Promise((r) => setTimeout(r, 10000));
      clearInterval(timer);
      return {
        state: __ANDROID_RECEIVER.qr.completed,
        have: __ANDROID_RECEIVER.qr.chunks.size,
        keys: Array.from(__ANDROID_RECEIVER.qr.chunks.keys()),
        total: __ANDROID_RECEIVER.qr.total,
        scans: __ANDROID_RECEIVER.qr.scans,
        codes: __ANDROID_RECEIVER.qr.codes,
        lastMs: __ANDROID_RECEIVER.qr.lastMs,
        percent: document.getElementById('percent').textContent,
        log: document.getElementById('log').textContent,
        mode: document.getElementById('modeHint').textContent
      };
    }())`);
    const errors = cdp.events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails.text);
    console.log(JSON.stringify({ result, errors }, null, 2));
  } finally {
    try { if (cdp) cdp.close(); } catch (e) {}
    chrome.kill();
  }
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
