// End-to-end camera test using Chrome's fake capture device and a Y4M QR frame.
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9225;
const URL = process.argv[2];
const Y4M = path.resolve(process.argv[3] || '.run/qr-camera.y4m');
const PROFILE = path.resolve('.run/chrome-camera-' + Date.now());

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
      } else if (message.method) events.push(message);
    });
    ws.addEventListener('error', reject);
  });
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
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
    `--use-file-for-fake-video-capture=${Y4M}`,
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--window-size=1440,1000',
    URL
  ], { stdio: 'ignore' });

  let cdp;
  try {
    const target = await waitTarget();
    cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await sleep(700);

    const result = await evaluate(cdp, `(async function () {
      document.getElementById('tabReceive').click();
      await new Promise((resolve) => setTimeout(resolve, 250));
      document.getElementById('startCameraBtn').click();
      await new Promise((resolve) => setTimeout(resolve, 4500));
      const r = window.__QRBridge.receive;
      const video = document.getElementById('cameraVideo');
      return {
        scanning: r.scanning,
        transferId: r.transferId,
        have: r.haveCount,
        total: r.total,
        channels: r.channels,
        meta: r.meta,
        status: document.getElementById('recvStatusText').textContent,
        progress: document.getElementById('recvProgressText').textContent,
        scanCount: r.scanCount,
        framesSeen: r.framesSeen,
        duplicates: r.duplicates,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        cameraChip: document.getElementById('cameraStatus').textContent.trim()
      };
    }())`);

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.resolve('.run/ui2-camera.png'), Buffer.from(shot.data, 'base64'));

    const errors = cdp.events
      .filter((event) => event.method === 'Runtime.exceptionThrown')
      .map((event) => JSON.stringify(event.params).slice(0, 500));

    console.log(JSON.stringify({ result, errors }, null, 2));
    if (result.transferId !== 'ABCD2345' || result.total !== 4 || result.channels !== 4 || result.have < 4) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('CAMERA E2E ERROR:', error.stack || error);
    process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    chrome.kill();
  }
})();
