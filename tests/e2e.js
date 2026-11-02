// QFT2 end-to-end test: compression, 4-way QR, receiver, download, image import, manual retransmit.
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9223;
const URL = process.argv[2];
const PROFILE = path.resolve('.run/chrome-e2e-' + Date.now());

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (error) { reject(error); } });
    }).on('error', reject);
  });
}

async function waitTarget() {
  for (let i = 0; i < 100; i++) {
    try {
      const targets = await getJSON(`http://127.0.0.1:${PORT}/json`);
      const page = targets.find((target) => target.type === 'page' && target.url.indexOf('127.0.0.1') >= 0);
      if (page && page.webSocketDebuggerUrl) return page;
    } catch (error) { /* still starting */ }
    await sleep(150);
  }
  throw new Error('no CDP target');
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
          const messageId = ++id;
          pending.set(messageId, { res, rej });
          ws.send(JSON.stringify({ id: messageId, method, params: params || {} }));
        });
      },
      close() { ws.close(); }
    }));
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const item = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) item.rej(new Error(JSON.stringify(message.error)));
        else item.res(message.result);
      } else if (message.method) {
        events.push(message);
      }
    });
    ws.addEventListener('error', reject);
  });
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text + ': ' + (result.exceptionDetails.exception && result.exceptionDetails.exception.description || ''));
  }
  return result.result.value;
}

(async () => {
  fs.mkdirSync(PROFILE, { recursive: true });
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--window-size=1440,1100',
    URL
  ], { stdio: 'ignore' });

  let cdp;
  try {
    const target = await waitTarget();
    cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await sleep(800);

    const initial = await evaluate(cdp, `(function () {
      return {
        title: document.title,
        hasCore: !!window.QRBCore,
        hasFflate: !!(window.fflate && window.fflate.gzipSync),
        hasApp: !!window.__QRBridge,
        version: window.__QRBridge && window.__QRBridge.version,
        channels: window.__QRBridge && window.__QRBridge.send.channels
      };
    }())`);

    const sender = await evaluate(cdp, `(async function () {
      const records = [];
      for (let i = 0; i < 1400; i++) {
        records.push({ id: i, name: '统信UOS离线传输记录-' + i, value: 'QR Bridge 2.0 / 压缩 / 四路并行 / SHA-256', flag: (i % 7 === 0) });
      }
      const text = JSON.stringify(records, null, 1);
      const bytes = new TextEncoder().encode(text);
      const file = new File([bytes], 'QFT2-端到端测试.json', { type: 'application/json' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.getElementById('fileInput');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 120));
      const enabled = !document.getElementById('startSendBtn').disabled;
      document.getElementById('startSendBtn').click();
      await new Promise((resolve) => setTimeout(resolve, 2200));
      const s = window.__QRBridge.send;
      const canvas = document.getElementById('qrCanvas');
      const ctx = canvas.getContext('2d');
      let codes = [];
      for (let attempt = 0; attempt < 12; attempt++) {
        codes = [];
        const offsets = [[0, 0], [640, 0], [0, 360], [640, 360]];
        for (const offset of offsets) {
          const work = document.createElement('canvas');
          work.width = 640;
          work.height = 360;
          const wctx = work.getContext('2d');
          wctx.drawImage(canvas, offset[0], offset[1], 640, 360, 0, 0, 640, 360);
          const pixels = wctx.getImageData(0, 0, 640, 360);
          const code = jsQR(pixels.data, 640, 360, { inversionAttempts: 'dontInvert' });
          if (code && code.data) codes.push(code.data);
        }
        if (codes.length >= 4) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return {
        enabled: enabled,
        playing: s.playing,
        compressed: s.compressed,
        flags: s.flags,
        originalLength: s.data.length,
        payloadSize: s.payloadSize,
        total: s.total,
        chunkSize: s.chunkSize,
        channels: s.channels,
        qrVersion: s.qrVersion,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        frameLabel: document.getElementById('qrFrameLabel').textContent,
        statsSize: document.getElementById('statSize').textContent,
        statsChunks: document.getElementById('statChunks').textContent,
        statsVersion: document.getElementById('statVersion').textContent,
        broadcasting: document.getElementById('sendLayout').classList.contains('is-broadcasting'),
        multiClass: document.getElementById('sendStage').classList.contains('is-multi'),
        decodedCodes: codes.length,
        decodedPrefixes: codes.map((c) => c.slice(0, 12)),
        allAlnum: codes.every((c) => /^[0-9A-Z $%*+\\-./:]+$/.test(c))
      };
    }())`);

    const sendShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.resolve('.run/ui2-send-live.png'), Buffer.from(sendShot.data, 'base64'));

    const receiver = await evaluate(cdp, `(async function () {
      const app = window.__QRBridge;
      const C = app.core;
      document.getElementById('tabReceive').click();
      await new Promise((resolve) => setTimeout(resolve, 400));
      const s = app.send;
      let fed = 0;
      for (let i = 0; i < s.total; i++) {
        const start = i * s.chunkSize;
        const payload = new Uint8Array(s.chunkSize);
        payload.set(s.payload.subarray(start, Math.min(start + s.chunkSize, s.payloadSize)));
        const text = C.makeDataFrame({
          transferId: s.transferId,
          total: s.total,
          chunkSize: s.chunkSize,
          index: i,
          channels: s.channels,
          payload: payload
        });
        if (app.handleFrameText(text, 'test')) fed += 1;
      }
      app.handleFrameText(s.metaText, 'test');
      await new Promise((resolve) => setTimeout(resolve, 2200));
      const r = app.receive;
      const savedBytes = r.blob ? new Uint8Array(await r.blob.arrayBuffer()) : new Uint8Array(0);
      const savedHash = savedBytes.length ? await C.sha256Hex(savedBytes) : '';
      return {
        fed: fed,
        have: r.haveCount,
        total: r.total,
        channels: r.channels,
        complete: r.complete,
        hashMismatch: r.hashMismatch,
        compressed: r.meta && r.meta.compressed,
        fileName: r.meta && r.meta.fileName,
        fileSize: r.meta && r.meta.fileSize,
        payloadSize: r.meta && r.meta.payloadSize,
        savedLength: savedBytes.length,
        savedHashMatches: savedHash === (r.meta && r.meta.sha256),
        fileMeta: document.getElementById('recvFileMeta').textContent,
        completeVisible: !document.getElementById('completeCard').hidden,
        completeTitle: document.getElementById('completeTitle').textContent,
        completeText: document.getElementById('completeText').textContent,
        progressText: document.getElementById('recvProgressText').textContent
      };
    }())`);

    const completeShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.resolve('.run/ui2-complete.png'), Buffer.from(completeShot.data, 'base64'));

    const downloadDir = path.resolve('.run/downloads2');
    fs.rmSync(downloadDir, { recursive: true, force: true });
    fs.mkdirSync(downloadDir, { recursive: true });
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
    await evaluate(cdp, `(function () { document.getElementById('saveFileBtn').click(); return true; }())`);
    await sleep(1200);
    const downloadedFiles = fs.readdirSync(downloadDir).map((name) => ({
      name,
      size: fs.statSync(path.join(downloadDir, name)).size
    }));

    const imageImport = await evaluate(cdp, `(async function () {
      const app = window.__QRBridge;
      const C = app.core;
      const s = app.send;
      document.getElementById('receiveAnotherBtn').click();
      const grid = document.createElement('canvas');
      grid.width = 1280;
      grid.height = 720;
      const ctx = grid.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 1280, 720);
      const offsets = [[0, 0], [640, 0], [0, 360], [640, 360]];
      for (let i = 0; i < 4; i++) {
        const start = i * s.chunkSize;
        const payload = new Uint8Array(s.chunkSize);
        payload.set(s.payload.subarray(start, Math.min(start + s.chunkSize, s.payloadSize)));
        const text = C.makeDataFrame({ transferId: s.transferId, total: s.total, chunkSize: s.chunkSize, index: i, channels: s.channels, payload: payload });
        const qr = qrcode(s.qrVersion, 'L');
        qr.addData(text, 'Alphanumeric');
        qr.make();
        const count = qr.getModuleCount();
        const box = 352;
        const scale = Math.floor(box / (count + 8));
        const qrPixels = count * scale;
        const ox = offsets[i][0] + 144 + Math.floor((box - qrPixels) / 2);
        const oy = offsets[i][1] + 4 + Math.floor((box - qrPixels) / 2);
        ctx.fillStyle = '#071522';
        for (let row = 0; row < count; row++) {
          for (let col = 0; col < count; col++) {
            if (qr.isDark(row, col)) ctx.fillRect(ox + col * scale, oy + row * scale, scale, scale);
          }
        }
      }
      const dataUrl = grid.toDataURL('image/png');
      const binary = atob(dataUrl.split(',')[1]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], 'quad-grid.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.getElementById('imageInput');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 2200));
      const r = app.receive;
      return {
        transferIdSet: !!r.transferId,
        channels: r.channels,
        have: r.haveCount,
        total: r.total,
        status: document.getElementById('recvStatusText').textContent,
        progress: document.getElementById('recvProgressText').textContent
      };
    }())`);

    const manualParser = await evaluate(cdp, `window.__QRBridge.parseTargetList('3,7-9,99,2-4', 10)`);
    const manualClick = cdp.send('Runtime.evaluate', {
      expression: `document.getElementById('manualSendBtn').click()`,
      userGesture: true,
      returnByValue: true
    });
    await sleep(350);
    const dialogEvent = cdp.events.find((event) => event.method === 'Page.javascriptDialogOpening');
    let manualDialogHandled = false;
    if (dialogEvent) {
      await cdp.send('Page.handleJavaScriptDialog', { accept: true, promptText: '1,3' });
      manualDialogHandled = true;
    }
    await manualClick;
    await sleep(2600);
    const manualMode = await evaluate(cdp, `(function () {
      const s = window.__QRBridge.send;
      return {
        playing: s.playing,
        timer: !!s.timer,
        targets: s.manualTargets ? s.manualTargets.slice() : null,
        label: document.getElementById('manualSendLabel').textContent,
        frameLabel: document.getElementById('qrFrameLabel').textContent
      };
    }())`);
    await evaluate(cdp, `(function () { document.getElementById('manualSendBtn').click(); return true; }())`);
    await sleep(700);
    const manualExit = await evaluate(cdp, `(function () {
      const s = window.__QRBridge.send;
      return { playing: s.playing, targets: s.manualTargets, label: document.getElementById('manualSendLabel').textContent };
    }())`);

    const singleMode = await evaluate(cdp, `(async function () {
      document.getElementById('stopSendBtn').click();
      await new Promise((resolve) => setTimeout(resolve, 200));
      document.querySelector('#channelGroup [data-channels="1"]').click();
      const data = new TextEncoder().encode('单码兼容模式测试 '.repeat(200));
      const file = new File([data], '单码测试.txt', { type: 'text/plain' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.getElementById('fileInput');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 120));
      document.getElementById('startSendBtn').click();
      await new Promise((resolve) => setTimeout(resolve, 1600));
      const s = window.__QRBridge.send;
      const canvas = document.getElementById('qrCanvas');
      const ctx = canvas.getContext('2d');
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(pixels.data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
      const parsed = code && code.data ? window.QRBCore.parseFrame(code.data) : null;
      return {
        channels: s.channels,
        playing: s.playing,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        decoded: !!parsed,
        decodedChannels: parsed && parsed.channels,
        label: document.getElementById('qrFrameLabel').textContent
      };
    }())`);

    const errors = cdp.events
      .filter((event) => event.method === 'Runtime.exceptionThrown' || event.method === 'Log.entryAdded')
      .map((event) => JSON.stringify(event.params).slice(0, 500));

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true
    });
    await cdp.send('Page.reload');
    await sleep(1500);
    const mobile = await evaluate(cdp, `(function () {
      return {
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        modeButtons: document.querySelectorAll('.mode-btn').length,
        channelButtons: document.querySelectorAll('#channelGroup .segment').length
      };
    }())`);
    const mobileShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.resolve('.run/ui2-mobile.png'), Buffer.from(mobileShot.data, 'base64'));

    console.log(JSON.stringify({
      initial,
      sender,
      receiver,
      downloadedFiles,
      imageImport,
      manualParser,
      manualDialogHandled,
      manualMode,
      manualExit,
      singleMode,
      mobile,
      errors
    }, null, 2));
  } catch (error) {
    console.error('E2E ERROR:', error.stack || error);
    process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    chrome.kill();
  }
})();
