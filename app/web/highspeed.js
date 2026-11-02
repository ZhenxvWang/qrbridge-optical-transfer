/* 码桥 Quantum Grid 实验版 UI */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var MAX_FILE_BYTES = 512 * 1024 * 1024;
  var META_EVERY = 20;

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  function setLog(el, text, kind) {
    el.textContent = text;
    el.className = 'hs-log' + (kind ? ' ' + kind : '');
  }

  function downloadBytes(bytes, name) {
    var blob = new Blob([bytes], { type: 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name || 'qrbridge.bin';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function randomBytes(n) {
    var out = new Uint8Array(n);
    crypto.getRandomValues(out);
    return out;
  }

  function randomUint32() {
    var a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] >>> 0;
  }

  function sha256(bytes) {
    return crypto.subtle.digest('SHA-256', bytes).then(function (buf) {
      return new Uint8Array(buf);
    });
  }

  function gzipAsync(bytes) {
    return new Promise(function (resolve, reject) {
      fflate.gzip(bytes, { level: 6 }, function (err, out) {
        if (err) reject(err); else resolve(out);
      });
    });
  }

  function gunzipAsync(bytes) {
    return new Promise(function (resolve, reject) {
      fflate.gunzip(bytes, function (err, out) {
        if (err) reject(err); else resolve(out);
      });
    });
  }

  /* ---------- zstd（内嵌 WASM + 领域字典），失败时回退 gzip ---------- */
  var zstdLib = null;
  var zstdDict = null;
  var zstdPromise = null;

  function initZstd() {
    if (zstdPromise) return zstdPromise;
    zstdPromise = (async function () {
      try {
        var lib = await import('./vendor/zstd/index.web.js');
        await lib.init();
        var response = await fetch('./vendor/zstd/dict.bin', { cache: 'no-store' });
        if (!response.ok) throw new Error('字典加载失败');
        var dict = new Uint8Array(await response.arrayBuffer());
        zstdLib = lib;
        zstdDict = dict;
        return true;
      } catch (err) {
        zstdLib = null;
        zstdDict = null;
        return false;
      }
    }());
    return zstdPromise;
  }

  async function compressPayload(bytes) {
    try {
      if (await initZstd()) {
        var cctx = zstdLib.createCCtx();
        try {
          var z = zstdLib.compressUsingDict(cctx, bytes, zstdDict, 6);
          if (z.length < bytes.length) return { data: z, method: 'zstd' };
          return { data: bytes, method: 'none' };
        } finally {
          zstdLib.freeCCtx(cctx);
        }
      }
    } catch (err) { /* 回退 gzip */ }
    var gz = await gzipAsync(bytes);
    if (gz.length < bytes.length) return { data: gz, method: 'gzip' };
    return { data: bytes, method: 'none' };
  }

  async function decompressPayload(bytes, meta) {
    if (meta.flags & 4) {
      if (!(await initZstd())) throw new Error('zstd 解码器未加载');
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

  function deriveKey(password, salt) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: 120000, hash: 'SHA-256' },
          base,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
      });
  }

  function encryptBytes(bytes, password) {
    var salt = randomBytes(16);
    var iv = randomBytes(12);
    return deriveKey(password, salt).then(function (key) {
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, bytes).then(function (buf) {
        return { data: new Uint8Array(buf), salt: salt, iv: iv };
      });
    });
  }

  function decryptBytes(bytes, password, salt, iv) {
    return deriveKey(password, salt).then(function (key) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, bytes).then(function (buf) {
        return new Uint8Array(buf);
      });
    });
  }

  /* ============================ 发送端 ============================ */
  var sender = {
    file: null, running: false, paused: false, timer: 0,
    payload: null, metaMsg: null, total: 0, dataIndex: 0,
    metaNext: true, sinceMeta: 0, tid: 0, flags: 0, chunk: 0,
    fps: 6, startedAt: 0, sent: 0
  };
  var senderCanvas = $('senderCanvas');
  var senderStage = $('senderStage');
  var stageEmpty = $('stageEmpty');

  function setFile(file) {
    if (!file) return;
    sender.file = file;
    $('fileName').textContent = file.name;
    $('fileHint').textContent = formatBytes(file.size) + ' · 不再受 8 MB 限制';
    $('senderLog').className = 'hs-log';
    $('senderLog').textContent = '已选择文件。设置口令或帧率后点“开始播放”。';
    $('statPayload').textContent = '—';
    $('statFrames').textContent = '—';
    $('statCurrent').textContent = '—';
    $('statState').textContent = '待机';
  }

  $('fileInput').addEventListener('change', function (e) {
    setFile(e.target.files && e.target.files[0]);
  });
  var dropzone = $('dropzone');
  ['dragenter', 'dragover'].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) {
      e.preventDefault(); dropzone.classList.add('drag');
    });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) {
      e.preventDefault(); dropzone.classList.remove('drag');
    });
  });
  dropzone.addEventListener('drop', function (e) {
    if (e.dataTransfer.files && e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
  });

  function stopSenderTimer() {
    if (sender.timer) { clearTimeout(sender.timer); sender.timer = 0; }
  }

  function senderTick() {
    if (!sender.running || sender.paused) return;
    var msg, label;
    if (sender.metaNext) {
      msg = sender.metaMsg;
      sender.metaNext = false;
      sender.sinceMeta = 0;
      label = '元数据';
    } else {
      var start = sender.dataIndex * sender.chunk;
      var end = Math.min(start + sender.chunk, sender.payload.length);
      var body = sender.payload.subarray(start, end);
      msg = CIM.buildMessage(2, sender.tid, sender.total, sender.dataIndex, body, sender.flags);
      label = (sender.dataIndex + 1) + ' / ' + sender.total;
      sender.dataIndex++;
      sender.sinceMeta++;
      if (sender.dataIndex >= sender.total) {
        sender.dataIndex = 0;
        sender.metaNext = true;
      } else if (sender.sinceMeta >= META_EVERY) {
        sender.metaNext = true;
      }
    }
    CIM.render(senderCanvas, msg);
    sender.sent++;
    $('statCurrent').textContent = label;
    $('statState').textContent = sender.paused ? '已暂停' : '播放中';
    var elapsed = Math.max(0.1, (Date.now() - sender.startedAt) / 1000);
    $('statFrames').textContent = sender.total + ' 帧 · ' + (sender.sent / elapsed).toFixed(1) + ' fps';
    sender.timer = setTimeout(senderTick, Math.max(50, 1000 / sender.fps));
  }

  async function startSender() {
    if (!sender.file) {
      setLog($('senderLog'), '请先选择文件。', 'error');
      return;
    }
    if (!document.fullscreenElement && senderStage.requestFullscreen) {
      // 必须在用户点击的同步调用栈里请求全屏，否则浏览器会拒绝。
      try { senderStage.requestFullscreen().catch(function () {}); } catch (err) { /* ignore */ }
    }
    if (sender.file.size > MAX_FILE_BYTES) {
      setLog($('senderLog'), '文件超过 512 MB。可先用二维码模式或拆分文件。', 'error');
      return;
    }
    $('startBtn').disabled = true;
    $('pauseBtn').disabled = true;
    $('stopBtn').disabled = true;
    $('statState').textContent = '准备中';
    setLog($('senderLog'), '读取文件并压缩…');
    try {
      var bytes = new Uint8Array(await sender.file.arrayBuffer());
      var hash = await sha256(bytes);
      setLog($('senderLog'), '压缩中（zstd 字典 / gzip 回退）…');
      var packed = await compressPayload(bytes);
      var flags = 0;
      if (packed.method === 'zstd') flags = 5;
      else if (packed.method === 'gzip') flags = 1;
      var payload = packed.data;
      var salt = new Uint8Array(0);
      var iv = new Uint8Array(0);
      var password = $('password').value;
      if (password) {
        setLog($('senderLog'), '加密中…');
        var enc = await encryptBytes(payload, password);
        payload = enc.data;
        salt = enc.salt;
        iv = enc.iv;
        flags |= 2;
      }
      sender.payload = payload;
      sender.flags = flags;
      sender.tid = randomUint32();
      sender.chunk = CIM.BODY_MAX;
      sender.total = Math.max(1, Math.ceil(payload.length / sender.chunk));
      sender.dataIndex = 0;
      sender.metaNext = true;
      sender.sinceMeta = 0;
      sender.sent = 0;
      var original = bytes;
      var meta = {
        name: sender.file.name.slice(0, 120),
        size: original.length,
        payloadSize: payload.length,
        sha256: hash,
        flags: flags,
        total: sender.total,
        chunkSize: sender.chunk,
        salt: salt,
        iv: iv
      };
      sender.metaMsg = CIM.buildMessage(1, sender.tid, sender.total, 0, CIM.buildMetaBody(meta), flags);
      sender.fps = parseInt($('fps').value, 10) || 6;
      sender.startedAt = Date.now();
      sender.running = true;
      sender.paused = false;
      stageEmpty.classList.add('hidden');
      $('statPayload').textContent = formatBytes(payload.length);
      $('statFrames').textContent = sender.total + ' 帧';
      $('startBtn').disabled = true;
      $('pauseBtn').disabled = false;
      $('stopBtn').disabled = false;
      $('fps').disabled = true;
      $('password').disabled = true;
      setLog($('senderLog'), '播放中。接收端请把整个色码放进取景框；漏帧时等下一轮。', 'ok');
      senderTick();
    } catch (err) {
      sender.running = false;
      $('startBtn').disabled = false;
      $('pauseBtn').disabled = true;
      $('stopBtn').disabled = true;
      setLog($('senderLog'), '启动失败：' + (err && err.message ? err.message : err), 'error');
      $('statState').textContent = '失败';
    }
  }

  $('startBtn').addEventListener('click', startSender);
  $('pauseBtn').addEventListener('click', function () {
    if (!sender.running) return;
    sender.paused = !sender.paused;
    $('pauseBtn').textContent = sender.paused ? '继续' : '暂停';
    $('statState').textContent = sender.paused ? '已暂停' : '播放中';
    if (!sender.paused) senderTick(); else stopSenderTimer();
  });
  $('stopBtn').addEventListener('click', function () {
    sender.running = false;
    sender.paused = false;
    stopSenderTimer();
    stageEmpty.classList.remove('hidden');
    $('startBtn').disabled = false;
    $('pauseBtn').disabled = true;
    $('stopBtn').disabled = true;
    $('pauseBtn').textContent = '暂停';
    $('fps').disabled = false;
    $('password').disabled = false;
    $('statState').textContent = '已停止';
    setLog($('senderLog'), '已停止播放。', '');
  });
  $('fullBtn').addEventListener('click', function () {
    if (senderStage.requestFullscreen) senderStage.requestFullscreen().catch(function () {});
  });

  /* ============================ 接收端 ============================ */
  var receiver = {
    stream: null, timer: 0, decoding: false,
    tid: 0, meta: null, total: 0, chunk: 0,
    chunks: new Map(), finishing: false, completed: false, lastError: '', errors: 0
  };
  var video = $('video');
  var scanCanvas = $('scanCanvas');
  var scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });

  function updateReceiveProgress() {
    var have = receiver.chunks.size;
    var total = receiver.total || 0;
    var pct = total ? Math.min(100, Math.round(have * 100 / total)) : 0;
    $('statHave').textContent = String(have);
    $('statTotal').textContent = total ? String(total) : '—';
    $('receivePercent').textContent = pct + '%';
    $('receiveBar').style.width = pct + '%';
    if (receiver.meta) {
      $('receiveName').textContent = receiver.meta.name;
      $('statSize').textContent = formatBytes(receiver.meta.size);
    }
  }

  function resetReceiver(clearMeta) {
    receiver.chunks = new Map();
    receiver.total = 0;
    receiver.chunk = 0;
    receiver.finishing = false;
    receiver.completed = false;
    receiver.lastError = '';
    if (clearMeta) {
      receiver.meta = null;
      receiver.tid = 0;
      $('receiveName').textContent = '等待发送端';
    }
    updateReceiveProgress();
  }

  async function finishReceive() {
    if (receiver.finishing || !receiver.meta) return;
    if (receiver.chunks.size < receiver.total) return;
    receiver.finishing = true;
    $('statReceive').textContent = '校验中';
    try {
      var meta = receiver.meta;
      var payload = new Uint8Array(meta.payloadSize);
      for (var i = 0; i < receiver.total; i++) {
        var part = receiver.chunks.get(i);
        if (!part) throw new Error('缺少分片 ' + (i + 1));
        payload.set(part, i * meta.chunkSize);
      }
      if (meta.flags & 2) {
        var password = $('receivePassword').value;
        if (!password) throw new Error('这是加密文件，请填写解密口令后重试');
        setLog($('receiveLog'), '解密中…');
        payload = await decryptBytes(payload, password, meta.salt, meta.iv);
      }
      if (meta.flags & 1) {
        setLog($('receiveLog'), (meta.flags & 4) ? 'zstd 解压中…' : 'gzip 解压中…');
        payload = await decompressPayload(payload, meta);
      }
      if (payload.length !== meta.size) throw new Error('文件长度不一致');
      var hash = await sha256(payload);
      var same = true;
      for (var h = 0; h < 32; h++) if (hash[h] !== meta.sha256[h]) { same = false; break; }
      if (!same) throw new Error('SHA-256 校验失败');
      downloadBytes(payload, meta.name);
      receiver.completed = true;
      $('statReceive').textContent = '完成';
      $('receivePercent').textContent = '100%';
      $('receiveBar').style.width = '100%';
      setLog($('receiveLog'), '完成：' + meta.name + ' · ' + formatBytes(meta.size) + ' · SHA-256 校验通过。', 'ok');
    } catch (err) {
      receiver.finishing = false;
      $('statReceive').textContent = '需重试';
      setLog($('receiveLog'), '接收失败：' + (err && err.message ? err.message : err), 'error');
    }
  }

  function handleMessage(frame) {
    if (receiver.completed || receiver.finishing) return;
    if (frame.type === 1) {
      var meta = CIM.parseMetaBody(frame.body);
      if (!meta) return;
      if (receiver.tid !== frame.transferId) {
        resetReceiver(true);
        receiver.tid = frame.transferId;
      }
      receiver.meta = meta;
      receiver.total = meta.total;
      receiver.chunk = meta.chunkSize;
      $('receiveName').textContent = meta.name;
      $('statSize').textContent = formatBytes(meta.size);
      if (meta.flags & 2) {
        setLog($('receiveLog'), '加密传输。请填写解密口令，收齐后会自动解密。', '');
      } else {
        setLog($('receiveLog'), '正在接收：' + meta.name + '，共 ' + meta.total + ' 帧。', '');
      }
      updateReceiveProgress();
      if (receiver.chunks.size >= receiver.total && receiver.total > 0) finishReceive();
      return;
    }
    if (frame.type === 2) {
      if (!receiver.tid || receiver.tid !== frame.transferId) {
        resetReceiver(true);
        receiver.tid = frame.transferId;
      }
      if (!receiver.total) receiver.total = frame.total;
      if (!receiver.chunk) receiver.chunk = CIM.BODY_MAX;
      if (frame.index >= receiver.total) return;
      if (!receiver.chunks.has(frame.index)) {
        receiver.chunks.set(frame.index, frame.body.slice());
        updateReceiveProgress();
      }
      if (receiver.meta && receiver.chunks.size >= receiver.total) finishReceive();
    }
  }

  function scanFrame() {
    if (receiver.decoding || !receiver.stream) return;
    if (video.readyState < 2 || !video.videoWidth) return;
    receiver.decoding = true;
    try {
      var vw = video.videoWidth, vh = video.videoHeight;
      var scale = Math.min(1280 / vw, 720 / vh);
      var dw = Math.round(vw * scale), dh = Math.round(vh * scale);
      scanCanvas.width = 1280;
      scanCanvas.height = 720;
      scanCtx.fillStyle = '#000';
      scanCtx.fillRect(0, 0, 1280, 720);
      scanCtx.drawImage(video, Math.round((1280 - dw) / 2), Math.round((720 - dh) / 2), dw, dh);
      var image = scanCtx.getImageData(0, 0, 1280, 720);
      var frame = CIM.decodeFrame(image, 1280, 720);
      if (frame && !frame.error) {
        receiver.lastError = '';
        handleMessage(frame);
      } else if (frame && frame.error && frame.error !== 'anchors') {
        receiver.errors++;
        if (receiver.lastError !== frame.error) {
          receiver.lastError = frame.error;
          $('statReceive').textContent = frame.error === 'ldpc' ? '纠错失败' : '解码失败';
        }
      }
    } catch (err) {
      // 单帧失败不终止摄像头。
    } finally {
      receiver.decoding = false;
    }
  }

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setLog($('receiveLog'), '当前浏览器不支持摄像头。请用 Chrome/Edge 打开 127.0.0.1 页面。', 'error');
      return;
    }
    $('cameraBtn').disabled = true;
    setLog($('receiveLog'), '正在请求摄像头权限…');
    try {
      receiver.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      video.srcObject = receiver.stream;
      await video.play();
      $('cameraEmpty').classList.add('hidden');
      $('cameraBtn').textContent = '重新打开';
      $('cameraBtn').disabled = false;
      $('statReceive').textContent = '扫描中';
      setLog($('receiveLog'), '摄像头已打开。把整个色码放进画面，保持稳定。');
      if (receiver.timer) clearInterval(receiver.timer);
      receiver.timer = setInterval(scanFrame, parseInt($('scanRate').value, 10) || 140);
    } catch (err) {
      $('cameraBtn').disabled = false;
      setLog($('receiveLog'), '无法打开摄像头：' + (err && err.message ? err.message : err), 'error');
    }
  }

  $('cameraBtn').addEventListener('click', startCamera);
  $('resetBtn').addEventListener('click', function () {
    resetReceiver(true);
    receiver.finishing = false;
    $('statReceive').textContent = receiver.stream ? '扫描中' : '等待';
    setLog($('receiveLog'), '进度已清空。');
  });
  $('scanRate').addEventListener('change', function () {
    if (receiver.timer) {
      clearInterval(receiver.timer);
      receiver.timer = setInterval(scanFrame, parseInt($('scanRate').value, 10) || 140);
    }
  });
  $('receivePassword').addEventListener('input', function () {
    if (receiver.meta && !receiver.finishing && receiver.chunks.size >= receiver.total) finishReceive();
  });
  window.addEventListener('beforeunload', function () {
    if (receiver.stream) receiver.stream.getTracks().forEach(function (t) { t.stop(); });
  });

  updateReceiveProgress();
  window.__HS = {
    sender: sender,
    receiver: receiver,
    compressPayload: compressPayload,
    decompressPayload: decompressPayload,
    encryptBytes: encryptBytes,
    decryptBytes: decryptBytes
  };
  setTimeout(function () { initZstd(); }, 400);
}());
