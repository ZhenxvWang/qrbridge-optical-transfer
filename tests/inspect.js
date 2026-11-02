const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9225;
const URL = process.argv[2];
const PROFILE = path.resolve('.run/chrome-inspect-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function getJSON(url) { return new Promise((res, rej) => { http.get(url, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej); }); }
async function target() { for (let i = 0; i < 100; i++) { try { const ts = await getJSON(`http://127.0.0.1:${PORT}/json`); const p = ts.find((t) => t.type === 'page' && t.url.indexOf('127.0.0.1') >= 0); if (p) return p; } catch (e) {} await sleep(150); } throw new Error('no target'); }
function connect(url) { return new Promise((resolve, reject) => { const ws = new WebSocket(url); const pending = new Map(); const events = []; let id = 0; ws.addEventListener('open', () => resolve({ events, send(method, params) { return new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); }); }, close() { ws.close(); } })); ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const x = pending.get(m.id); pending.delete(m.id); m.error ? x.rej(new Error(JSON.stringify(m.error))) : x.res(m.result); } else if (m.method) events.push(m); }); ws.addEventListener('error', reject); }); }
(async () => {
  fs.mkdirSync(PROFILE, { recursive: true });
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--window-size=1280,900', URL], { stdio: 'ignore' });
  try {
    const t = await target(); const c = await connect(t.webSocketDebuggerUrl);
    await c.send('Runtime.enable'); await c.send('Page.enable'); await c.send('Log.enable'); await sleep(6000);
    const r = await c.send('Runtime.evaluate', { expression: `({title:document.title, text:document.getElementById('out')&&document.getElementById('out').textContent, body:document.body.innerText.slice(0,800)})`, returnByValue: true });
    console.log(JSON.stringify(r.result.value, null, 2));
    console.log('EVENTS', JSON.stringify(c.events.filter((e) => e.method === 'Runtime.exceptionThrown' || e.method === 'Log.entryAdded' || e.method === 'Runtime.consoleAPICalled').slice(-20), null, 2));
    c.close();
  } finally { chrome.kill(); }
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
