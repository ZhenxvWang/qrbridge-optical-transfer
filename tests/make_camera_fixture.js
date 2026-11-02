// Generate a 1280x720 Y4M fake-camera fixture containing a QFT2 four-way QR grid.
// Usage: node tests/make_camera_fixture.js <output.y4m>
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const C = require('../app/web/core.js');

const output = path.resolve(process.argv[2] || '.run/qr-camera.y4m');
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/web/vendor/qrcode.js'), 'utf8'), sandbox);

const width = 1280;
const height = 720;
const chunkSize = 440;
const total = 4;
const transferId = 'ABCD2345';
const rgba = Buffer.alloc(width * height * 4, 255);

function fillRect(x, y, w, h) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const index = (yy * width + xx) * 4;
      rgba[index] = 0;
      rgba[index + 1] = 0;
      rgba[index + 2] = 0;
    }
  }
}

const offsets = [[0, 0], [640, 0], [0, 360], [640, 360]];
const codes = [];
for (let i = 0; i < 4; i++) {
  const payload = new Uint8Array(chunkSize);
  for (let j = 0; j < chunkSize; j++) payload[j] = (i * 41 + j * 13 + 7) & 255;
  const text = C.makeDataFrame({
    transferId,
    total,
    chunkSize,
    index: i,
    channels: 4,
    payload
  });
  const qr = sandbox.qrcode(15, 'L');
  qr.addData(text, 'Alphanumeric');
  qr.make();
  const count = qr.getModuleCount();
  const box = 352;
  const scale = Math.floor(box / (count + 8));
  const qrPixels = count * scale;
  const ox = offsets[i][0] + 144 + Math.floor((box - qrPixels) / 2);
  const oy = offsets[i][1] + 4 + Math.floor((box - qrPixels) / 2);
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) fillRect(ox + col * scale, oy + row * scale, scale, scale);
    }
  }
  codes.push({ textLength: text.length, moduleCount: count, scale });
}

const yPlane = Buffer.alloc(width * height);
for (let i = 0, p = 0; i < yPlane.length; i++, p += 4) {
  // QR is pure black/white; its BT.601 luma is already 0/255.
  yPlane[i] = rgba[p];
}
const uPlane = Buffer.alloc((width / 2) * (height / 2), 128);
const vPlane = Buffer.alloc((width / 2) * (height / 2), 128);

const frames = 12;
const fd = fs.openSync(output, 'w');
fs.writeSync(fd, Buffer.from(`YUV4MPEG2 W${width} H${height} F10:1 Ip A1:1 C420jpeg\n`));
for (let frame = 0; frame < frames; frame++) {
  fs.writeSync(fd, Buffer.from('FRAME\n'));
  fs.writeSync(fd, yPlane);
  fs.writeSync(fd, uPlane);
  fs.writeSync(fd, vPlane);
}
fs.closeSync(fd);
console.log(JSON.stringify({
  output,
  size: fs.statSync(output).size,
  frames,
  width,
  height,
  transferId,
  total,
  chunkSize,
  codes
}, null, 2));
