// Android receiver page end-to-end test (desktop Chrome, fake camera).
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9226;
const URL = process.argv[2];
const PROFILE = path.resolve('.run/chrome-android-' + Date.now());
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
    const initial = await evaluate(cdp, `({ title: document.title, hasCIM: !!window.CIM, hasFflate: !!(window.fflate && window.fflate.gzip), platform: document.getElementById('platform').textContent, width: innerWidth, scroll: document.documentElement.scrollWidth })`);
    const codec = await evaluate(cdp, `(async function () {
      const mod = await import('/vendor/zstd/index.web.js');
      await mod.init();
      const dict = new Uint8Array(await (await fetch('/vendor/zstd/dict.bin')).arrayBuffer());
      const input = new TextEncoder().encode(JSON.stringify({ name: 'android-zstd', note: 'UOS 离线传输', values: Array.from({ length: 500 }, (_, i) => i) }));
      const cctx = mod.createCCtx();
      const compressed = mod.compressUsingDict(cctx, input, dict, 3);
      mod.freeCCtx(cctx);
      const restored = await __ANDROID_RECEIVER.decompressPayload(compressed, { flags: 5, size: input.length });
      let same = restored.length === input.length;
      for (let i = 0; same && i < input.length; i++) if (restored[i] !== input[i]) same = false;
      return { method: 'zstd', input: input.length, compressed: compressed.length, same: same };
    }())`);
    const result = await evaluate(cdp, `(async function () {
      const text = JSON.stringify(Array.from({ length: 1200 }, (_, i) => ({ id: i, note: 'Android 接收端测试 ' + i, value: 'CBOR / gzip / SHA-256' })));
      const original = new TextEncoder().encode(text);
      const compressed = await new Promise((resolve, reject) => fflate.gzip(original, { level: 6 }, (err, out) => err ? reject(err) : resolve(out)));
      const payload = compressed.length < original.length ? compressed : original;
      const flags = compressed.length < original.length ? 1 : 0;
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', original));
      const chunk = CIM.BODY_MAX;
      const total = Math.max(1, Math.ceil(payload.length / chunk));
      const tid = 0xa1b2c3d4;
      const meta = { name: 'android-e2e.json', size: original.length, payloadSize: payload.length, sha256: hash, flags, total, chunkSize: chunk, salt: new Uint8Array(0), iv: new Uint8Array(0) };
      const sequence = [CIM.buildMessage(1, tid, total, 0, CIM.buildMetaBody(meta), flags)];
      for (let i = 0; i < total; i++) sequence.push(CIM.buildMessage(2, tid, total, i, payload.subarray(i * chunk, Math.min((i + 1) * chunk, payload.length)), flags));
      const grid = document.createElement('canvas');
      const fake = document.createElement('canvas'); fake.width = 1280; fake.height = 720;
      const fctx = fake.getContext('2d');
      const stream = fake.captureStream(8);
      navigator.mediaDevices.getUserMedia = async function () { return stream; };
      document.getElementById('cameraBtn').click();
      await new Promise((r) => setTimeout(r, 1200));
      let idx = 0;
      const timer = setInterval(function () {
        CIM.render(grid, sequence[idx % sequence.length]); idx++;
        fctx.fillStyle = '#f4f4f4'; fctx.fillRect(0, 0, 1280, 720);
        fctx.drawImage(grid, 280, 0, 720, 720);
      }, 100);
      await new Promise((r) => setTimeout(r, 6500));
      clearInterval(timer);
      return { percent: document.getElementById('percent').textContent, log: document.getElementById('log').textContent, have: document.getElementById('have').textContent, total: document.getElementById('total').textContent, name: document.getElementById('name').textContent };
    }())`);
    const errors = cdp.events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails.text);
    console.log(JSON.stringify({ initial, codec, result, errors }, null, 2));
  } finally {
    try { if (cdp) cdp.close(); } catch (e) {}
    chrome.kill();
  }
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
