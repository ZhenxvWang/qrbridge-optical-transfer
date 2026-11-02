/* Android WebView download bridge for the bundled Decimen receiver.
 * The page saves its result with a blob: URL on an <a download>. WebView does
 * not hand blob URLs to DownloadManager, so intercept both a real finger tap
 * and a programmatic a.click() (which also dispatches a click event) and
 * stream the blob to the native FileSaver through QRBridgeAndroid. */
(function () {
  'use strict';
  if (window.__qrBridgeSaveInstalled) return;
  window.__qrBridgeSaveInstalled = true;
  var saving = false;

  function bytesToBase64(bytes) {
    var text = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      text += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
    }
    return btoa(text);
  }

  function saveBlob(anchor) {
    if (saving) return;
    saving = true;
    var bridge = window.QRBridgeAndroid;
    bridge.toast('正在保存，请稍候…');
    fetch(anchor.href).then(function (response) {
      return response.arrayBuffer();
    }).then(function (buffer) {
      var bytes = new Uint8Array(buffer);
      var name = anchor.download || 'transfer.bin';
      try {
        bridge.beginSave(name, bytes.length);
        var step = 128 * 1024;
        for (var offset = 0; offset < bytes.length; offset += step) {
          bridge.appendSave(bytesToBase64(bytes.subarray(offset, Math.min(offset + step, bytes.length))));
        }
        var path = bridge.finishSave();
        bridge.toast('已保存：' + path);
      } catch (error) {
        try { if (bridge.abortSave) bridge.abortSave(); } catch (ignore) {}
        bridge.toast('保存失败：' + (error && error.message ? error.message : error));
      }
      saving = false;
    }).catch(function (error) {
      saving = false;
      bridge.toast('读取文件失败：' + (error && error.message ? error.message : error));
    });
  }

  document.addEventListener('click', function (event) {
    if (!window.QRBridgeAndroid || !window.QRBridgeAndroid.beginSave) return;
    var target = event.target;
    while (target && target !== document && !(target instanceof HTMLAnchorElement)) {
      target = target.parentElement;
    }
    if (!(target instanceof HTMLAnchorElement)) return;
    if (!target.download || !target.href || target.href.indexOf('blob:') !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    saveBlob(target);
  }, true);
}());
