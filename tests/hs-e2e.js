// QuantumGrid high-speed page end-to-end smoke test.
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9224;
const URL = process.argv[2];
const PROFILE = path.resolve('.run/chrome-hs-' + Date.now());
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function waitTarget() {
  for (let i = 0; i < 100; i++) {
    try {
      const targets = await getJSON(`http://127.0.0.1:${PORT}/json`);
      const page = targets.find((t) => t.type === 'page' && t.url.indexOf('127.0.0.1') >= 0);
      if (page && page.webSocketDebuggerUrl) return page;
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('no target');
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const events = [];
    ws.addEventListener('open', () => resolve({
      events,
      send(method, params) {
        return new Promise((res, rej) => {
          const mid = ++id;
          pending.set(mid, { res, rej });
          ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
        });
      },
      close() { ws.close(); }
    }));
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const item = pending.get(msg.id); pending.delete(msg.id);
        if (msg.error) item.rej(new Error(JSON.stringify(msg.error))); else item.res(msg.result);
      } else if (msg.method) events.push(msg);
    });
    ws.addEventListener('error', reject);
  });
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, userGesture: true
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + (result.exceptionDetails.exception && result.exceptionDetails.exception.description || ''));
  return result.result.value;
}

(async () => {
  fs.mkdirSync(PROFILE, { recursive: true });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`, '--window-size=1440,1100', URL
  ], { stdio: 'ignore' });
  let cdp;
  try {
    const target = await waitTarget();
    cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await sleep(800);

    const initial = await evaluate(cdp, `({
      title: document.title,
      hasCIM: !!window.CIM,
      hasFflate: !!(window.fflate && window.fflate.gzipSync),
      hasHighspeed: !!window.__HS
    })`);

    const codec = await evaluate(cdp, `(async function () {
      const text = JSON.stringify(Array.from({ length: 1200 }, (_, i) => ({ id: i, name: 'UOS 离线传输 ' + i, value: 'zstd / CBOR / LDPC / AES-GCM' })));
      const input = new TextEncoder().encode(text);
      const packed = await __HS.compressPayload(input);
      const flags = packed.method === 'zstd' ? 5 : packed.method === 'gzip' ? 1 : 0;
      const restored = await __HS.decompressPayload(packed.data, { flags: flags, size: input.length });
      let same = restored.length === input.length;
      for (let i = 0; same && i < input.length; i++) if (restored[i] !== input[i]) same = false;
      const enc = await __HS.encryptBytes(input, 'pass-123');
      const dec = await __HS.decryptBytes(enc.data, 'pass-123', enc.salt, enc.iv);
      let aesSame = dec.length === input.length;
      for (let j = 0; aesSame && j < input.length; j++) if (dec[j] !== input[j]) aesSame = false;
      return { method: packed.method, input: input.length, compressed: packed.data.length, zstdSame: same, salt: enc.salt.length, iv: enc.iv.length, aesSame: aesSame };
    }())`);

    const sender = await evaluate(cdp, `(async function () {
      const records = [];
      for (let i = 0; i < 1600; i++) records.push({ id: i, name: 'UOS 离线传输 ' + i, value: 'QuantumGrid / CBOR / LDPC / SHA-256' });
      const text = JSON.stringify(records, null, 1);
      const bytes = new TextEncoder().encode(text);
      const file = new File([bytes], 'QuantumGrid-测试.json', { type: 'application/json' });
      const dt = new DataTransfer(); dt.items.add(file);
      const input = document.getElementById('fileInput');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('startBtn').click();
      for (let i = 0; i < 80; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (document.getElementById('statState').textContent === '播放中') break;
      }
      const canvas = document.getElementById('senderCanvas');
      const ctx = canvas.getContext('2d');
      let found = null;
      for (let i = 0; i < 30; i++) {
        const img = ctx.getImageData(0, 0, 1024, 1024);
        const frame = CIM.decodeFrame(img, 1024, 1024);
        if (frame && !frame.error) {
          if (frame.type === 1) {
            const meta = CIM.parseMetaBody(frame.body);
            found = { type: frame.type, meta: meta && { name: meta.name, size: meta.size, total: meta.total, flags: meta.flags, salt: meta.salt.length, iv: meta.iv.length } };
            break;
          }
          found = { type: frame.type, index: frame.index, total: frame.total, body: frame.body.length };
        }
        await new Promise((r) => setTimeout(r, 80));
      }
      document.getElementById('pauseBtn').click();
      return {
        statState: document.getElementById('statState').textContent,
        payload: document.getElementById('statPayload').textContent,
        frames: document.getElementById('statFrames').textContent,
        current: document.getElementById('statCurrent').textContent,
        log: document.getElementById('senderLog').textContent,
        found
      };
    }())`);

    const encrypted = await evaluate(cdp, `(async function () {
      document.getElementById('stopBtn').click();
      document.getElementById('password').value = 'test-pass-123';
      const bytes = new TextEncoder().encode('small encrypted payload');
      const file = new File([bytes], 'secret.txt', { type: 'text/plain' });
      const dt = new DataTransfer(); dt.items.add(file);
      const input = document.getElementById('fileInput');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('startBtn').click();
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 80));
        const canvas = document.getElementById('senderCanvas');
        const ctx = canvas.getContext('2d');
        const img = ctx.getImageData(0, 0, 1024, 1024);
        const frame = CIM.decodeFrame(img, 1024, 1024);
        if (frame && frame.type === 1) {
          const meta = CIM.parseMetaBody(frame.body);
          document.getElementById('stopBtn').click();
          return { flags: meta.flags, salt: meta.salt.length, iv: meta.iv.length, total: meta.total, state: document.getElementById('statState').textContent };
        }
      }
      document.getElementById('stopBtn').click();
      return { error: 'no meta', log: document.getElementById('senderLog').textContent };
    }())`);

    const large = await evaluate(cdp, `(async function () {
      document.getElementById('password').value = '';
      document.getElementById('stopBtn').click();
      const size = 9 * 1024 * 1024;
      const bytes = new Uint8Array(size);
      for (let i = 0; i < 4096; i++) bytes[i] = i & 255;
      const file = new File([bytes], 'nine-megabytes.bin', { type: 'application/octet-stream' });
      const dt = new DataTransfer(); dt.items.add(file);
      const input = document.getElementById('fileInput');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('startBtn').click();
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (document.getElementById('statState').textContent === '播放中') break;
      }
      const state = document.getElementById('statState').textContent;
      const payload = document.getElementById('statPayload').textContent;
      const frames = document.getElementById('statFrames').textContent;
      document.getElementById('stopBtn').click();
      return { state, payload, frames, hint: document.getElementById('fileHint').textContent };
    }())`);

    const errors = cdp.events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails.text);

    const receiver = await evaluate(cdp, `(async function () {
      const payloadText = JSON.stringify(Array.from({ length: 900 }, (_, i) => ({ id: i, note: '接收端完整链路测试 ' + i, value: 'zstd + CBOR + LDPC + SHA-256' })));
      const textBytes = new TextEncoder().encode(payloadText);
      const noise = crypto.getRandomValues(new Uint8Array(8000));
      const original = new Uint8Array(textBytes.length + noise.length);
      original.set(textBytes, 0); original.set(noise, textBytes.length);
      const packed = await __HS.compressPayload(original);
      const flags = (packed.method === 'zstd' ? 5 : packed.method === 'gzip' ? 1 : 0) | 2;
      const enc = await __HS.encryptBytes(packed.data, 'recv-pass');
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', original));
      const chunk = CIM.BODY_MAX;
      const total = Math.max(1, Math.ceil(enc.data.length / chunk));
      const tid = 0x77889901;
      const meta = { name: 'receiver-e2e.json', size: original.length, payloadSize: enc.data.length, sha256: hash, flags, total, chunkSize: chunk, salt: enc.salt, iv: enc.iv };
      const metaMsg = CIM.buildMessage(1, tid, total, 0, CIM.buildMetaBody(meta), flags);
      const dataMsgs = [];
      for (let i = 0; i < total; i++) dataMsgs.push(CIM.buildMessage(2, tid, total, i, enc.data.subarray(i * chunk, Math.min((i + 1) * chunk, enc.data.length)), flags));
      const grid = document.createElement('canvas');
      const fake = document.createElement('canvas'); fake.width = 1280; fake.height = 720;
      const fctx = fake.getContext('2d');
      const stream = fake.captureStream(8);
      navigator.mediaDevices.getUserMedia = async function () { return stream; };
      document.getElementById('receivePassword').value = 'recv-pass';
      document.getElementById('cameraBtn').click();
      await new Promise((r) => setTimeout(r, 1200));
      let idx = 0;
      const sequence = [metaMsg].concat(dataMsgs);
      const timer = setInterval(function () {
        const msg = sequence[idx % sequence.length];
        idx++;
        CIM.render(grid, msg);
        fctx.fillStyle = '#f4f4f4'; fctx.fillRect(0, 0, 1280, 720);
        fctx.drawImage(grid, 280, 0, 720, 720);
      }, 100);
      await new Promise((r) => setTimeout(r, 12000));
      clearInterval(timer);
      return {
        state: document.getElementById('statReceive').textContent,
        percent: document.getElementById('receivePercent').textContent,
        have: __HS.receiver.chunks.size,
        total: __HS.receiver.total,
        keys: Array.from(__HS.receiver.chunks.keys()),
        errors: __HS.receiver.errors,
        lastError: __HS.receiver.lastError,
        metaName: __HS.receiver.meta && __HS.receiver.meta.name,
        log: document.getElementById('receiveLog').textContent,
        flags: __HS.receiver.meta && __HS.receiver.meta.flags
      };
    }())`);

    console.log(JSON.stringify({ initial, codec, sender, encrypted, large, receiver, errors }, null, 2));
  } finally {
    try { if (cdp) cdp.close(); } catch (e) {}
    chrome.kill();
  }
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
