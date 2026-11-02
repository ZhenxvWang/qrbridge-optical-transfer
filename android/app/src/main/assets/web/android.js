/* 码桥 Android 接收端：仅接收 Quantum Grid 高速色码 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var receiver = {
    stream: null, timer: 0, decoding: false, finishing: false, completed: false,
    tid: 0, meta: null, total: 0, chunk: 0, chunks: new Map()
  };
  var mode = 'qr';
  var qr = {
    tid: '', meta: null, total: 0, chunk: 0, chunks: new Map(),
    finishing: false, completed: false, bestScale: 1,
    scans: 0, codes: 0, lastMs: 0
  };
  var qrCanvas = document.createElement('canvas');
  var qrCtx = qrCanvas.getContext('2d', { willReadFrequently: true });
  var video = $('video');
  var scanCanvas = document.createElement('canvas');
  var scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });
  var zstdLib = null, zstdDict = null, zstdPromise = null;

  function log(text, kind) {
    $('log').textContent = text;
    $('log').className = kind || '';
  }

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function initZstd() {
    if (zstdPromise) return zstdPromise;
    zstdPromise = (async function () {
      try {
        var lib = await import('./vendor/zstd/index.web.js');
        await lib.init();
        var response = await fetch('./vendor/zstd/dict.bin', { cache: 'no-store' });
        if (!response.ok) throw new Error('dict');
        zstdDict = new Uint8Array(await response.arrayBuffer());
        zstdLib = lib;
        return true;
      } catch (e) {
        return false;
      }
    }());
    return zstdPromise;
  }

  function gunzipAsync(bytes) {
    return new Promise(function (resolve, reject) {
      fflate.gunzip(bytes, function (err, out) {
        if (err) reject(err); else resolve(out);
      });
    });
  }

  async function decompressPayload(bytes, meta) {
    if (meta.flags & 4) {
      if (!(await initZstd())) throw new Error('zstd 解码器加载失败');
      var dctx = zstdLib.createDCtx();
      try {
        return zstdLib.decompressUsingDict(dctx, bytes, zstdDict, {
          defaultHeapSize: Math.max(1024, meta.size)
        });
      } finally {
        zstdLib.freeDCtx(dctx);
      }
    }
    if (meta.flags & 1) return gunzipAsync(bytes);
    return bytes;
  }

  function randomId() {
    var a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] >>> 0;
  }

  function sha256(bytes) {
    return crypto.subtle.digest('SHA-256', bytes).then(function (b) { return new Uint8Array(b); });
  }

  function deriveKey(password, salt) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: 120000, hash: 'SHA-256' },
          base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      });
  }

  async function decryptBytes(bytes, password, salt, iv) {
    var key = await deriveKey(password, salt);
    var buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, bytes);
    return new Uint8Array(buf);
  }

  function bytesToBase64(bytes) {
    var text = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      text += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
    }
    return btoa(text);
  }

  async function saveBytes(bytes, name) {
    if (window.QRBridgeAndroid && window.QRBridgeAndroid.beginSave) {
      log('正在保存到系统下载目录…');
      try {
        window.QRBridgeAndroid.beginSave(name, bytes.length);
        var step = 128 * 1024;
        for (var offset = 0; offset < bytes.length; offset += step) {
          var part = bytes.subarray(offset, Math.min(offset + step, bytes.length));
          window.QRBridgeAndroid.appendSave(bytesToBase64(part));
        }
        return window.QRBridgeAndroid.finishSave();
      } catch (err) {
        if (window.QRBridgeAndroid.abortSave) window.QRBridgeAndroid.abortSave();
        throw new Error('保存失败：' + (err && err.message ? err.message : err));
      }
    }
    var blob = new Blob([bytes], { type: 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name || 'qrbridge.bin';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    return name;
  }

  function updateQrProgress() {
    var have = qr.chunks.size;
    var total = qr.total || 0;
    var pct = total ? Math.min(100, Math.round(have * 100 / total)) : 0;
    $('have').textContent = String(have);
    $('total').textContent = total ? String(total) : '—';
    $('percent').textContent = pct + '%';
    $('bar').style.width = pct + '%';
    if (qr.meta) {
      $('name').textContent = qr.meta.fileName;
      $('size').textContent = formatBytes(qr.meta.fileSize);
    }
  }

  function resetQr(clearMeta) {
    qr.chunks = new Map();
    qr.total = 0;
    qr.chunk = 0;
    qr.finishing = false;
    qr.completed = false;
    qr.bestScale = 1;
    if (clearMeta) {
      qr.meta = null;
      qr.tid = '';
      $('name').textContent = '等待发送端';
      $('size').textContent = '—';
    }
    updateQrProgress();
  }

  function handleQrText(text) {
    if (qr.completed || qr.finishing) return;
    var frame = QRBCore.parseFrame(text);
    if (!frame) return;
    qr.codes += 1;
    if (qr.tid && qr.tid !== frame.transferId) resetQr(true);
    if (!qr.tid) {
      qr.tid = frame.transferId;
      qr.total = frame.total;
      qr.chunk = frame.chunkSize;
    }
    if (frame.kind === 'meta') {
      qr.meta = frame;
      qr.total = frame.total;
      qr.chunk = frame.chunkSize;
      $('name').textContent = frame.fileName;
      $('size').textContent = formatBytes(frame.fileSize);
      log('正在接收：' + frame.fileName + '，共 ' + frame.total + ' 帧。');
      updateQrProgress();
      if (qr.chunks.size >= qr.total) qrFinish();
      return;
    }
    if (frame.kind === 'data') {
      if (frame.index >= qr.total) return;
      if (!qr.chunks.has(frame.index)) {
        qr.chunks.set(frame.index, frame.payload.slice());
        updateQrProgress();
      }
      if (qr.meta && qr.chunks.size >= qr.total) qrFinish();
    }
  }

  async function qrFinish() {
    if (qr.finishing || qr.completed || !qr.meta) return;
    if (qr.chunks.size < qr.total) return;
    qr.finishing = true;
    try {
      var pieces = [];
      for (var i = 0; i < qr.total; i++) {
        var part = qr.chunks.get(i);
        if (!part) throw new Error('缺少分片 ' + (i + 1));
        pieces.push(part);
      }
      var raw = QRBCore.assemble(pieces, qr.meta.payloadSize);
      var output = qr.meta.compressed ? QRBCore.gunzipBytes(raw) : raw;
      if (output.length !== qr.meta.fileSize) throw new Error('文件长度不一致');
      var hash = await QRBCore.sha256Hex(output);
      if (hash.toLowerCase() !== qr.meta.sha256.toLowerCase()) throw new Error('SHA-256 校验失败');
      var path = await saveBytes(output, QRBCore.safeFileName(qr.meta.fileName));
      qr.completed = true;
      $('percent').textContent = '100%';
      $('bar').style.width = '100%';
      log('完成：' + qr.meta.fileName + ' · ' + formatBytes(qr.meta.fileSize) +
        ' · SHA-256 通过\n保存位置：' + path, 'ok');
    } catch (err) {
      qr.finishing = false;
      log('二维码接收失败：' + (err && err.message ? err.message : err), 'error');
    }
  }

  function decodeQrPixels(data, width, height, inversion) {
    try {
      return window.jsQR(data, width, height, { inversionAttempts: inversion || 'dontInvert' });
    } catch (err) {
      return null;
    }
  }

  function qrCollect(sourceCanvas, width, height, scale) {
    var targetAspect = 16 / 9;
    var baseWidth = Math.min(width, height * targetAspect);
    var baseHeight = baseWidth / targetAspect;
    var regionWidth = baseWidth * scale;
    var regionHeight = baseHeight * scale;
    var regionX = (width - regionWidth) / 2;
    var regionY = (height - regionHeight) / 2;
    var quadWidth = Math.max(2, Math.floor(regionWidth / 2));
    var quadHeight = Math.max(2, Math.floor(regionHeight / 2));
    if (qrCanvas.width !== quadWidth || qrCanvas.height !== quadHeight) {
      qrCanvas.width = quadWidth;
      qrCanvas.height = quadHeight;
    }
    var offsets = [[0, 0], [1, 0], [0, 1], [1, 1]];
    var found = 0;
    for (var i = 0; i < offsets.length; i++) {
      var sx = Math.floor(regionX + offsets[i][0] * quadWidth);
      var sy = Math.floor(regionY + offsets[i][1] * quadHeight);
      qrCtx.drawImage(sourceCanvas, sx, sy, quadWidth, quadHeight, 0, 0, quadWidth, quadHeight);
      var pixels;
      try {
        pixels = qrCtx.getImageData(0, 0, quadWidth, quadHeight);
      } catch (err) {
        continue;
      }
      var code = decodeQrPixels(pixels.data, quadWidth, quadHeight, 'dontInvert');
      if (code && code.data && QRBCore.parseFrame(code.data)) {
        handleQrText(code.data);
        found += 1;
      }
    }
    return found;
  }

  function scanQr() {
    var started = performance.now();
    qr.scans += 1;
    var found = qrCollect(scanCanvas, 1280, 720, 1);
    if (found >= 4) return;
    if (found === 0) {
      // 单码兼容：把整帧缩小到 960x540 再试一次，避免 1280x720 的 jsQR 开销。
      var full = document.createElement('canvas');
      full.width = 960; full.height = 540;
      var fctx = full.getContext('2d', { willReadFrequently: true });
      fctx.drawImage(scanCanvas, 0, 0, 960, 540);
      var pixels = fctx.getImageData(0, 0, 960, 540);
      var code = decodeQrPixels(pixels.data, 960, 540, 'dontInvert');
      if (code && code.data) {
        var frame = QRBCore.parseFrame(code.data);
        if (frame) {
          handleQrText(code.data);
          if (frame.channels === 1) return;
        }
      }
    }
    var scales = [0.9, 0.8, 0.7];
    for (var i = 0; i < scales.length; i++) {
      if (qrCollect(scanCanvas, 1280, 720, scales[i]) >= 4) break;
    }
    qr.lastMs = performance.now() - started;
  }


  function updateProgress() {
    var have = receiver.chunks.size;
    var total = receiver.total || 0;
    var pct = total ? Math.min(100, Math.round(have * 100 / total)) : 0;
    $('have').textContent = String(have);
    $('total').textContent = total ? String(total) : '—';
    $('percent').textContent = pct + '%';
    $('bar').style.width = pct + '%';
    if (receiver.meta) {
      $('name').textContent = receiver.meta.name;
      $('size').textContent = formatBytes(receiver.meta.size);
    }
  }

  function reset(clearMeta) {
    receiver.chunks = new Map();
    receiver.total = 0;
    receiver.chunk = 0;
    receiver.finishing = false;
    receiver.completed = false;
    if (clearMeta) {
      receiver.meta = null;
      receiver.tid = 0;
      $('name').textContent = '等待发送端';
    }
    updateProgress();
  }

  async function finish() {
    if (receiver.finishing || receiver.completed || !receiver.meta) return;
    if (receiver.chunks.size < receiver.total) return;
    receiver.finishing = true;
    try {
      var meta = receiver.meta;
      var payload = new Uint8Array(meta.payloadSize);
      for (var i = 0; i < receiver.total; i++) {
        var part = receiver.chunks.get(i);
        if (!part) throw new Error('缺少分片 ' + (i + 1));
        payload.set(part, i * meta.chunkSize);
      }
      if (meta.flags & 2) {
        var password = $('password').value;
        if (!password) throw new Error('加密文件，请填写解密口令');
        log('AES-GCM 解密中…');
        payload = await decryptBytes(payload, password, meta.salt, meta.iv);
      }
      if (meta.flags & 1) {
        log((meta.flags & 4) ? 'zstd 解压中…' : 'gzip 解压中…');
        payload = await decompressPayload(payload, meta);
      }
      if (payload.length !== meta.size) throw new Error('文件长度不一致');
      var hash = await sha256(payload);
      var same = true;
      for (var h = 0; h < 32; h++) if (hash[h] !== meta.sha256[h]) { same = false; break; }
      if (!same) throw new Error('SHA-256 校验失败');
      var path = await saveBytes(payload, meta.name);
      receiver.completed = true;
      $('percent').textContent = '100%';
      $('bar').style.width = '100%';
      log('完成：' + meta.name + ' · ' + formatBytes(meta.size) + ' · SHA-256 通过\n保存位置：' + path, 'ok');
    } catch (err) {
      receiver.finishing = false;
      log('接收失败：' + (err && err.message ? err.message : err), 'error');
    }
  }

  function handle(frame) {
    if (receiver.completed || receiver.finishing) return;
    if (frame.type === 1) {
      var meta = CIM.parseMetaBody(frame.body);
      if (!meta) return;
      if (receiver.tid !== frame.transferId) {
        reset(true);
        receiver.tid = frame.transferId;
      }
      receiver.meta = meta;
      receiver.total = meta.total;
      receiver.chunk = meta.chunkSize;
      $('name').textContent = meta.name;
      $('size').textContent = formatBytes(meta.size);
      if (meta.flags & 2) log('加密传输，请输入解密口令；收齐后自动解密。');
      else log('正在接收：' + meta.name + '，共 ' + meta.total + ' 帧。');
      updateProgress();
      if (receiver.total && receiver.chunks.size >= receiver.total) finish();
      return;
    }
    if (frame.type === 2) {
      if (!receiver.tid || receiver.tid !== frame.transferId) {
        reset(true);
        receiver.tid = frame.transferId;
      }
      if (!receiver.total) receiver.total = frame.total;
      if (!receiver.chunk) receiver.chunk = CIM.BODY_MAX;
      if (frame.index >= receiver.total) return;
      if (!receiver.chunks.has(frame.index)) {
        receiver.chunks.set(frame.index, frame.body.slice());
        updateProgress();
      }
      if (receiver.meta && receiver.chunks.size >= receiver.total) finish();
    }
  }

  function scan() {
    if (receiver.decoding || !receiver.stream || video.readyState < 2) return;
    receiver.decoding = true;
    try {
      var vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return;
      var scale = Math.min(1280 / vw, 720 / vh);
      var dw = Math.round(vw * scale), dh = Math.round(vh * scale);
      scanCanvas.width = 1280; scanCanvas.height = 720;
      scanCtx.fillStyle = '#000';
      scanCtx.fillRect(0, 0, 1280, 720);
      scanCtx.drawImage(video, Math.round((1280 - dw) / 2), Math.round((720 - dh) / 2), dw, dh);
      var image = scanCtx.getImageData(0, 0, 1280, 720);
      if (mode === 'qr') {
        scanQr(image);
      } else {
        var frame = CIM.decodeFrame(image, 1280, 720);
        if (frame && !frame.error) handle(frame);
      }
    } catch (e) {
      // 单帧失败继续。
    } finally {
      receiver.decoding = false;
    }
  }

  async function openCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      log('WebView 不支持摄像头，请检查系统权限。', 'error');
      return;
    }
    $('cameraBtn').disabled = true;
    log('正在请求摄像头权限…');
    try {
      receiver.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      video.srcObject = receiver.stream;
      await video.play();
      video.classList.add('live');
      $('empty').classList.add('hidden');
      $('cameraBtn').textContent = '重新打开';
      $('cameraBtn').disabled = false;
      log('摄像头已打开，把整个色码放进取景框，保持稳定。');
      if (receiver.timer) clearInterval(receiver.timer);
      receiver.timer = setInterval(scan, 140);
    } catch (err) {
      $('cameraBtn').disabled = false;
      log('无法打开摄像头：' + (err && err.message ? err.message : err), 'error');
    }
  }

  $('cameraBtn').addEventListener('click', openCamera);
  $('resetBtn').addEventListener('click', function () {
    resetQr(true);
    reset(true);
    log(receiver.stream ? '已清空，继续扫描。' : '已清空。');
  });
  $('password').addEventListener('input', function () {
    if (mode === 'cim' && receiver.meta && !receiver.finishing && receiver.chunks.size >= receiver.total) finish();
  });

  function setMode(next) {
    mode = next;
    $('modeQr').classList.toggle('active', mode === 'qr');
    $('modeCim').classList.toggle('active', mode === 'cim');
    $('modeHint').textContent = mode === 'qr'
      ? '对应发送端的“二维码模式”；4 路二维码会自动分区识别，最大 8 MB。'
      : '对应发送端的“高速色码（实验）”；支持大文件，建议全屏正对。';
    resetQr(true);
    reset(true);
    $('name').textContent = '等待发送端';
    $('size').textContent = '—';
    if (mode === 'qr') updateQrProgress(); else updateProgress();
    log(receiver.stream ? '已切换模式，继续扫描。' : '已切换模式，请打开摄像头。');
  }
  $('modeQr').addEventListener('click', function () { setMode('qr'); });
  $('modeCim').addEventListener('click', function () { setMode('cim'); });

  if (window.QRBridgeAndroid && window.QRBridgeAndroid.platform) {
    $('platform').textContent = 'ANDROID · ' + (window.QRBridgeAndroid.version ? window.QRBridgeAndroid.version() : 'OFFLINE');
  }
  updateQrProgress();
  window.__ANDROID_RECEIVER = {
    receiver: receiver,
    qr: qr,
    setMode: setMode,
    initZstd: initZstd,
    decompressPayload: decompressPayload
  };
  setTimeout(function () { initZstd(); }, 300);
}());
