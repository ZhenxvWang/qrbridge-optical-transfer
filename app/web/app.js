/*
 * 码桥 QR Bridge - 界面与传输控制
 * 所有文件处理都在浏览器本地完成。
 */
(function () {
  'use strict';

  var C = window.QRBCore;
  var APP_VERSION = '2.1.0';

  if (!C) {
    document.body.innerHTML = '<main class="quit-screen"><h1>核心脚本加载失败</h1><p>请重新启动码桥。</p></main>';
    return;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function setText(id, text) {
    var el = $(id);
    if (el) el.textContent = text;
  }

  function toggle(el, show) {
    if (el) el.hidden = !show;
  }

  function formatBytes(bytes) {
    var value = Number(bytes) || 0;
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(value < 10 * 1024 ? 1 : 0) + ' KB';
    return (value / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function formatDuration(seconds) {
    seconds = Math.max(0, Math.round(Number(seconds) || 0));
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = seconds % 60;
    if (h > 0) return h + ':' + C.padNumber(m, 2) + ':' + C.padNumber(s, 2);
    return C.padNumber(m, 2) + ':' + C.padNumber(s, 2);
  }

  function formatPercent(value) {
    if (!isFinite(value)) return '0%';
    if (value > 0 && value < 0.1) return '<0.1%';
    if (value < 10) return value.toFixed(1) + '%';
    return Math.floor(value) + '%';
  }

  function extensionLabel(name) {
    var match = /\.([a-z0-9]{1,8})$/i.exec(String(name || ''));
    return match ? match[1].toUpperCase() : 'FILE';
  }

  function showToast(message, type, duration) {
    var stack = $('toastStack');
    if (!stack) return;
    var toast = document.createElement('div');
    toast.className = 'toast toast-' + (type || 'info');
    var icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = type === 'error' ? '!' : type === 'success' ? '✓' : 'i';
    var text = document.createElement('span');
    text.textContent = message;
    toast.appendChild(icon);
    toast.appendChild(text);
    stack.appendChild(toast);
    window.setTimeout(function () {
      toast.classList.add('is-leaving');
      window.setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 220);
    }, duration || 3600);
  }

  function readFileBytes(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(new Uint8Array(reader.result));
      };
      reader.onerror = function () {
        reject(reader.error || new Error('文件读取失败'));
      };
      reader.readAsArrayBuffer(file);
    });
  }

  /* ------------------------------------------------------------
   * 二维码生成与绘制
   * ---------------------------------------------------------- */

  function buildQR(text, version) {
    if (typeof window.qrcode !== 'function') {
      throw new Error('二维码组件未加载');
    }
    var qr = window.qrcode(version || 0, 'L');
    qr.addData(text, 'Alphanumeric');
    qr.make();
    return qr;
  }

  function drawQRToRegion(ctx, qr, x, y, width, height) {
    var count = qr.getModuleCount();
    var quiet = 4;
    var scale = Math.max(1, Math.floor(Math.min(width, height) / (count + quiet * 2)));
    var qrPixels = count * scale;
    var offsetX = x + Math.floor((width - qrPixels) / 2);
    var offsetY = y + Math.floor((height - qrPixels) / 2);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = '#071522';
    for (var row = 0; row < count; row++) {
      for (var col = 0; col < count; col++) {
        if (qr.isDark(row, col)) {
          ctx.fillRect(offsetX + col * scale, offsetY + row * scale, scale, scale);
        }
      }
    }
    return count;
  }

  function resetCanvas(canvas) {
    var ctx = canvas.getContext('2d');
    canvas.width = 1280;
    canvas.height = 720;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return ctx;
  }

  function drawSingleCanvas(canvas, qr, boxSize) {
    var ctx = resetCanvas(canvas);
    var box = boxSize || 680;
    var count = drawQRToRegion(ctx, qr, (canvas.width - box) / 2, (canvas.height - box) / 2, box, box);
    canvas.setAttribute('data-modules', String(count));
  }

  function drawQuadCanvas(canvas, qrs) {
    var ctx = resetCanvas(canvas);
    var quadrantWidth = 640;
    var quadrantHeight = 360;
    var box = 352;
    var positions = [
      [0, 0], [quadrantWidth, 0],
      [0, quadrantHeight], [quadrantWidth, quadrantHeight]
    ];
    for (var i = 0; i < positions.length; i++) {
      var left = positions[i][0] + (quadrantWidth - box) / 2;
      var top = positions[i][1] + (quadrantHeight - box) / 2;
      drawQRToRegion(ctx, qrs[i], left, top, box, box);
    }
    canvas.setAttribute('data-modules', String(qrs[0].getModuleCount()));
  }

  /* ------------------------------------------------------------
   * 标签页切换
   * ---------------------------------------------------------- */

  var activeMode = 'send';

  function switchMode(mode) {
    if (mode === activeMode) return;
    activeMode = mode;

    var isSend = mode === 'send';
    $('tabSend').classList.toggle('is-active', isSend);
    $('tabReceive').classList.toggle('is-active', !isSend);
    $('tabSend').setAttribute('aria-selected', isSend ? 'true' : 'false');
    $('tabReceive').setAttribute('aria-selected', isSend ? 'false' : 'true');
    toggle($('panelSend'), isSend);
    toggle($('panelReceive'), !isSend);

    if (isSend) {
      if (receive.scanning) {
        stopCamera(true);
        showToast('已暂停摄像头扫描', 'info');
      }
    } else {
      if (send.playing) {
        pauseSend(false);
        showToast('发送已暂停；切换回发送页可继续', 'info');
      }
    }
    if (!document.fullscreenElement && window.scrollTo) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  $('tabSend').addEventListener('click', function () { switchMode('send'); });
  $('tabReceive').addEventListener('click', function () { switchMode('receive'); });

  /* ------------------------------------------------------------
   * 发送端
   * ---------------------------------------------------------- */

  var send = {
    file: null,
    data: null,
    payload: null,
    payloadSize: 0,
    flags: 0,
    compressed: false,
    profileId: 'balanced',
    channels: C.DEFAULT_CHANNELS,
    fps: 5,
    transferId: '',
    total: 0,
    chunkSize: 0,
    chunkSizeProfile: 0,
    qrVersion: 15,
    sha256: '',
    metaText: '',
    dataIndex: 0,
    groupCount: 0,
    cycle: 0,
    manualTargets: null,
    manualIndex: 0,
    manualNeedMeta: false,
    playing: false,
    timer: null,
    needMeta: true,
    wakeLock: null,
    lastRenderAt: 0,
    renderedFrames: 0
  };

  function currentProfile() {
    return C.PROFILES[send.profileId] || C.PROFILES.balanced;
  }

  function setSelectedFile(file) {
    if (!file) return;
    if (file.size <= 0) {
      showToast('不能发送空文件', 'error');
      return;
    }
    if (file.size > C.MAX_FILE_BYTES) {
      showToast('文件超过 8 MB 限制，请先压缩或分割', 'error');
      return;
    }

    stopSend(false);
    send.file = file;
    setText('fileName', file.name);
    setText('fileMeta', formatBytes(file.size) + ' · ' + (file.type || '未知类型'));
    setText('fileType', extensionLabel(file.name));
    toggle($('fileCard'), true);
    toggle($('sendStats'), false);
    toggle($('qrLive'), false);
    toggle($('qrEmpty'), true);
    $('startSendBtn').disabled = false;
    $('startSendBtn').querySelector('span').textContent = '开始播放二维码';
  }

  function clearSelectedFile() {
    stopSend(false);
    send.file = null;
    send.data = null;
    $('fileInput').value = '';
    toggle($('fileCard'), false);
    toggle($('sendStats'), false);
    toggle($('qrLive'), false);
    toggle($('qrEmpty'), true);
    $('startSendBtn').disabled = true;
    $('startSendBtn').querySelector('span').textContent = '开始播放二维码';
  }

  $('fileInput').addEventListener('change', function (event) {
    if (event.target.files && event.target.files[0]) setSelectedFile(event.target.files[0]);
  });

  $('clearFileBtn').addEventListener('click', clearSelectedFile);

  var dropZone = $('dropZone');
  ['dragenter', 'dragover'].forEach(function (name) {
    dropZone.addEventListener(name, function (event) {
      event.preventDefault();
      dropZone.classList.add('is-dragging');
    });
  });
  ['dragleave', 'drop'].forEach(function (name) {
    dropZone.addEventListener(name, function (event) {
      event.preventDefault();
      dropZone.classList.remove('is-dragging');
    });
  });
  dropZone.addEventListener('drop', function (event) {
    if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]) {
      setSelectedFile(event.dataTransfer.files[0]);
    }
  });
  dropZone.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      $('fileInput').click();
    }
  });

  Array.prototype.forEach.call(document.querySelectorAll('#profileGroup .segment'), function (button) {
    button.addEventListener('click', function () {
      var wasActive = send.total > 0;
      if (wasActive) {
        pauseSend(false);
        stopSend(false);
        showToast('已切换传输档位，请重新点击开始播放', 'info');
      }
      send.profileId = button.getAttribute('data-profile');
      Array.prototype.forEach.call(document.querySelectorAll('#profileGroup .segment'), function (other) {
        other.classList.toggle('is-active', other === button);
      });
      setText('profileHint', currentProfile().hint);
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll('#channelGroup .segment'), function (button) {
    button.addEventListener('click', function () {
      if (send.total > 0) {
        pauseSend(false);
        stopSend(false);
        showToast('已切换并行路数，请重新点击开始播放', 'info');
      }
      send.channels = parseInt(button.getAttribute('data-channels'), 10) === 1 ? 1 : 4;
      Array.prototype.forEach.call(document.querySelectorAll('#channelGroup .segment'), function (other) {
        other.classList.toggle('is-active', other === button);
      });
      setText('channelHint', send.channels === 4 ? '4 路并行，建议全屏显示' : '单码模式，兼容性优先');
    });
  });

  $('fpsRange').addEventListener('input', function (event) {
    send.fps = parseInt(event.target.value, 10) || 5;
    setText('fpsOutput', send.fps + ' 帧/秒');
    if (send.playing) restartSendTimer();
    updateSendProgress();
  });

  function restartSendTimer() {
    if (send.timer) {
      window.clearInterval(send.timer);
      send.timer = null;
    }
    if (send.playing) {
      send.timer = window.setInterval(renderNextFrame, Math.max(60, Math.round(1000 / send.fps)));
    }
  }

  function updatePlayState() {
    var state = $('playState');
    if (send.playing) {
      state.classList.add('is-live');
      state.innerHTML = '<span class="dot"></span>播放中';
      $('pauseSendBtn').querySelector('span').textContent = '暂停';
      toggle($('pauseCover'), false);
    } else {
      state.classList.remove('is-live');
      state.innerHTML = '<span class="dot"></span>已暂停';
      $('pauseSendBtn').querySelector('span').textContent = '继续';
      toggle($('pauseCover'), true);
    }
  }

  function updateSendProgress() {
    if (!send.total) return;
    if (send.manualTargets && send.manualTargets.length) {
      var count = send.manualTargets.length;
      var done = send.manualIndex % count;
      if (done === 0 && send.manualIndex > 0) done = count;
      $('sendProgressBar').style.width = ((done / count) * 100).toFixed(2) + '%';
      setText('sendProgressText', '补帧 ' + done + ' / ' + count + ' 分片');
      setText('cycleText', '补帧模式 · ' + send.fps + ' 帧/秒');
      return;
    }
    var percent = Math.min(100, (send.dataIndex / send.total) * 100);
    $('sendProgressBar').style.width = percent.toFixed(2) + '%';
    setText('sendProgressText', send.dataIndex + ' / ' + send.total + ' 分片');
    setText('cycleText', '第 ' + Math.max(1, send.cycle) + ' 轮 · ' + (send.channels === 4 ? '4 路' : '单码') + ' · ' + send.fps + ' 帧/秒');
  }

  function dataFrameText(index) {
    var start = index * send.chunkSize;
    var payload = new Uint8Array(send.chunkSize);
    payload.set(send.payload.subarray(start, Math.min(start + send.chunkSize, send.payloadSize)));
    return C.makeDataFrame({
      transferId: send.transferId,
      total: send.total,
      chunkSize: send.chunkSize,
      index: index,
      channels: send.channels,
      payload: payload
    });
  }

  function setManualUi(active) {
    $('manualSendBtn').classList.toggle('is-active', !!active);
    setText('manualSendLabel', active ? '退出补帧' : '补帧');
    $('manualSendBtn').title = active ? '恢复完整顺序循环' : '只循环播放指定的缺失分片';
  }

  function renderMetaFrame(label) {
    var qr = buildQR(send.metaText, 0);
    drawSingleCanvas($('qrCanvas'), qr, 700);
    setText('qrFrameLabel', label);
    send.renderedFrames += 1;
    send.lastRenderAt = Date.now();
    updateSendProgress();
  }

  function renderDataGroup(indices) {
    var qrs = [];
    for (var i = 0; i < indices.length; i++) {
      qrs.push(buildQR(dataFrameText(indices[i]), send.qrVersion));
    }
    if (send.channels === 4) {
      drawQuadCanvas($('qrCanvas'), qrs);
      if (send.manualTargets && send.manualTargets.length) {
        var unique = [];
        var seen = {};
        for (var u = 0; u < indices.length; u++) {
          var labelIndex = indices[u] + 1;
          if (!seen[labelIndex]) {
            seen[labelIndex] = true;
            unique.push(C.padNumber(labelIndex, 3));
          }
        }
        setText('qrFrameLabel', '补帧 · ' + unique.join(' / '));
      } else {
        var first = indices[0] + 1;
        var last = indices[indices.length - 1] + 1;
        var contiguous = last - first === indices.length - 1;
        setText('qrFrameLabel', contiguous
          ? '4 路 · 分片 ' + C.padNumber(first, 3) + '–' + C.padNumber(last, 3) + ' / ' + send.total
          : '4 路 · ' + indices.map(function (index) { return C.padNumber(index + 1, 3); }).join(' / ') + ' / ' + send.total);
      }
    } else {
      drawSingleCanvas($('qrCanvas'), qrs[0], 680);
      setText('qrFrameLabel', '分片 ' + C.padNumber(indices[0] + 1, 3) + ' / ' + send.total);
    }
    send.renderedFrames += indices.length;
    send.lastRenderAt = Date.now();
    updateSendProgress();
  }

  function renderNextFrame() {
    if (!send.playing || !send.total) return;
    var manual = send.manualTargets && send.manualTargets.length > 0;

    try {
      if (manual) {
        if (send.manualNeedMeta) {
          renderMetaFrame('文件信息 · 补帧模式');
          send.manualNeedMeta = false;
          return;
        }
        var targets = [];
        for (var t = 0; t < send.channels; t++) {
          targets.push(send.manualTargets[(send.manualIndex + t) % send.manualTargets.length]);
        }
        renderDataGroup(targets);
        send.manualIndex += send.channels;
        if (send.manualIndex % (20 * send.channels) === 0) send.manualNeedMeta = true;
        return;
      }

      if (send.needMeta) {
        renderMetaFrame('文件信息 · 等待接收端锁定');
        send.needMeta = false;
        return;
      }

      var indices = [];
      var start = send.dataIndex;
      for (var k = 0; k < send.channels; k++) {
        indices.push((start + k) % send.total);
      }
      send.dataIndex = start + send.channels;
      if (send.dataIndex >= send.total) {
        send.dataIndex = 0;
        send.cycle += 1;
        send.needMeta = true;
      }
      send.groupCount += 1;
      if (send.groupCount % C.META_GROUP_EVERY === 0) send.needMeta = true;
      renderDataGroup(indices);
    } catch (error) {
      pauseSend(false);
      showToast('生成二维码失败：' + (error && error.message ? error.message : '文件信息过长'), 'error', 6000);
    }
  }

  function requestWakeLock() {
    if (!('wakeLock' in navigator) || send.wakeLock) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      send.wakeLock = lock;
      lock.addEventListener('release', function () {
        send.wakeLock = null;
      });
    }).catch(function () {
      /* 部分系统不支持，忽略即可 */
    });
  }

  function releaseWakeLock() {
    if (send.wakeLock) {
      send.wakeLock.release().catch(function () {});
      send.wakeLock = null;
    }
  }

  function playSend() {
    if (!send.total || send.playing) return;
    send.playing = true;
    updatePlayState();
    requestWakeLock();
    restartSendTimer();
    renderNextFrame();
  }

  function pauseSend(showMessage) {
    if (!send.playing) return;
    send.playing = false;
    if (send.timer) {
      window.clearInterval(send.timer);
      send.timer = null;
    }
    releaseWakeLock();
    updatePlayState();
    if (showMessage !== false) showToast('已暂停播放', 'info', 1800);
  }

  function stopSend(showMessage) {
    pauseSend(false);
    send.data = null;
    send.payload = null;
    send.payloadSize = 0;
    send.flags = 0;
    send.compressed = false;
    send.transferId = '';
    send.total = 0;
    send.dataIndex = 0;
    send.groupCount = 0;
    send.cycle = 0;
    send.needMeta = true;
    send.manualTargets = null;
    send.manualIndex = 0;
    send.manualNeedMeta = false;
    setManualUi(false);
    send.metaText = '';
    $('sendLayout').classList.remove('is-broadcasting');
    $('sendStage').classList.remove('is-multi');
    toggle($('qrLive'), false);
    toggle($('qrEmpty'), true);
    toggle($('sendStats'), false);
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(function () {});
    }
    if (showMessage !== false) showToast('已停止发送', 'info', 1800);
  }

  function setStartButtonBusy(busy, text) {
    var button = $('startSendBtn');
    button.disabled = busy || !send.file;
    button.classList.toggle('is-busy', busy);
    button.querySelector('span').textContent = text || (busy ? '正在准备…' : '开始播放二维码');
  }

  function startSend() {
    if (!send.file || send.playing) return;
    var file = send.file;
    setStartButtonBusy(true, '正在读取、压缩与校验…');

    readFileBytes(file).then(function (data) {
      if (send.file !== file) throw new Error('文件已更换，请重新点击开始');
      var profile = currentProfile();
      var prepared = C.preparePayload(data);
      var payload = prepared.payload;
      var total = C.totalChunks(payload.length, profile.chunkSize);
      if (total < 1) throw new Error('空文件无法发送');
      if (total > C.MAX_CHUNKS) throw new Error('分片数量超过上限，请压缩文件');
      return C.sha256Hex(data).then(function (hash) {
        send.data = data;
        send.payload = payload;
        send.payloadSize = payload.length;
        send.flags = prepared.flags;
        send.compressed = prepared.flags === 1;
        send.profileId = profile.id;
        send.chunkSize = profile.chunkSize;
        send.chunkSizeProfile = profile.qrVersion;
        send.qrVersion = profile.qrVersion;
        send.total = total;
        send.sha256 = hash;
        send.transferId = C.randomTransferId();
        send.metaText = C.makeMetaFrame({
          transferId: send.transferId,
          total: total,
          chunkSize: profile.chunkSize,
          fileName: file.name,
          fileSize: data.length,
          payloadSize: payload.length,
          sha256: hash,
          flags: prepared.flags,
          channels: send.channels
        });

        send.dataIndex = 0;
        send.groupCount = 0;
        send.cycle = 1;
        send.needMeta = true;
        send.manualTargets = null;
        send.manualIndex = 0;
        send.manualNeedMeta = false;
        setManualUi(false);
        send.renderedFrames = 0;

        var sizeText = formatBytes(data.length);
        if (prepared.flags === 1) sizeText += ' → ' + formatBytes(payload.length);
        setText('statSize', sizeText);
        setText('statChunks', total + ' 片 · ' + profile.label + '档 · ' + (send.channels === 4 ? '4 路' : '单码'));
        setText('statVersion', 'v' + profile.qrVersion + ' · ' + (17 + profile.qrVersion * 4) + '×' + (17 + profile.qrVersion * 4) + (send.channels === 4 ? ' ×4' : ''));
        setText('statRound', formatDuration(C.estimateRoundSeconds(total, send.fps, send.channels)));
        var shortHash = hash.slice(0, 16) + '…' + hash.slice(-8);
        setText('statSha', shortHash);
        $('statSha').title = hash;
        toggle($('sendStats'), true);
        toggle($('qrEmpty'), false);
        toggle($('qrLive'), true);
        $('sendLayout').classList.add('is-broadcasting');
        $('sendStage').classList.toggle('is-multi', send.channels === 4);
        $('startSendBtn').querySelector('span').textContent = '重新开始播放';

        playSend();
        $('sendStage').scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }).catch(function (error) {
      showToast('无法开始发送：' + (error && error.message ? error.message : '未知错误'), 'error', 6000);
    }).then(function () {
      setStartButtonBusy(false, send.playing ? '重新开始播放' : '开始播放二维码');
    });
  }

  $('startSendBtn').addEventListener('click', function () {
    if (send.playing) {
      pauseSend(false);
      stopSend(false);
      startSend();
    } else {
      startSend();
    }
  });

  $('pauseSendBtn').addEventListener('click', function () {
    if (send.playing) pauseSend(true);
    else playSend();
  });

  $('stopSendBtn').addEventListener('click', function () {
    stopSend(true);
    if (send.file) $('startSendBtn').querySelector('span').textContent = '重新开始播放';
  });

  function parseTargetList(raw, total) {
    var indexes = [];
    var seen = {};
    String(raw || '').split(/[\s,，;；、]+/).forEach(function (token) {
      var match = /^(\d+)(?:\s*[-~至]\s*(\d+))?$/.exec(token);
      if (!match) return;
      var first = parseInt(match[1], 10);
      var last = match[2] ? parseInt(match[2], 10) : first;
      if (!isFinite(first) || !isFinite(last)) return;
      if (first > last) {
        var swap = first;
        first = last;
        last = swap;
      }
      first = Math.max(1, first);
      last = Math.min(total, last);
      for (var value = first; value <= last && indexes.length < 5000; value++) {
        if (!seen[value]) {
          seen[value] = true;
          indexes.push(value - 1);
        }
      }
    });
    return indexes;
  }

  $('manualSendBtn').addEventListener('click', function () {
    if (send.manualTargets) {
      send.manualTargets = null;
      send.manualIndex = 0;
      send.manualNeedMeta = false;
      send.needMeta = true;
      setManualUi(false);
      updateSendProgress();
      showToast('已退出补帧模式，恢复完整顺序循环', 'info');
      if (!send.playing && send.total) playSend();
      return;
    }
    if (!send.total) {
      showToast('请先开始播放一个文件，再使用补帧', 'info');
      return;
    }
    var raw = window.prompt('输入接收端缺失的分片编号（从 1 开始，可写 3,7,12-15）：', '');
    if (raw === null) return;
    var targets = parseTargetList(raw, send.total);
    if (!targets.length) {
      showToast('没有识别到有效的分片编号', 'error');
      return;
    }
    send.manualTargets = targets;
    send.manualIndex = 0;
    send.manualNeedMeta = true;
    setManualUi(true);
    updateSendProgress();
    if (!send.playing) playSend();
    showToast('补帧模式：循环播放 ' + targets.length + ' 个指定分片', 'success', 4500);
  });

  function toggleFullscreen() {
    var stage = $('sendStage');
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(function () {});
    } else if (stage.requestFullscreen) {
      stage.requestFullscreen().catch(function () {
        showToast('当前浏览器不支持全屏，请按 F11 全屏', 'info');
      });
    } else {
      showToast('当前浏览器不支持全屏，请按 F11 全屏', 'info');
    }
  }

  $('fullscreenBtn').addEventListener('click', toggleFullscreen);

  document.addEventListener('fullscreenchange', function () {
    var active = !!document.fullscreenElement;
    document.body.classList.toggle('qr-fullscreen', active);
    var button = $('fullscreenBtn');
    if (button) {
      setText('fullscreenLabel', active ? '退出全屏' : '全屏');
    }
  });

  /* ------------------------------------------------------------
   * 接收端
   * ---------------------------------------------------------- */

  var receive = {
    transferId: '',
    total: 0,
    chunkSize: 0,
    payloadSize: 0,
    compressed: false,
    channels: 4,
    meta: null,
    chunks: null,
    haveFlags: null,
    haveCount: 0,
    startedAt: 0,
    complete: false,
    finalizing: false,
    hashMismatch: false,
    blob: null,
    blobUrl: '',
    generation: 0,
    scanning: false,
    stream: null,
    rafId: 0,
    lastScanAt: 0,
    bestCropScale: 1,
    scanCount: 0,
    framesSeen: 0,
    duplicates: 0,
    invalidFrames: 0,
    scanStartedAt: 0,
    statTimer: null,
    flashTimer: null,
    lastChunkDrawAt: 0,
    wakeLock: null,
    selectedDeviceId: ''
  };

  function resetReceiveState(keepCamera) {
    receive.generation += 1;
    receive.transferId = '';
    receive.total = 0;
    receive.chunkSize = 0;
    receive.payloadSize = 0;
    receive.compressed = false;
    receive.channels = 4;
    receive.meta = null;
    receive.chunks = null;
    receive.haveFlags = null;
    receive.haveCount = 0;
    receive.startedAt = 0;
    receive.complete = false;
    receive.finalizing = false;
    receive.hashMismatch = false;
    receive.blob = null;
    if (receive.blobUrl) {
      URL.revokeObjectURL(receive.blobUrl);
      receive.blobUrl = '';
    }
    receive.framesSeen = 0;
    receive.duplicates = 0;
    receive.invalidFrames = 0;
    receive.scanCount = 0;
    receive.scanStartedAt = receive.scanning ? Date.now() : 0;
    receive.lastChunkDrawAt = 0;

    toggle($('receiveEmpty'), true);
    toggle($('receiveLive'), false);
    toggle($('completeCard'), false);
    $('recvProgressBar').style.width = '0%';
    setText('recvPercent', '0%');
    setText('recvFileName', '等待文件信息…');
    setText('recvFileMeta', '—');
    setText('recvFileType', 'FILE');
    setText('recvProgressText', '0 / 0 分片');
    setText('recvStatusText', keepCamera && receive.scanning ? '等待二维码…' : '摄像头未开启');
    setText('recvBytes', '0 B');
    setText('recvRate', '0 帧/秒');
    setText('recvDup', '0');
    setText('recvElapsed', '00:00');
    setText('saveFileLabel', '保存文件');
    if (!receive.scanning) {
      $('cameraPlaceholder').querySelector('strong').textContent = '等待开启摄像头';
      $('cameraPlaceholder').querySelector('small').textContent = '允许浏览器使用摄像头后，把二维码放入取景框';
    }
    drawChunkMatrix();
    updateCameraStatus();
  }

  function initTransfer(frame) {
    receive.generation += 1;
    receive.transferId = frame.transferId;
    receive.total = frame.total;
    receive.chunkSize = frame.chunkSize;
    receive.channels = frame.channels || 4;
    receive.chunks = new Array(frame.total);
    receive.haveFlags = new Uint8Array(frame.total);
    receive.haveCount = 0;
    receive.startedAt = Date.now();
    receive.complete = false;
    receive.finalizing = false;
    receive.hashMismatch = false;
    receive.meta = null;
    receive.framesSeen = 0;
    receive.duplicates = 0;
    receive.invalidFrames = 0;
    receive.scanStartedAt = receive.scanning ? Date.now() : 0;

    toggle($('receiveEmpty'), false);
    toggle($('receiveLive'), true);
    toggle($('completeCard'), false);
    setText('recvFileType', extensionLabel('待接收文件'));
    setText('recvFileName', '传输 ' + frame.transferId);
    setText('recvFileMeta', (receive.channels === 4 ? '4 路并行 · ' : '单码 · ') + frame.chunkSize + ' B/帧');
    setText('recvStatusText', '正在接收分片…');
    drawChunkMatrix();
    updateReceiveProgress();
  }

  function updateReceiveFileMeta() {
    if (!receive.meta) return;
    setText('recvFileName', receive.meta.fileName);
    setText('recvFileType', extensionLabel(receive.meta.fileName));
    var sizeText = formatBytes(receive.meta.fileSize);
    if (receive.meta.compressed) sizeText += ' → ' + formatBytes(receive.payloadSize);
    setText('recvFileMeta', sizeText + ' · ' + (receive.channels === 4 ? '4 路 · ' : '单码 · ') + receive.chunkSize + ' B/帧');
  }

  function updateReceiveProgress() {
    if (!receive.total) return;
    var percent = (receive.haveCount / receive.total) * 100;
    $('recvProgressBar').style.width = percent.toFixed(2) + '%';
    setText('recvPercent', formatPercent(percent));
    setText('recvProgressText', receive.haveCount + ' / ' + receive.total + ' 分片');
    if (receive.complete) {
      setText('recvStatusText', receive.hashMismatch ? '校验未通过' : '接收完成');
    } else if (receive.haveCount === receive.total) {
      setText('recvStatusText', '数据已收齐，等待文件信息…');
    } else if (receive.scanning) {
      setText('recvStatusText', '正在接收分片…');
    } else {
      setText('recvStatusText', '扫描已暂停');
    }

    var bytes = receive.haveCount * receive.chunkSize;
    if (receive.meta) bytes = Math.min(receive.payloadSize, bytes);
    else if (receive.total) bytes = Math.min(receive.total * receive.chunkSize, bytes);
    setText('recvBytes', formatBytes(bytes));
    if (receive.startedAt) setText('recvElapsed', formatDuration((Date.now() - receive.startedAt) / 1000));
    if (receive.scanStartedAt && receive.framesSeen) {
      var seconds = Math.max(0.5, (Date.now() - receive.scanStartedAt) / 1000);
      setText('recvRate', (receive.framesSeen / seconds).toFixed(1) + ' 帧/秒');
    }
    setText('recvDup', String(receive.duplicates));
    var now = Date.now();
    if (receive.total <= 2000 || receive.complete || now - receive.lastChunkDrawAt > 250) {
      receive.lastChunkDrawAt = now;
      drawChunkMatrix();
    }
  }

  function drawChunkMatrix() {
    var canvas = $('chunkCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var width = canvas.width;
    var height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#edf3f8';
    ctx.fillRect(0, 0, width, height);
    if (!receive.total) return;

    var ratio = width / height;
    var cols = Math.max(1, Math.ceil(Math.sqrt(receive.total * ratio)));
    var rows = Math.max(1, Math.ceil(receive.total / cols));
    var cellLimit = receive.total <= 60 ? 34 : 16;
    var cellW = Math.min(cellLimit, width / cols);
    var cellH = Math.min(cellLimit, height / rows);
    var gridW = cellW * cols;
    var gridH = cellH * rows;
    var originX = (width - gridW) / 2;
    var originY = (height - gridH) / 2;
    var gap = receive.total <= 240 ? 1.5 : 0;
    for (var i = 0; i < receive.total; i++) {
      if (!receive.haveFlags[i]) continue;
      var row = Math.floor(i / cols);
      var col = i % cols;
      ctx.fillStyle = receive.complete && receive.hashMismatch ? '#d97706' : '#0f9f8f';
      ctx.fillRect(
        originX + col * cellW + gap,
        originY + row * cellH + gap,
        Math.max(1, cellW - gap * 2),
        Math.max(1, cellH - gap * 2)
      );
    }
  }

  function applyMetadata(frame) {
    if (!receive.transferId) initTransfer(frame);
    if (frame.total !== receive.total || frame.chunkSize !== receive.chunkSize) return false;
    if (frame.fileSize > C.MAX_FILE_BYTES || frame.payloadSize > C.MAX_FILE_BYTES) {
      showToast('接收端拒绝：文件超过 8 MB 限制', 'error');
      return false;
    }
    receive.payloadSize = frame.payloadSize;
    receive.compressed = !!frame.compressed;
    receive.channels = frame.channels || receive.channels;
    receive.meta = {
      fileName: C.safeFileName(frame.fileName),
      fileSize: frame.fileSize,
      payloadSize: frame.payloadSize,
      compressed: !!frame.compressed,
      sha256: frame.sha256,
      channels: frame.channels
    };
    updateReceiveFileMeta();
    updateReceiveProgress();
    maybeFinalize();
    return true;
  }

  function maybeFinalize() {
    if (!receive.total || receive.complete || receive.finalizing) return;
    if (receive.haveCount !== receive.total || !receive.meta) return;
    finalizeReceive();
  }

  function finalizeReceive() {
    receive.finalizing = true;
    var generation = receive.generation;
    var rawPayload;
    var output;
    try {
      rawPayload = C.assemble(receive.chunks, receive.meta.payloadSize);
      output = receive.meta.compressed ? C.gunzipBytes(rawPayload) : rawPayload;
    } catch (error) {
      receive.finalizing = false;
      showToast('解压/合并文件失败：' + (error && error.message ? error.message : '数据不完整'), 'error', 6000);
      setText('recvStatusText', '解压失败');
      return;
    }
    if (output.length !== receive.meta.fileSize) {
      receive.finalizing = false;
      setText('recvStatusText', '文件长度校验失败');
      showToast('解压后的文件长度与发送端不一致，请重新接收', 'error', 6000);
      return;
    }

    setText('recvStatusText', '正在校验 SHA-256…');
    C.sha256Hex(output).then(function (hash) {
      if (generation !== receive.generation) return;
      var ok = hash.toLowerCase() === receive.meta.sha256.toLowerCase();
      receive.complete = true;
      receive.finalizing = false;
      receive.hashMismatch = !ok;
      receive.blob = new Blob([output], { type: C.mimeForName(receive.meta.fileName) });
      if (receive.blobUrl) URL.revokeObjectURL(receive.blobUrl);
      receive.blobUrl = URL.createObjectURL(receive.blob);

      if (receive.scanning) stopCamera(true);
      toggle($('receiveLive'), false);
      toggle($('completeCard'), true);
      $('completeIcon').classList.toggle('is-error', !ok);
      setText('completeKicker', ok ? '传输完成' : '校验未通过');
      setText('completeTitle', ok ? '文件已完整接收' : '文件可能不完整');
      setText('completeText', ok
        ? (receive.meta.compressed
          ? 'gzip 解压完成，SHA-256 校验通过，文件已准备好保存到本机。'
          : 'SHA-256 校验通过，文件已准备好保存到本机。')
        : '收到的分片已合并，但 SHA-256 与发送端不一致。建议点击“继续接收”后重新扫描；也可以仍然保存，但文件可能损坏。');
      setText('completeFileType', extensionLabel(receive.meta.fileName));
      setText('completeFileName', receive.meta.fileName);
      var completeMeta = formatBytes(receive.meta.fileSize);
      if (receive.meta.compressed) completeMeta += ' · 传输 ' + formatBytes(receive.meta.payloadSize) + '（gzip）';
      completeMeta += ' · SHA-256 ' + hash.slice(0, 12) + '…' + hash.slice(-6);
      setText('completeFileMeta', completeMeta);
      $('saveFileLabel').textContent = ok ? '保存文件' : '仍然保存';
      showToast(ok ? '接收完成，文件校验通过' : '文件校验失败，请重新接收', ok ? 'success' : 'error', 5000);
      updateReceiveProgress();
      $('completeCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }).catch(function (error) {
      if (generation !== receive.generation) return;
      receive.finalizing = false;
      setText('recvStatusText', '校验失败');
      showToast('SHA-256 校验不可用：' + (error && error.message ? error.message : '未知错误'), 'error', 6000);
    });
  }

  function handleFrameText(text, source) {
    var frame = C.parseFrame(text);
    if (!frame) {
      receive.invalidFrames += 1;
      if (source === 'image') showToast('这张图片里的二维码不是码桥分片', 'error');
      return false;
    }

    if (receive.complete && frame.transferId !== receive.transferId) {
      showToast('已接收完成，请先点击“继续接收下一个文件”', 'info');
      return false;
    }

    if (receive.transferId && frame.transferId !== receive.transferId) {
      if (receive.haveCount > 0 && !receive.complete) {
        showToast('检测到新的传输，已自动重置接收进度', 'info');
      }
      resetReceiveState(true);
    }

    if (!receive.transferId) {
      initTransfer(frame);
    } else if (frame.total !== receive.total || frame.chunkSize !== receive.chunkSize || (frame.channels && frame.channels !== receive.channels)) {
      resetReceiveState(true);
      initTransfer(frame);
    }

    receive.framesSeen += 1;
    receive.scanStartedAt = receive.scanStartedAt || Date.now();

    if (frame.kind === 'meta') {
      applyMetadata(frame);
      return true;
    }

    if (frame.kind === 'data') {
      if (receive.haveFlags[frame.index]) {
        receive.duplicates += 1;
        setText('recvDup', String(receive.duplicates));
        return false;
      }
      receive.haveFlags[frame.index] = 1;
      receive.chunks[frame.index] = frame.payload;
      receive.haveCount += 1;
      flashCamera();
      updateReceiveProgress();
      maybeFinalize();
      return true;
    }

    return false;
  }

  function flashCamera() {
    var flash = $('cameraFlash');
    flash.classList.add('is-active');
    if (receive.flashTimer) window.clearTimeout(receive.flashTimer);
    receive.flashTimer = window.setTimeout(function () {
      flash.classList.remove('is-active');
    }, 120);
  }

  function updateCameraStatus() {
    var chip = $('cameraStatus');
    var text;
    if (receive.complete) text = '接收完成';
    else if (receive.scanning) text = '扫描中';
    else text = '摄像头未开启';
    chip.innerHTML = '<span class="dot"></span>' + text;
    chip.classList.toggle('is-live', receive.scanning);
    chip.classList.toggle('is-done', receive.complete);
  }

  function requestReceiveWakeLock() {
    if (!('wakeLock' in navigator) || receive.wakeLock) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      receive.wakeLock = lock;
      lock.addEventListener('release', function () {
        receive.wakeLock = null;
      });
    }).catch(function () {
      /* 部分系统不支持，忽略即可 */
    });
  }

  function releaseReceiveWakeLock() {
    if (receive.wakeLock) {
      receive.wakeLock.release().catch(function () {});
      receive.wakeLock = null;
    }
  }

  function attachCameraStream(stream) {
    if (receive.stream) {
      receive.stream.getTracks().forEach(function (track) { track.stop(); });
    }
    receive.stream = stream;
    requestReceiveWakeLock();
    var video = $('cameraVideo');
    video.srcObject = stream;
    video.muted = true;
    video.setAttribute('playsinline', '');
    video.play().catch(function () {});

    toggle($('cameraPlaceholder'), false);
    toggle($('scanGuide'), true);
    $('startCameraBtn').hidden = true;
    $('stopCameraBtn').hidden = false;
    $('cameraStage').classList.add('is-live');
    $('cameraSelect').disabled = false;
    receive.scanning = true;
    receive.scanStartedAt = Date.now();
    receive.lastScanAt = 0;
    updateCameraStatus();
    startScanLoop();
    listCameras();
    if (!receive.transferId) {
      setText('recvStatusText', '等待二维码…');
    }
  }

  function cameraErrorMessage(error) {
    var name = error && error.name ? error.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return '摄像头权限被拒绝。请点击地址栏的摄像头图标并允许访问，或到系统隐私设置中授权。';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return '没有检测到摄像头。可以改用“从图片识别”，或连接 USB 摄像头后重试。';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return '摄像头被其他程序占用，请关闭会议软件或相机应用后重试。';
    }
    if (name === 'OverconstrainedError') {
      return '当前摄像头不支持请求的分辨率，正在尝试默认设置。';
    }
    return '无法打开摄像头：' + (error && error.message ? error.message : '未知错误');
  }

  function startCamera(deviceId) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showToast('当前浏览器不支持摄像头。请使用统信自带浏览器或 Chromium 80 以上版本。', 'error', 7000);
      return;
    }
    $('startCameraBtn').disabled = true;
    var videoConstraints = {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 }
    };
    if (deviceId) videoConstraints.deviceId = { exact: deviceId };

    navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints }).then(function (stream) {
      receive.selectedDeviceId = deviceId || '';
      attachCameraStream(stream);
    }).catch(function (error) {
      if (error && error.name === 'OverconstrainedError') {
        return navigator.mediaDevices.getUserMedia({ audio: false, video: true }).then(function (stream) {
          attachCameraStream(stream);
        });
      }
      throw error;
    }).catch(function (error) {
      showToast(cameraErrorMessage(error), 'error', 8000);
      toggle($('cameraPlaceholder'), true);
      $('startCameraBtn').hidden = false;
      $('stopCameraBtn').hidden = true;
      $('cameraStatus').innerHTML = '<span class="dot"></span>未能开启';
    }).then(function () {
      $('startCameraBtn').disabled = false;
    });
  }

  function stopCamera(completeState) {
    receive.scanning = false;
    releaseReceiveWakeLock();
    if (receive.rafId) {
      cancelAnimationFrame(receive.rafId);
      receive.rafId = 0;
    }
    if (receive.stream) {
      receive.stream.getTracks().forEach(function (track) { track.stop(); });
      receive.stream = null;
    }
    var video = $('cameraVideo');
    if (video) video.srcObject = null;
    $('cameraStage').classList.remove('is-live');
    toggle($('cameraPlaceholder'), true);
    toggle($('scanGuide'), false);
    $('startCameraBtn').hidden = false;
    $('stopCameraBtn').hidden = true;
    $('cameraSelect').disabled = true;
    $('startCameraBtn').disabled = false;
    if (!completeState) {
      $('cameraPlaceholder').querySelector('strong').textContent = '等待开启摄像头';
      $('cameraPlaceholder').querySelector('small').textContent = '允许浏览器使用摄像头后，把二维码放入取景框';
    } else if (receive.complete) {
      $('cameraPlaceholder').querySelector('strong').textContent = '接收完成';
      $('cameraPlaceholder').querySelector('small').textContent = '文件已保存到内存，请点击右侧按钮保存到本机';
    }
    updateCameraStatus();
  }

  function listCameras() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then(function (devices) {
      var select = $('cameraSelect');
      var current = receive.selectedDeviceId || select.value;
      select.innerHTML = '<option value="">默认摄像头</option>';
      var count = 0;
      devices.forEach(function (device) {
        if (device.kind !== 'videoinput') return;
        count += 1;
        var option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || ('摄像头 ' + count);
        select.appendChild(option);
      });
      if (current) {
        select.value = current;
        if (!select.value) select.value = '';
      }
    }).catch(function () {});
  }

  function decodeQR(imageData, width, height, inversion) {
    try {
      return window.jsQR(imageData, width, height, {
        inversionAttempts: inversion || 'dontInvert'
      });
    } catch (error) {
      return null;
    }
  }

  function decodeQuadTexts(sourceCanvas, width, height, scale, inversion) {
    var targetAspect = 16 / 9;
    var baseWidth = Math.min(width, height * targetAspect);
    var baseHeight = baseWidth / targetAspect;
    if (baseHeight > height) {
      baseHeight = height;
      baseWidth = baseHeight * targetAspect;
    }
    var regionWidth = baseWidth * scale;
    var regionHeight = baseHeight * scale;
    var regionX = (width - regionWidth) / 2;
    var regionY = (height - regionHeight) / 2;
    var quadWidth = Math.max(2, Math.floor(regionWidth / 2));
    var quadHeight = Math.max(2, Math.floor(regionHeight / 2));
    var quadCanvas = $('quadCanvas');
    var qctx = quadCanvas.getContext('2d', { willReadFrequently: true });
    if (quadCanvas.width !== quadWidth || quadCanvas.height !== quadHeight) {
      quadCanvas.width = quadWidth;
      quadCanvas.height = quadHeight;
    }
    var offsets = [[0, 0], [1, 0], [0, 1], [1, 1]];
    var texts = [];
    var seen = {};
    for (var i = 0; i < offsets.length; i++) {
      var sx = Math.floor(regionX + offsets[i][0] * quadWidth);
      var sy = Math.floor(regionY + offsets[i][1] * quadHeight);
      qctx.drawImage(sourceCanvas, sx, sy, quadWidth, quadHeight, 0, 0, quadWidth, quadHeight);
      var pixels;
      try {
        pixels = qctx.getImageData(0, 0, quadWidth, quadHeight);
      } catch (error) {
        continue;
      }
      var code = decodeQR(pixels.data, quadWidth, quadHeight, inversion);
      if (code && code.data && !seen[code.data] && C.parseFrame(code.data)) {
        seen[code.data] = true;
        texts.push(code.data);
      }
    }
    return texts;
  }

  function decodeQuadrants(imageData, width, height, scale) {
    var texts = decodeQuadTexts($('scanCanvas'), width, height, scale, 'dontInvert');
    for (var i = 0; i < texts.length; i++) {
      handleFrameText(texts[i], 'camera');
    }
    return texts.length;
  }

  function startScanLoop() {
    if (receive.rafId) cancelAnimationFrame(receive.rafId);
    receive.lastScanAt = 0;
    receive.bestCropScale = 1;
    function loop() {
      if (!receive.scanning) return;
      receive.rafId = requestAnimationFrame(loop);
      var now = performance.now();
      if (!receive.lastScanAt) receive.lastScanAt = now - 200;
      if (now - receive.lastScanAt < 100) return;
      var video = $('cameraVideo');
      if (!video || video.readyState < 2 || !video.videoWidth) return;
      receive.lastScanAt = now;

      var canvas = $('scanCanvas');
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      var maxWidth = 1280;
      var width = Math.min(video.videoWidth, maxWidth);
      var height = Math.round(video.videoHeight * (width / video.videoWidth));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      ctx.drawImage(video, 0, 0, width, height);
      var imageData;
      try {
        imageData = ctx.getImageData(0, 0, width, height);
      } catch (error) {
        return;
      }
      receive.scanCount += 1;

      var fullCode = decodeQR(imageData.data, width, height);
      var fullFrame = null;
      if (fullCode && fullCode.data) {
        fullFrame = C.parseFrame(fullCode.data);
        if (fullFrame) handleFrameText(fullCode.data, 'camera');
      }
      if (fullFrame && fullFrame.channels === 1) return;

      var scales = [receive.bestCropScale, 1, 0.9, 0.8, 0.7];
      var seenScales = {};
      var bestScale = receive.bestCropScale;
      var bestCount = 0;
      for (var s = 0; s < scales.length; s++) {
        var scale = scales[s];
        if (seenScales[scale]) continue;
        seenScales[scale] = true;
        var decoded = decodeQuadrants(imageData, width, height, scale);
        if (decoded > bestCount) {
          bestCount = decoded;
          bestScale = scale;
        }
        if (decoded >= 4) break;
      }
      if (bestCount > 0) receive.bestCropScale = bestScale;
    }
    receive.rafId = requestAnimationFrame(loop);
  }

  $('startCameraBtn').addEventListener('click', function () {
    startCamera(receive.selectedDeviceId || null);
  });

  $('stopCameraBtn').addEventListener('click', function () {
    stopCamera(false);
    showToast('摄像头已关闭', 'info', 1800);
  });

  $('cameraSelect').addEventListener('change', function (event) {
    var deviceId = event.target.value;
    receive.selectedDeviceId = deviceId;
    if (!receive.scanning) return;
    stopCamera(false);
    startCamera(deviceId || null);
  });

  function decodeImageFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () {
        try {
          var maxSide = 2000;
          var scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
          var width = Math.max(1, Math.round(image.naturalWidth * scale));
          var height = Math.max(1, Math.round(image.naturalHeight * scale));
          var canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          var ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(image, 0, 0, width, height);
          var data = ctx.getImageData(0, 0, width, height);
          var code = decodeQR(data.data, width, height, 'attemptBoth');
          var texts = [];
          var seen = {};
          if (code && code.data && C.parseFrame(code.data)) {
            texts.push(code.data);
            seen[code.data] = true;
            var fullFrame = C.parseFrame(code.data);
            if (fullFrame && fullFrame.channels === 1) {
              URL.revokeObjectURL(url);
              resolve(texts);
              return;
            }
          }
          var scales = [1, 0.92, 0.84, 0.76, 0.68];
          for (var s = 0; s < scales.length; s++) {
            var found = decodeQuadTexts(canvas, width, height, scales[s], 'attemptBoth');
            for (var i = 0; i < found.length; i++) {
              if (!seen[found[i]]) {
                seen[found[i]] = true;
                texts.push(found[i]);
              }
            }
            if (texts.length >= 4) break;
          }
          URL.revokeObjectURL(url);
          resolve(texts);
        } catch (error) {
          URL.revokeObjectURL(url);
          reject(error);
        }
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('图片无法读取'));
      };
      image.src = url;
    });
  }

  function handleImageFiles(files) {
    var list = Array.prototype.slice.call(files || []).filter(function (file) {
      return file && file.type && file.type.indexOf('image/') === 0;
    });
    if (!list.length) {
      showToast('请选择图片文件', 'error');
      return;
    }
    var accepted = 0;
    var failed = 0;
    var sequence = Promise.resolve();
    list.forEach(function (file) {
      sequence = sequence.then(function () {
        return decodeImageFile(file).then(function (texts) {
          if (texts && texts.length) {
            for (var i = 0; i < texts.length; i++) {
              if (handleFrameText(texts[i], 'image')) accepted += 1;
            }
          } else {
            failed += 1;
          }
        }).catch(function () {
          failed += 1;
        });
      });
    });
    sequence.then(function () {
      if (accepted > 0) {
        showToast('从图片中读取到 ' + accepted + ' 个分片' + (failed ? '，' + failed + ' 张未识别' : ''), 'success');
      } else {
        showToast('没有从图片中识别到码桥二维码。请确保二维码清晰、完整、对比度高。', 'error', 6000);
      }
    });
  }

  $('imageInput').addEventListener('change', function (event) {
    handleImageFiles(event.target.files);
    event.target.value = '';
  });

  var cameraCard = $('cameraCard');
  ['dragenter', 'dragover'].forEach(function (name) {
    cameraCard.addEventListener(name, function (event) {
      if (event.dataTransfer && event.dataTransfer.types && Array.prototype.indexOf.call(event.dataTransfer.types, 'Files') >= 0) {
        event.preventDefault();
        cameraCard.classList.add('is-dragging');
      }
    });
  });
  ['dragleave', 'drop'].forEach(function (name) {
    cameraCard.addEventListener(name, function (event) {
      event.preventDefault();
      cameraCard.classList.remove('is-dragging');
      if (name === 'drop' && event.dataTransfer && event.dataTransfer.files) {
        handleImageFiles(event.dataTransfer.files);
      }
    });
  });

  document.addEventListener('paste', function (event) {
    if (activeMode !== 'receive') return;
    var items = event.clipboardData && event.clipboardData.items;
    if (!items) return;
    var files = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image/') === 0) {
        var file = items[i].getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length) {
      event.preventDefault();
      handleImageFiles(files);
    }
  });

  $('copyMissingBtn').addEventListener('click', function () {
    if (!receive.total) return;
    var ranges = [];
    var start = -1;
    for (var i = 0; i <= receive.total; i++) {
      var missing = i < receive.total && !receive.haveFlags[i];
      if (missing && start === -1) start = i;
      if (!missing && start !== -1) {
        var end = i - 1;
        ranges.push(start === end ? String(start + 1) : (start + 1) + '-' + (end + 1));
        start = -1;
      }
    }
    var text = ranges.length ? ranges.slice(0, 400).join(', ') + (ranges.length > 400 ? ' …（共 ' + ranges.length + ' 段）' : '') : '无缺失分片';
    function copied() { showToast('缺失分片编号已复制', 'success'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(copied).catch(function () {
        showToast('复制失败，请手动查看分片矩阵', 'error');
      });
    } else {
      showToast('当前浏览器不支持剪贴板，请查看分片矩阵', 'info');
    }
  });

  $('resetReceiveBtn').addEventListener('click', function () {
    if (receive.haveCount > 0 && !receive.complete) {
      if (!window.confirm('确定清空当前接收进度？（摄像头会继续扫描）')) return;
    }
    resetReceiveState(true);
    showToast('接收进度已清空', 'info');
  });

  $('receiveAnotherBtn').addEventListener('click', function () {
    resetReceiveState(false);
    showToast('可以开始接收下一个文件了', 'info');
  });

  $('saveFileBtn').addEventListener('click', function () {
    if (!receive.blobUrl || !receive.meta) return;
    var link = document.createElement('a');
    link.href = receive.blobUrl;
    link.download = C.safeFileName(receive.meta.fileName);
    document.body.appendChild(link);
    link.click();
    window.setTimeout(function () {
      if (link.parentNode) link.parentNode.removeChild(link);
    }, 1000);
    showToast('已交给浏览器保存：' + link.download, 'success', 4500);
  });

  /* ------------------------------------------------------------
   * 统计刷新
   * ---------------------------------------------------------- */

  receive.statTimer = window.setInterval(function () {
    if (activeMode !== 'receive' || !receive.transferId) return;
    if (receive.startedAt) setText('recvElapsed', formatDuration((Date.now() - receive.startedAt) / 1000));
    if (receive.scanStartedAt && receive.framesSeen && receive.scanning) {
      var seconds = Math.max(0.5, (Date.now() - receive.scanStartedAt) / 1000);
      setText('recvRate', (receive.framesSeen / seconds).toFixed(1) + ' 帧/秒');
    }
  }, 700);

  /* ------------------------------------------------------------
   * 全局交互
   * ---------------------------------------------------------- */

  document.addEventListener('keydown', function (event) {
    var tag = event.target && event.target.tagName ? event.target.tagName.toLowerCase() : '';
    var typing = tag === 'input' || tag === 'textarea' || tag === 'select' || (event.target && event.target.isContentEditable);
    if (typing || document.querySelector('dialog[open]')) return;
    if (event.code === 'Space' && activeMode === 'send' && send.total) {
      event.preventDefault();
      if (send.playing) pauseSend(true);
      else playSend();
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && send.playing) {
      pauseSend(false);
      showToast('页面已切到后台，为保证识别稳定已暂停播放', 'info', 4200);
    }
  });

  $('helpBtn').addEventListener('click', function () {
    var dialog = $('helpDialog');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  });

  function closeHelp() {
    var dialog = $('helpDialog');
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }
  $('closeHelpBtn').addEventListener('click', closeHelp);
  $('helpOkBtn').addEventListener('click', closeHelp);
  $('helpDialog').addEventListener('click', function (event) {
    if (event.target === $('helpDialog')) closeHelp();
  });

  $('quitBtn').addEventListener('click', function () {
    if (!window.confirm('退出码桥？正在进行的传输会中断。')) return;
    fetch('api/quit', { method: 'POST', headers: { 'X-QR-Bridge': 'quit' } }).then(function () {
      document.body.innerHTML = '<main class="quit-screen"><img src="icon.svg" width="64" height="64" alt=""><h1>码桥已退出</h1><p>可以关闭这个浏览器标签页了。</p></main>';
    }).catch(function () {
      showToast('退出请求失败，请直接关闭终端或结束 qrbridge 进程', 'error', 6000);
    });
  });

  function ping() {
    fetch('api/ping', { method: 'POST', headers: { 'X-QR-Bridge': 'ping' } }).catch(function () {
      showToast('与本地服务的连接已断开，请关闭页面后重新启动码桥', 'error', 6000);
    });
  }
  ping();
  window.setInterval(ping, 20000);

  fetch('api/info').then(function (response) { return response.json(); }).then(function (info) {
    if (info && info.version) {
      APP_VERSION = info.version;
      setText('versionText', 'v' + APP_VERSION);
    }
  }).catch(function () {});

  setText('versionText', 'v' + APP_VERSION);
  setText('fpsOutput', send.fps + ' 帧/秒');
  drawChunkMatrix();
  updateCameraStatus();
  updatePlayState();

  window.__QRBridge = {
    core: C,
    send: send,
    receive: receive,
    handleFrameText: handleFrameText,
    parseTargetList: parseTargetList,
    version: APP_VERSION
  };
}());