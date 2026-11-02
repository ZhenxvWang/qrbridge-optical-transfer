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
    '#qrb-shell .qrb-logo{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:linear-gradient(135deg,#0b63ce,#0f9f8f);color:#fff;font-weight:800;font-size:18px;flex:none}',
    '#qrb-shell .qrb-name{display:flex;flex-direction:column;line-height:1.1;min-width:0}',
    '#qrb-shell .qrb-name strong{font-size:16px;white-space:nowrap}',
    '#qrb-shell .qrb-name small{font:600 9px/1.4 ui-monospace,Consolas,monospace;letter-spacing:.12em;color:#6b7f93;white-space:nowrap}',
    '#qrb-shell .qrb-context{margin-inline-start:auto;color:#6b7f93;font-size:11px;white-space:nowrap}',
    '#qrb-shell .qrb-modes{display:flex;gap:3px;padding:3px;border:1px solid #dbe6f0;border-radius:999px;background:#f3f8fc;flex:none}',
    '#qrb-shell .qrb-modes a{display:block;padding:5px 10px;border-radius:999px;color:#3e536a;text-decoration:none;font-size:11px;font-weight:700;white-space:nowrap}',
    '#qrb-shell .qrb-modes a.active{background:#0b63ce;color:#fff}',
    '#qrb-shell .qrb-agpl{font:600 9px/1 ui-monospace,Consolas,monospace;color:#96a7b8;text-decoration:none;white-space:nowrap}',
    'body{background:#f3f8fc;color:#102236;font-family:"Segoe UI","Microsoft YaHei","Noto Sans CJK SC",sans-serif}',
    ':root{--bg:#f3f8fc;--panel:#ffffff;--panel-strong:#f8fbfe;--line:#dbe6f0;--line-bright:#c7d6e4;--text:#102236;--text-dim:#3e536a;--muted:#6b7f93;--muted-dim:#96a7b8;--accent:#0b63ce;--accent-hi:#084b9e;--accent-ink:#ffffff;--green:#0f9f8f;--red:#c24132;--viewport-bg:#07111c;--bg-rgb:243,248,252;--accent-rgb:11,99,206}',
    'body.qr-full #qrb-shell{display:none!important}',
    '@media(max-width:640px){body{padding-top:58px!important}#qrb-shell{height:58px;gap:8px;padding-inline:10px}#qrb-shell .qrb-logo{width:31px;height:31px;font-size:16px}#qrb-shell .qrb-name strong{font-size:14px}#qrb-shell .qrb-name small{font-size:8px}#qrb-shell .qrb-context{display:none}#qrb-shell .qrb-modes a{padding:5px 8px;font-size:10px}#qrb-shell .qrb-agpl{display:none}}',
    '@media(max-width:390px){#qrb-shell .qrb-name small{display:none}}'
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
      ':root{--bg:#07111c;--panel:#0e1e2e;--panel-strong:#121a29;--line:#22384d;--line-bright:#34466f;--text:#eaf4ff;--text-dim:#b9c6dd;--muted:#8fa8bf;--muted-dim:#6e879d;--accent:#35b6ff;--accent-hi:#8adaff;--accent-ink:#04121c;--green:#2dd4bf;--red:#ff8073;--viewport-bg:#000;--bg-rgb:7,17,28;--accent-rgb:53,182,255}'
    ].join('\n');
    document.head.appendChild(style);
  }

  var header = document.createElement('header');
  header.id = 'qrb-shell';
  var brand = '<a class="qrb-brand" href="' + home + '" aria-label="返回码桥">' +
    '<span class="qrb-logo">码</span><span class="qrb-name"><strong>' +
    (android ? '码桥接收端' : '码桥') + '</strong><small>' +
    (android ? 'QR BRIDGE · ' + title : 'QR BRIDGE · ' + subtitle) + '</small></span></a>';
  var modes = '<nav class="qrb-modes" aria-label="传输模式">' +
    '<a href="' + home + '">二维码</a>' +
    '<a class="active" href="' + other + '">Fountain 高速</a></nav>';
  var context = '<span class="qrb-context">' + (android ? '高速接收' : subtitle) + '</span>';
  var agpl = '<a class="qrb-agpl" href="https://github.com/bashalarmistalt/decimen-optical-transfer" target="_blank" rel="noopener noreferrer">AGPL</a>';
  header.innerHTML = brand + context + modes + agpl;
  document.body.insertBefore(header, document.body.firstChild);
}());
