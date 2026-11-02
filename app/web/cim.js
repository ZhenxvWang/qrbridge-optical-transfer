/*
 * 码桥 QuantumGrid v1 - 实验性高密度色码
 *
 * 112x112 单元、8 色 RGB（3 bit/单元）、4 个角锚点、单应性透视校正、
 * 伪随机掩码、RA-LDPC（率约 0.625）和 CBOR 元数据。
 * 纯浏览器 JS，无外部依赖。
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CIM = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var GRID = 112;
  var CELL = 8;
  var CANVAS = 1024;
  var ORIGIN = 64;
  var ANCHOR_SIZE = 32;
  var ANCHOR_CENTERS = [[32, 32], [992, 32], [32, 992], [992, 992]];
  var MESSAGE_BYTES = 2940;
  var HEADER_BYTES = 32;
  var BODY_MAX = MESSAGE_BYTES - HEADER_BYTES;
  var BITS_PER_CELL = 3;
  var CODE_BITS = GRID * GRID * BITS_PER_CELL;
  var PARITY_BITS = 14112;
  var DATA_BITS = CODE_BITS - PARITY_BITS;
  var EDGES_PER_ROW = 5;
  var MASK_SEED = 0x9e3779b9;
  var PALETTE = [
    [0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255],
    [0, 255, 255], [255, 0, 255], [255, 255, 0], [255, 255, 255]
  ];

  /* ---------------- CRC32 ---------------- */
  var crcTable = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  }());

  function crc32(bytes, start, length) {
    var crc = 0xffffffff;
    var end = start + length;
    for (var i = start; i < end; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  /* ---------------- CBOR（只覆盖本项目需要的类型） ---------------- */
  function cborHead(major, value, out) {
    if (value < 24) {
      out.push((major << 5) | value);
    } else if (value < 256) {
      out.push((major << 5) | 24, value);
    } else if (value < 65536) {
      out.push((major << 5) | 25, (value >>> 8) & 255, value & 255);
    } else {
      out.push((major << 5) | 26,
        (value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
    }
  }

  function cborEncode(value, out) {
    out = out || [];
    if (value === null) {
      out.push(0xf6);
    } else if (value === false) {
      out.push(0xf4);
    } else if (value === true) {
      out.push(0xf5);
    } else if (typeof value === 'number' && isFinite(value) && Math.floor(value) === value) {
      if (value >= 0) cborHead(0, value, out);
      else cborHead(1, -value - 1, out);
    } else if (typeof value === 'string') {
      var utf8 = new TextEncoder().encode(value);
      cborHead(3, utf8.length, out);
      for (var i = 0; i < utf8.length; i++) out.push(utf8[i]);
    } else if (value instanceof Uint8Array) {
      cborHead(2, value.length, out);
      for (var j = 0; j < value.length; j++) out.push(value[j]);
    } else if (Array.isArray(value)) {
      cborHead(4, value.length, out);
      value.forEach(function (item) { cborEncode(item, out); });
    } else if (typeof value === 'object') {
      var keys = Object.keys(value);
      cborHead(5, keys.length, out);
      keys.forEach(function (key) {
        cborEncode(/^-?\d+$/.test(key) ? Number(key) : key, out);
        cborEncode(value[key], out);
      });
    } else {
      throw new Error('CBOR type unsupported');
    }
    return new Uint8Array(out);
  }

  function cborRead(data, offset) {
    var initial = data[offset++];
    var major = initial >>> 5;
    var additional = initial & 31;
    var value;
    if (additional < 24) value = additional;
    else if (additional === 24) value = data[offset++];
    else if (additional === 25) { value = (data[offset] << 8) | data[offset + 1]; offset += 2; }
    else if (additional === 26) {
      value = ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
      offset += 4;
    } else throw new Error('CBOR length unsupported');

    if (major === 0) return [value, offset];
    if (major === 1) return [-value - 1, offset];
    if (major === 2 || major === 3) {
      var bytes = data.subarray(offset, offset + value);
      if (major === 3) return [new TextDecoder().decode(bytes), offset + value];
      return [new Uint8Array(bytes), offset + value];
    }
    if (major === 4) {
      var arr = [];
      for (var i = 0; i < value; i++) {
        var item = cborRead(data, offset);
        arr.push(item[0]); offset = item[1];
      }
      return [arr, offset];
    }
    if (major === 5) {
      var map = {};
      for (var j = 0; j < value; j++) {
        var k = cborRead(data, offset); offset = k[1];
        var v = cborRead(data, offset); offset = v[1];
        map[String(k[0])] = v[0];
      }
      return [map, offset];
    }
    if (major === 7) {
      if (additional === 20) return [false, offset];
      if (additional === 21) return [true, offset];
      if (additional === 22) return [null, offset];
    }
    throw new Error('CBOR unsupported major ' + major);
  }

  function cborDecode(bytes, offset) {
    return cborRead(bytes, offset || 0)[0];
  }

  /* ---------------- PRNG / 掩码 / 交织 ---------------- */
  function xorshift(state) {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state >>> 0;
  }

  var maskBits = (function () {
    var bits = new Uint8Array(CODE_BITS);
    var s = MASK_SEED;
    for (var i = 0; i < CODE_BITS; i++) {
      s = xorshift(s);
      bits[i] = s & 1;
    }
    return bits;
  }());

  var cellToBit = (function () {
    var order = new Uint32Array(CODE_BITS);
    for (var i = 0; i < CODE_BITS; i++) order[i] = i;
    var s = 0x2468ace0;
    for (var n = CODE_BITS - 1; n > 0; n--) {
      s = xorshift(s);
      var j = s % (n + 1);
      var t = order[n]; order[n] = order[j]; order[j] = t;
    }
    return order;
  }());

  /* ---------------- RA-LDPC（率约 0.625） ---------------- */
  var edges = (function () {
    var values = new Uint32Array(DATA_BITS * 3);
    for (var i = 0; i < values.length; i++) values[i] = i % DATA_BITS;
    var s = 0x13579bdf;
    for (var n = values.length - 1; n > 0; n--) {
      s = xorshift(s);
      var j = s % (n + 1);
      var tmp = values[n]; values[n] = values[j]; values[j] = tmp;
    }
    var rows = new Uint32Array(PARITY_BITS * EDGES_PER_ROW);
    for (var r = 0; r < PARITY_BITS; r++) {
      for (var e = 0; e < EDGES_PER_ROW; e++) rows[r * EDGES_PER_ROW + e] = values[r * EDGES_PER_ROW + e];
    }
    return rows;
  }());

  function bytesToBits(bytes) {
    var bits = new Uint8Array(bytes.length * 8);
    for (var i = 0; i < bytes.length; i++) {
      for (var b = 0; b < 8; b++) bits[i * 8 + b] = (bytes[i] >>> (7 - b)) & 1;
    }
    return bits;
  }

  function bitsToBytes(bits, length) {
    var bytes = new Uint8Array(length);
    for (var i = 0; i < length; i++) {
      var value = 0;
      for (var b = 0; b < 8; b++) value = (value << 1) | (bits[i * 8 + b] & 1);
      bytes[i] = value;
    }
    return bytes;
  }

  function ldpcEncode(messageBits) {
    var parity = new Uint8Array(PARITY_BITS);
    var acc = 0;
    for (var r = 0; r < PARITY_BITS; r++) {
      var base = r * EDGES_PER_ROW;
      for (var e = 0; e < EDGES_PER_ROW; e++) acc ^= messageBits[edges[base + e]];
      parity[r] = acc;
    }
    var code = new Uint8Array(CODE_BITS);
    code.set(messageBits, 0);
    code.set(parity, DATA_BITS);
    return code;
  }

  function ldpcDecodeErasures(codeBits) {
    // codeBits: Int8Array(CODE_BITS), -1 means erased
    var passes = 0;
    var changed = true;
    while (changed && passes < 80) {
      changed = false;
      passes += 1;
      for (var r = 0; r < PARITY_BITS; r++) {
        var unknown = -1;
        var count = 0;
        var value = 0;
        if (r > 0) {
          var pPrev = codeBits[DATA_BITS + r - 1];
          if (pPrev < 0) { count++; unknown = DATA_BITS + r - 1; } else value ^= pPrev;
        }
        var pCur = codeBits[DATA_BITS + r];
        if (pCur < 0) { count++; unknown = DATA_BITS + r; } else value ^= pCur;
        var base = r * EDGES_PER_ROW;
        for (var e = 0; e < EDGES_PER_ROW; e++) {
          var index = edges[base + e];
          var bit = codeBits[index];
          if (bit < 0) { count++; unknown = index; } else value ^= bit;
        }
        if (count === 0) {
          if (value !== 0) return null;
        } else if (count === 1) {
          codeBits[unknown] = value;
          changed = true;
        }
      }
    }
    for (var i = 0; i < CODE_BITS; i++) if (codeBits[i] < 0) return null;
    // 全部恢复后做一次完整的奇偶校验，防止误恢复。
    for (var rr = 0; rr < PARITY_BITS; rr++) {
      var check = rr > 0 ? codeBits[DATA_BITS + rr - 1] : 0;
      check ^= codeBits[DATA_BITS + rr];
      var bbase = rr * EDGES_PER_ROW;
      for (var ee = 0; ee < EDGES_PER_ROW; ee++) check ^= codeBits[edges[bbase + ee]];
      if (check !== 0) return null;
    }
    return bitsToBytes(codeBits, MESSAGE_BYTES);
  }

  /* ---------------- 帧消息 ---------------- */
  function buildMessage(type, tid, total, index, body, flags) {
    if (body.length > BODY_MAX) throw new Error('body too large');
    var msg = new Uint8Array(MESSAGE_BYTES);
    msg[0] = 0x43; msg[1] = 0x47; msg[2] = 0x31;
    msg[3] = type;
    msg[4] = (tid >>> 24) & 255; msg[5] = (tid >>> 16) & 255; msg[6] = (tid >>> 8) & 255; msg[7] = tid & 255;
    msg[8] = (total >>> 24) & 255; msg[9] = (total >>> 16) & 255; msg[10] = (total >>> 8) & 255; msg[11] = total & 255;
    msg[12] = (index >>> 24) & 255; msg[13] = (index >>> 16) & 255; msg[14] = (index >>> 8) & 255; msg[15] = index & 255;
    msg[16] = (body.length >>> 8) & 255; msg[17] = body.length & 255;
    msg[18] = flags || 0;
    msg[19] = 1;
    msg.set(body, HEADER_BYTES);
    var crc = crc32(msg, 0, 20);
    msg[20] = (crc >>> 24) & 255; msg[21] = (crc >>> 16) & 255; msg[22] = (crc >>> 8) & 255; msg[23] = crc & 255;
    var bodyCrc = crc32(msg, HEADER_BYTES, body.length);
    // 第二个 CRC 放在 24-27，覆盖 body，避免 body 损坏被误收。
    msg[24] = (bodyCrc >>> 24) & 255; msg[25] = (bodyCrc >>> 16) & 255; msg[26] = (bodyCrc >>> 8) & 255; msg[27] = bodyCrc & 255;
    return msg;
  }

  function parseMessage(msg) {
    if (!msg || msg.length !== MESSAGE_BYTES) return null;
    if (msg[0] !== 0x43 || msg[1] !== 0x47 || msg[2] !== 0x31) return null;
    var type = msg[3];
    var tid = ((msg[4] << 24) | (msg[5] << 16) | (msg[6] << 8) | msg[7]) >>> 0;
    var total = ((msg[8] << 24) | (msg[9] << 16) | (msg[10] << 8) | msg[11]) >>> 0;
    var index = ((msg[12] << 24) | (msg[13] << 16) | (msg[14] << 8) | msg[15]) >>> 0;
    var bodyLen = (msg[16] << 8) | msg[17];
    var flags = msg[18];
    if (bodyLen > BODY_MAX) return null;
    var crc = ((msg[20] << 24) | (msg[21] << 16) | (msg[22] << 8) | msg[23]) >>> 0;
    if (crc32(msg, 0, 20) !== crc) return null;
    var bodyCrc = ((msg[24] << 24) | (msg[25] << 16) | (msg[26] << 8) | msg[27]) >>> 0;
    if (crc32(msg, HEADER_BYTES, bodyLen) !== bodyCrc) return null;
    return {
      type: type, transferId: tid, total: total, index: index,
      body: msg.subarray(HEADER_BYTES, HEADER_BYTES + bodyLen),
      flags: flags
    };
  }

  /* ---------------- 单应性 ---------------- */
  function solveLinear(matrix, vector) {
    var n = vector.length;
    for (var col = 0; col < n; col++) {
      var pivot = col;
      for (var row = col + 1; row < n; row++) {
        if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
      }
      if (Math.abs(matrix[pivot][col]) < 1e-9) return null;
      var tmp = matrix[col]; matrix[col] = matrix[pivot]; matrix[pivot] = tmp;
      var tv = vector[col]; vector[col] = vector[pivot]; vector[pivot] = tv;
      var div = matrix[col][col];
      for (var j = col; j < n; j++) matrix[col][j] /= div;
      vector[col] /= div;
      for (var r = 0; r < n; r++) {
        if (r === col) continue;
        var factor = matrix[r][col];
        if (Math.abs(factor) < 1e-12) continue;
        for (var c = col; c < n; c++) matrix[r][c] -= factor * matrix[col][c];
        vector[r] -= factor * vector[col];
      }
    }
    return vector;
  }

  function homography(from, to) {
    var A = [];
    var b = [];
    for (var i = 0; i < 4; i++) {
      var x = from[i][0], y = from[i][1], u = to[i][0], v = to[i][1];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    var h = solveLinear(A, b);
    if (!h) return null;
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }

  function applyH(H, x, y) {
    var d = H[6] * x + H[7] * y + H[8];
    return [(H[0] * x + H[1] * y + H[2]) / d, (H[3] * x + H[4] * y + H[5]) / d];
  }

  function invert3(H) {
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7], i = H[8];
    var A = e * i - f * h, B = c * h - b * i, C = b * f - c * e;
    var D = f * g - d * i, E = a * i - c * g, F = c * d - a * f;
    var G = d * h - e * g, Hh = b * g - a * h, I = a * e - b * d;
    var det = a * A + b * D + c * G;
    if (Math.abs(det) < 1e-12) return null;
    return [A / det, B / det, C / det, D / det, E / det, F / det, G / det, Hh / det, I / det];
  }

  /* ---------------- 渲染 ---------------- */
  function encodeLevels(message) {
    var messageBits = bytesToBits(message);
    var codeBits = ldpcEncode(messageBits);
    for (var i = 0; i < CODE_BITS; i++) codeBits[i] ^= maskBits[i];
    var levels = new Uint8Array(GRID * GRID);
    for (var cell = 0; cell < GRID * GRID; cell++) {
      var value = 0;
      for (var b = 0; b < BITS_PER_CELL; b++) {
        value |= codeBits[cellToBit[cell * BITS_PER_CELL + b]] << b;
      }
      levels[cell] = value;
    }
    // 第一行是 8 色校准条，覆盖的 112*3 个码位由 LDPC 擦除恢复。
    for (var gx = 0; gx < GRID; gx++) levels[gx] = gx & 7;
    return levels;
  }

  function render(canvas, message) {
    var ctx = canvas.getContext('2d');
    canvas.width = CANVAS;
    canvas.height = CANVAS;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS, CANVAS);

    var levels = encodeLevels(message);
    for (var cell = 0; cell < GRID * GRID; cell++) {
      var color = PALETTE[levels[cell]];
      ctx.fillStyle = 'rgb(' + color[0] + ',' + color[1] + ',' + color[2] + ')';
      var x = ORIGIN + (cell % GRID) * CELL;
      var y = ORIGIN + Math.floor(cell / GRID) * CELL;
      ctx.fillRect(x, y, CELL, CELL);
    }

    ctx.fillStyle = '#000000';
    ANCHOR_CENTERS.forEach(function (p) {
      ctx.fillRect(p[0] - ANCHOR_SIZE / 2, p[1] - ANCHOR_SIZE / 2, ANCHOR_SIZE, ANCHOR_SIZE);
    });
    return canvas;
  }

  /* ---------------- 锚点检测 ---------------- */
  function findAnchors(imageData, width, height) {
    var maxWidth = 720;
    var scale = Math.min(1, maxWidth / width);
    var dw = Math.max(1, Math.round(width * scale));
    var dh = Math.max(1, Math.round(height * scale));
    var source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    source.getContext('2d').putImageData(imageData, 0, 0);
    var temp = document.createElement('canvas');
    temp.width = dw; temp.height = dh;
    var tctx = temp.getContext('2d');
    tctx.drawImage(source, 0, 0, dw, dh);
    var pixels;
    try { pixels = tctx.getImageData(0, 0, dw, dh); } catch (e) { return null; }
    var gray = new Uint8Array(dw * dh);
    for (var i = 0; i < dw * dh; i++) {
      var p = i * 4;
      gray[i] = (pixels.data[p] * 77 + pixels.data[p + 1] * 150 + pixels.data[p + 2] * 29) >> 8;
    }
    var threshold = 65;
    var seen = new Uint8Array(dw * dh);
    var candidates = [];
    var stack = new Int32Array(dw * dh);
    for (var start = 0; start < gray.length; start++) {
      if (seen[start] || gray[start] >= threshold) continue;
      var top = 0; stack[top++] = start; seen[start] = 1;
      var area = 0, minX = dw, maxX = 0, minY = dh, maxY = 0, sumX = 0, sumY = 0;
      while (top > 0) {
        var idx = stack[--top];
        var x = idx % dw, y = (idx / dw) | 0;
        area++; sumX += x; sumY += y;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (x > 0 && !seen[idx - 1] && gray[idx - 1] < threshold) { seen[idx - 1] = 1; stack[top++] = idx - 1; }
        if (x + 1 < dw && !seen[idx + 1] && gray[idx + 1] < threshold) { seen[idx + 1] = 1; stack[top++] = idx + 1; }
        if (y > 0 && !seen[idx - dw] && gray[idx - dw] < threshold) { seen[idx - dw] = 1; stack[top++] = idx - dw; }
        if (y + 1 < dh && !seen[idx + dw] && gray[idx + dw] < threshold) { seen[idx + dw] = 1; stack[top++] = idx + dw; }
      }
      var bw = maxX - minX + 1, bh = maxY - minY + 1;
      var fill = area / (bw * bh);
      if (area >= 80 && bw >= 8 && bh >= 8 && bw <= 80 && bh <= 80 && fill > 0.65) {
        candidates.push({ x: sumX / area / scale, y: sumY / area / scale, area: area, score: area * fill });
      }
    }
    if (candidates.length < 4) return null;
    var cx = width / 2, cy = height / 2;
    var quadrants = [[], [], [], []];
    candidates.forEach(function (c) {
      var q = (c.x >= cx ? 1 : 0) + (c.y >= cy ? 2 : 0);
      quadrants[q].push(c);
    });
    if (quadrants.some(function (q) { return q.length === 0; })) return null;
    var best = quadrants.map(function (q) { q.sort(function (a, b) { return b.score - a.score; }); return q[0]; });
    // 在原始分辨率上重新求黑色锚点的质心，避免缩放带来的 1px 级偏移。
    function refine(point) {
      var radius = Math.max(12, Math.round(width * 0.014));
      var cx0 = Math.round(point.x), cy0 = Math.round(point.y);
      var sx = 0, sy = 0, weight = 0;
      for (var yy = Math.max(0, cy0 - radius); yy < Math.min(height, cy0 + radius); yy++) {
        for (var xx = Math.max(0, cx0 - radius); xx < Math.min(width, cx0 + radius); xx++) {
          var p = (yy * width + xx) * 4;
          var g = (imageData.data[p] * 77 + imageData.data[p + 1] * 150 + imageData.data[p + 2] * 29) >> 8;
          if (g < 170) {
            var w = (170 - g) / 170;
            sx += xx * w; sy += yy * w; weight += w;
          }
        }
      }
      return weight > 2 ? [sx / weight, sy / weight] : [point.x, point.y];
    }
    return [
      refine(best[0]), refine(best[1]), refine(best[2]), refine(best[3])
    ];
  }

  /* ---------------- 解码 ---------------- */
  function decodeLevels(imageData, width, height) {
    var anchors = findAnchors(imageData, width, height);
    if (!anchors) return { error: 'anchors' };
    var H = homography(ANCHOR_CENTERS, anchors);
    if (!H) return { error: 'homography', anchors: anchors };

    var rSamples = new Float32Array(GRID * GRID);
    var gSamples = new Float32Array(GRID * GRID);
    var bSamples = new Float32Array(GRID * GRID);
    var source = imageData.data;
    var idx = 0;
    for (var gy = 0; gy < GRID; gy++) {
      for (var gx = 0; gx < GRID; gx++) {
        var px = ORIGIN + (gx + 0.5) * CELL;
        var py = ORIGIN + (gy + 0.5) * CELL;
        var point = applyH(H, px, py);
        var sx = Math.round(point[0]), sy = Math.round(point[1]);
        var sr = 0, sg = 0, sb = 0, count = 0;
        for (var oy = -1; oy <= 1; oy++) {
          for (var ox = -1; ox <= 1; ox++) {
            var xx = sx + ox, yy = sy + oy;
            if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
            var p = (yy * width + xx) * 4;
            sr += source[p]; sg += source[p + 1]; sb += source[p + 2];
            count++;
          }
        }
        rSamples[idx] = count ? sr / count : 255;
        gSamples[idx] = count ? sg / count : 255;
        bSamples[idx] = count ? sb / count : 255;
        idx++;
      }
    }

    // 第一行是 8 色校准条；用它的平均 RGB 作为颜色中心。
    var calSum = [];
    var calCount = [];
    for (var c = 0; c < 8; c++) {
      calSum.push([0, 0, 0]);
      calCount.push(0);
    }
    for (var cgx = 0; cgx < GRID; cgx++) {
      var cl = cgx & 7;
      calSum[cl][0] += rSamples[cgx];
      calSum[cl][1] += gSamples[cgx];
      calSum[cl][2] += bSamples[cgx];
      calCount[cl] += 1;
    }
    var centers = [];
    for (var cc = 0; cc < 8; cc++) {
      centers.push(calCount[cc]
        ? [calSum[cc][0] / calCount[cc], calSum[cc][1] / calCount[cc], calSum[cc][2] / calCount[cc]]
        : PALETTE[cc].slice());
    }

    var erased = new Uint8Array(GRID * GRID);
    for (var ce = 0; ce < GRID; ce++) erased[ce] = 1;

    var levels = new Uint8Array(GRID * GRID);
    for (var cell = 0; cell < GRID * GRID; cell++) {
      var best = 0, bestDist = Infinity;
      for (var l = 0; l < 8; l++) {
        var dr = rSamples[cell] - centers[l][0];
        var dg = gSamples[cell] - centers[l][1];
        var db = bSamples[cell] - centers[l][2];
        var dd = dr * dr + dg * dg + db * db;
        if (dd < bestDist) { bestDist = dd; best = l; }
      }
      levels[cell] = best;
      // RGB 距离过大视为不可靠单元，交给 LDPC 擦除。
      if (Math.sqrt(bestDist) > 105) erased[cell] = 1;
    }
    return { levels: levels, erased: erased, centers: centers, anchors: anchors, samples: rSamples };
  }

  function decodeFrame(imageData, width, height) {
    var sampled = decodeLevels(imageData, width, height);
    if (sampled.error) return sampled;
    var codeBits = new Int8Array(CODE_BITS);
    var erasedCells = 0;
    for (var cell = 0; cell < GRID * GRID; cell++) {
      if (sampled.erased[cell]) {
        erasedCells++;
        for (var eb = 0; eb < BITS_PER_CELL; eb++) codeBits[cellToBit[cell * BITS_PER_CELL + eb]] = -1;
      } else {
        var lvl = sampled.levels[cell];
        for (var b = 0; b < BITS_PER_CELL; b++) {
          codeBits[cellToBit[cell * BITS_PER_CELL + b]] = (lvl >> b) & 1;
        }
      }
    }
    for (var m = 0; m < CODE_BITS; m++) if (codeBits[m] >= 0) codeBits[m] ^= maskBits[m];
    var decoded = ldpcDecodeErasures(codeBits);
    if (!decoded) return { error: 'ldpc', centers: sampled.centers, anchors: sampled.anchors, erasedCells: erasedCells };
    var message = parseMessage(decoded);
    if (!message) return { error: 'crc', centers: sampled.centers, anchors: sampled.anchors, erasedCells: erasedCells };
    message.centers = sampled.centers;
    return message;
  }

  function buildMetaBody(meta) {
    var map = {
      1: meta.name,
      2: meta.size,
      3: meta.payloadSize,
      4: meta.sha256,
      5: meta.flags || 0,
      6: meta.total,
      7: meta.chunkSize,
      8: meta.salt || new Uint8Array(0),
      9: meta.iv || new Uint8Array(0)
    };
    return cborEncode(map);
  }

  function parseMetaBody(body) {
    var map = cborDecode(body);
    if (!map || !map[1] || !map[2]) return null;
    return {
      name: map[1], size: map[2], payloadSize: map[3], sha256: map[4],
      flags: map[5] || 0, total: map[6], chunkSize: map[7],
      salt: map[8] || new Uint8Array(0), iv: map[9] || new Uint8Array(0)
    };
  }

  return {
    GRID: GRID,
    CELL: CELL,
    CANVAS: CANVAS,
    ORIGIN: ORIGIN,
    ANCHOR_CENTERS: ANCHOR_CENTERS,
    MESSAGE_BYTES: MESSAGE_BYTES,
    BODY_MAX: BODY_MAX,
    DATA_BITS: DATA_BITS,
    PARITY_BITS: PARITY_BITS,
    crc32: crc32,
    cborEncode: cborEncode,
    cborDecode: cborDecode,
    ldpcEncode: ldpcEncode,
    ldpcDecodeErasures: ldpcDecodeErasures,
    bytesToBits: bytesToBits,
    bitsToBytes: bitsToBytes,
    buildMessage: buildMessage,
    parseMessage: parseMessage,
    buildMetaBody: buildMetaBody,
    parseMetaBody: parseMetaBody,
    findAnchors: findAnchors,
    homography: homography,
    applyH: applyH,
    invert3: invert3,
    ANCHOR_CENTERS: ANCHOR_CENTERS,
    encodeLevels: encodeLevels,
    decodeLevels: decodeLevels,
    render: render,
    decodeFrame: decodeFrame
  };
}));
