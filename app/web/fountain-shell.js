/* Shared shell around the bundled Decimen pages so the standard QR mode and
 * the Fountain mode read as two modes of one app. */
(function () {
  'use strict';
  if (window.__qrBridgeFountainShell) return;
  window.__qrBridgeFountainShell = true;

  var android = !!(window.QRBridgeAndroid && window.QRBridgeAndroid.platform);
  var receive = location.pathname.indexOf('fountain-receive') >= 0;
  var home = android ? 'android.html' : './';
  var other = receive ? 'fountain-send.html' : 'fountain-receive.html';
  var title = receive ? '接收' : '发送';
  var subtitle = receive ? '二维码 / Fountain 双模式接收' : '二维码 / Fountain 双模式发送';

  var style = document.createElement('style');
  style.textContent = [
    '.site-header,.site-footer{display:none!important}',
    'body{padding-top:66px!important}',
    'body.qr-full{padding-top:0!important}',
    '#qrb-shell{position:fixed;top:0;left:0;right:0;z-index:99999;height:66px;display:flex;align-items:center;gap:14px;padding:0 max(18px,env(safe-area-inset-right)) 0 max(18px,env(safe-area-inset-left));box-sizing:border-box;border-bottom:1px solid #dbe6f0;background:rgba(255,255,255,.96);backdrop-filter:blur(12px);font-family:"Segoe UI","Microsoft YaHei","Noto Sans CJK SC",sans-serif}',
    '#qrb-shell .qrb-brand{display:flex;align-items:center;gap:10px;color:#102236;text-decoration:none;min-width:0}',
    '#qrb-shell .qrb-logo{width:36px;height:36px;border-radius:9px;display:block;object-fit:contain;flex:none}',
    '#qrb-shell .qrb-name{display:flex;flex-direction:column;line-height:normal;min-width:0}',
    '#qrb-shell .qrb-name strong{font-size:16px;white-space:nowrap}',
    '#qrb-shell .qrb-name small{font:400 9px/normal "Noto Sans CJK SC","Microsoft YaHei",sans-serif;letter-spacing:.1em;color:#6b7f93;white-space:nowrap}',
    '#qrb-shell .qrb-context{margin-inline-start:auto;color:#6b7f93;font-size:11px;white-space:nowrap}',
    '#qrb-shell .qrb-modes{display:flex;gap:3px;padding:3px;border:1px solid #dbe6f0;border-radius:999px;background:#f3f8fc;flex:none}',
    '#qrb-shell .qrb-modes a{display:block;padding:5px 10px;border-radius:999px;color:#3e536a;text-decoration:none;font-size:11px;font-weight:700;white-space:nowrap}',
    '#qrb-shell .qrb-modes a.active{background:#0b63ce;color:#fff}',
    '#qrb-shell .qrb-agpl{font:600 9px/1 ui-monospace,Consolas,monospace;color:#96a7b8;text-decoration:none;white-space:nowrap}',
    'body{background:#f3f8fc;color:#102236;font-family:"Segoe UI","Microsoft YaHei","Noto Sans CJK SC",sans-serif}',
    ':root{--bg:#f3f8fc;--panel:#ffffff;--panel-strong:#f8fbfe;--line:#dbe6f0;--line-bright:#c7d6e4;--text:#102236;--text-dim:#3e536a;--muted:#6b7f93;--muted-dim:#96a7b8;--accent:#0b63ce;--accent-hi:#084b9e;--accent-ink:#ffffff;--green:#0f9f8f;--red:#c24132;--viewport-bg:#07111c;--bg-rgb:243,248,252;--accent-rgb:11,99,206}',
    '@media(min-width:641px){#qrb-shell{height:76px;padding-left:max(18px,calc((100vw - 1240px)/2));padding-right:max(18px,calc((100vw - 1240px)/2))}body{padding-top:76px!important}#qrb-shell .qrb-logo{width:44px;height:44px}#qrb-shell .qrb-name strong{font-size:21px;letter-spacing:.04em}#qrb-shell .qrb-name small{font-size:9px;letter-spacing:.28em}#qrb-shell .qrb-modes a{font-size:12px;padding:6px 12px}}',
    'h1,h2,h3{font-family:"Segoe UI","Microsoft YaHei","Noto Sans CJK SC",sans-serif!important;font-weight:800!important;letter-spacing:-.015em!important}',
    'body.qr-full #qrb-shell{display:none!important}',
    '@media(max-width:640px){body{padding-top:58px!important}#qrb-shell{height:58px;gap:8px;padding-inline:10px}#qrb-shell .qrb-logo{width:31px;height:31px;font-size:16px}#qrb-shell .qrb-name strong{font-size:14px}#qrb-shell .qrb-name small{font-size:8px}#qrb-shell .qrb-context{display:none}#qrb-shell .qrb-modes a{padding:5px 8px;font-size:10px}#qrb-shell .qrb-agpl{display:none}}',
    ''
  ].join('\n');
  document.head.appendChild(style);

  if (android) {
    // Android app is dark-themed; keep the shell in the same palette.
    style.textContent += [
      '#qrb-shell{background:rgba(7,17,28,.96);border-bottom-color:#22384d}',
      '#qrb-shell .qrb-brand{color:#eaf4ff}',
      '#qrb-shell .qrb-name small{color:#8fa8bf}',
      '#qrb-shell .qrb-context{color:#8fa8bf}',
      '#qrb-shell .qrb-modes{background:#081624;border-color:#22384d}',
      '#qrb-shell .qrb-modes a{color:#8fa8bf}',
      '#qrb-shell .qrb-modes a.active{background:linear-gradient(135deg,#0b63ce,#0f9f8f);color:#fff}',
      'body{background:#07111c;color:#eaf4ff;font-family:"Noto Sans CJK SC","Microsoft YaHei",sans-serif}',
      ':root{--bg:#07111c;--panel:#0e1e2e;--panel-strong:#121a29;--line:#22384d;--line-bright:#34466f;--text:#eaf4ff;--text-dim:#b9c6dd;--muted:#8fa8bf;--muted-dim:#6e879d;--accent:#35b6ff;--accent-hi:#8adaff;--accent-ink:#04121c;--green:#2dd4bf;--red:#ff8073;--viewport-bg:#000;--bg-rgb:7,17,28;--accent-rgb:53,182,255}',
      '@media(max-width:640px){body{padding-top:62px!important}#qrb-shell{height:62px;gap:10px;padding-inline:16px}#qrb-shell .qrb-logo{width:36px;height:36px}#qrb-shell .qrb-name strong{font-size:16px;line-height:normal;letter-spacing:.01em}#qrb-shell .qrb-name small{font-family:"Noto Sans CJK SC","Microsoft YaHei",sans-serif!important;font-size:9px;font-weight:400;line-height:normal;letter-spacing:.1em}#qrb-shell .qrb-modes a{padding:6px 9px;font-size:10px}}',
      '#qrb-shell{font-family:"Noto Sans CJK SC","Microsoft YaHei",sans-serif!important}',
      '#qrb-shell .qrb-brand{gap:9px}',
      '#qrb-shell .qrb-name strong{letter-spacing:.01em}',
      '#qrb-shell .qrb-modes{margin-left:auto}',
      '#qrb-shell .qrb-modes a{line-height:1.2}',
      '.qrb-mode-hint{display:block;width:auto;max-width:none;margin:0 2px 9px!important;color:var(--muted);font-size:10px;text-align:center!important}',
      '.qrb-camera{position:relative;width:100%;aspect-ratio:4/3;background:#000;border:1px solid var(--line);border-radius:16px;overflow:hidden;margin:0 0 12px}',
      '.qrb-camera .preview{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;display:block!important}',
      '.qrb-camera video{width:100%!important;height:100%!important;object-fit:cover!important;opacity:0;transition:opacity .2s ease}',
      '.qrb-camera.live video{opacity:1}',
      '.qrb-cam-empty{position:absolute;inset:0;display:grid;place-items:center;text-align:center;color:var(--muted);font-size:13px;line-height:1.6;padding:20px;pointer-events:none}',
      '.qrb-camera.live .qrb-cam-empty{display:none}',
      '#settings{border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:12px;margin:12px 0 0}',
      '#settings>summary{display:none!important}',
      '.qrb-settings-title{font-family:"Noto Sans CJK SC","Microsoft YaHei",sans-serif!important;font-size:12px;font-weight:400;color:var(--muted);line-height:1.65;letter-spacing:0;margin:0 0 8px}', '#settings,#settings label,#settings .camera-pick,#settings .settings-note{font-family:"Noto Sans CJK SC","Microsoft YaHei",sans-serif!important}', '#settings label>span,#settings .camera-pick>span{font-size:12px!important;font-weight:400!important;color:var(--muted)!important;letter-spacing:0!important}', '#settings select{font-family:"Noto Sans CJK SC","Microsoft YaHei",sans-serif!important;font-size:13px!important;font-weight:400!important}', '#settings label:has(input[type=checkbox]){font-size:12px!important;font-weight:400!important;color:var(--text)!important}', '#settings .settings-note,#settings .hint{font-size:10px!important;font-weight:400!important;color:var(--muted)!important}',
      'body button{border-radius:11px!important;min-height:44px!important;padding:0 14px!important;border:0!important;background:#17314a!important;color:#fff!important;font:700 14px/1.35 "Noto Sans CJK SC","Microsoft YaHei",sans-serif!important}',
      'body button#start,body button.primary,body a.download{background:linear-gradient(135deg,#0b63ce,#0f9f8f)!important;color:#fff!important}',
      'body button:disabled{opacity:.45!important}',
      'body a.download{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;border-radius:11px;text-decoration:none!important;font:700 14px/1.35 "Noto Sans CJK SC","Microsoft YaHei",sans-serif!important}'
    ].join('\n');
    document.head.appendChild(style);
  }

  var header = document.createElement('header');
  header.id = 'qrb-shell';
  var brand = '<a class="qrb-brand" href="' + home + '" aria-label="返回码桥">' +
    '<img class="qrb-logo" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNTYgMjU2IiByb2xlPSJpbWciIGFyaWEtbGFiZWw9IueggeahpSBRUiBCcmlkZ2UiPgogIDxkZWZzPgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJiZyIgeDE9IjAiIHkxPSIwIiB4Mj0iMSIgeTI9IjEiPgogICAgICA8c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiMxMDJiNDMiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMDYxNTIyIi8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJhY2NlbnQiIHgxPSIwIiB5MT0iMSIgeDI9IjEiIHkyPSIwIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjMmVjOWQ2Ii8+CiAgICAgIDxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzY5ZTZjNiIvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICA8L2RlZnM+CiAgPHJlY3Qgd2lkdGg9IjI1NiIgaGVpZ2h0PSIyNTYiIHJ4PSI1OCIgZmlsbD0idXJsKCNiZykiLz4KICA8cmVjdCB4PSI0IiB5PSI0IiB3aWR0aD0iMjQ4IiBoZWlnaHQ9IjI0OCIgcng9IjU1IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS1vcGFjaXR5PSIuMDgiIHN0cm9rZS13aWR0aD0iMiIvPgogIDxnIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2ZmZmZmZiIgc3Ryb2tlLXdpZHRoPSI5Ij4KICAgIDxyZWN0IHg9IjM5IiB5PSIzOSIgd2lkdGg9IjYyIiBoZWlnaHQ9IjYyIiByeD0iOSIvPgogICAgPHJlY3QgeD0iMTU1IiB5PSIzOSIgd2lkdGg9IjYyIiBoZWlnaHQ9IjYyIiByeD0iOSIvPgogICAgPHJlY3QgeD0iMzkiIHk9IjE1NSIgd2lkdGg9IjYyIiBoZWlnaHQ9IjYyIiByeD0iOSIvPgogIDwvZz4KICA8ZyBmaWxsPSIjZmZmZmZmIj4KICAgIDxyZWN0IHg9IjU5IiB5PSI1OSIgd2lkdGg9IjIyIiBoZWlnaHQ9IjIyIiByeD0iNCIvPgogICAgPHJlY3QgeD0iMTc1IiB5PSI1OSIgd2lkdGg9IjIyIiBoZWlnaHQ9IjIyIiByeD0iNCIvPgogICAgPHJlY3QgeD0iNTkiIHk9IjE3NSIgd2lkdGg9IjIyIiBoZWlnaHQ9IjIyIiByeD0iNCIvPgogIDwvZz4KICA8ZyBmaWxsPSIjZmZmZmZmIiBvcGFjaXR5PSIuOTIiPgogICAgPHJlY3QgeD0iMTU1IiB5PSIxNTUiIHdpZHRoPSIxNSIgaGVpZ2h0PSIxNSIgcng9IjMiLz4KICAgIDxyZWN0IHg9IjE4MSIgeT0iMTU1IiB3aWR0aD0iMTUiIGhlaWdodD0iMTUiIHJ4PSIzIi8+CiAgICA8cmVjdCB4PSIyMDciIHk9IjE1NSIgd2lkdGg9IjEwIiBoZWlnaHQ9IjE1IiByeD0iMyIvPgogICAgPHJlY3QgeD0iMTU1IiB5PSIxODEiIHdpZHRoPSIxNSIgaGVpZ2h0PSIxMCIgcng9IjMiLz4KICA8L2c+CiAgPGcgZmlsbD0idXJsKCNhY2NlbnQpIj4KICAgIDxyZWN0IHg9IjE1NSIgeT0iMjAyIiB3aWR0aD0iMTUiIGhlaWdodD0iMTUiIHJ4PSIzIi8+CiAgICA8cmVjdCB4PSIxODEiIHk9IjE4MSIgd2lkdGg9IjE1IiBoZWlnaHQ9IjM2IiByeD0iMyIvPgogICAgPHJlY3QgeD0iMjA3IiB5PSIxODEiIHdpZHRoPSIxMCIgaGVpZ2h0PSIxNSIgcng9IjMiLz4KICAgIDxyZWN0IHg9IjIwNyIgeT0iMjA3IiB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIHJ4PSIzIi8+CiAgICA8cmVjdCB4PSIxMTgiIHk9IjExOCIgd2lkdGg9IjIwIiBoZWlnaHQ9IjIwIiByeD0iNSIvPgogIDwvZz4KICA8cGF0aCBkPSJNMTI4IDY4djc0bTAgMC0yMy0yM20yMyAyMyAyMy0yMyIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJ1cmwoI2FjY2VudCkiIHN0cm9rZS13aWR0aD0iMTAiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPgogIDxwYXRoIGQ9Ik0xMDAgMjAwYzMxIDEzIDY2IDQgODEtMjIiIGZpbGw9Im5vbmUiIHN0cm9rZT0idXJsKCNhY2NlbnQpIiBzdHJva2Utd2lkdGg9IjkiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgb3BhY2l0eT0iLjkiLz4KICA8cGF0aCBkPSJtMTc0IDE2OSAxMCAxMS0xNSAyIiBmaWxsPSJub25lIiBzdHJva2U9InVybCgjYWNjZW50KSIgc3Ryb2tlLXdpZHRoPSI5IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIG9wYWNpdHk9Ii45Ii8+Cjwvc3ZnPgo=" width="36" height="36" alt=""><span class="qrb-name"><strong>' +
    (android ? '码桥接收端' : '码桥') + '</strong><small>' +
    (android ? 'QR BRIDGE · ' + title : 'QR BRIDGE · ' + subtitle) + '</small></span></a>';
  var modes = '<nav class="qrb-modes" aria-label="传输模式">' +
    '<a href="' + home + '">' + (android ? '标准二维码' : '二维码') + '</a>' +
    '<a class="active" href="' + other + '">Fountain 高速</a></nav>';
  var context = '<span class="qrb-context">' + (android ? '高速接收' : subtitle) + '</span>';
  var agpl = '<a class="qrb-agpl" href="https://github.com/bashalarmistalt/decimen-optical-transfer" target="_blank" rel="noopener noreferrer">AGPL</a>';
  header.innerHTML = brand + context + modes + agpl;
  document.body.insertBefore(header, document.body.firstChild);

  if (android && receive) {
    var primary = document.querySelector('.receiver-primary');
    var preview = document.querySelector('.preview');
    var start = document.getElementById('start');
    var settings = document.getElementById('settings');
    if (primary && start) {
      var heading = primary.querySelector('.receiver-heading');
      if (heading) heading.style.display = 'none';
      var hint = document.createElement('p');
      hint.className = 'qrb-mode-hint';
      hint.textContent = 'Fountain 高速；对准发送端的四宫格，保持稳定。';
      primary.insertBefore(hint, primary.firstChild);
      if (preview) {
        var camera = document.createElement('div');
        camera.className = 'qrb-camera';
        camera.appendChild(preview);
        preview.style.display = 'block';
        var empty = document.createElement('div');
        empty.className = 'qrb-cam-empty';
        empty.innerHTML = '点下方按钮打开摄像头<br>对准发送端的四宫格';
        camera.appendChild(empty);
        primary.insertBefore(camera, start);
        var video = preview.querySelector('video');
        if (video) {
          video.addEventListener('playing', function () { camera.classList.add('live'); });
          video.addEventListener('loadedmetadata', function () { camera.classList.add('live'); });
        }
        start.textContent = '打开摄像头';
        var rename = function () {
          if (start.textContent && start.textContent.indexOf('启动') >= 0) start.textContent = '打开摄像头';
        };
        setTimeout(rename, 250);
      }
      if (settings) {
        settings.open = true;
        start.parentNode.insertBefore(settings, start.nextSibling);
        var title = document.createElement('div');
        title.className = 'qrb-settings-title';
        title.textContent = '接收设置';
        settings.insertBefore(title, settings.firstChild);
      }
    }
  }
}());
