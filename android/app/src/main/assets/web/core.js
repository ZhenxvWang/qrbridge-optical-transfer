/*
 * 码桥 QR Bridge 2.0 - 传输协议核心
 *
 * QFT2：Base32 + 字母数字模式二维码 + gzip 压缩 + 1/4 路并行。
 * 所有处理都在本地完成。
 *
 * License: MIT
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.QRBCore = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var globalObject = typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this);

  var MAGIC = 'QFT2';
  var MAX_FILE_BYTES = 8 * 1024 * 1024;
  var MAX_CHUNKS = 99999;
  var META_GROUP_EVERY = 24;
  var DEFAULT_CHANNELS = 4;
  var BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  var PROFILES = {
    stable: {
      id: 'stable',
      label: '稳定',
      chunkSize: 220,
      qrVersion: 10,
      hint: '模块更大，适合远距离、旧摄像头或屏幕有反光时使用'
    },
    balanced: {
      id: 'balanced',
      label: '均衡',
      chunkSize: 440,
      qrVersion: 15,
      hint: '速度与可识别度的平衡，推荐先用这一档'
    },
    fast: {
      id: 'fast',
      label: '快速',
      chunkSize: 745,
      qrVersion: 20,
      hint: '单帧数据更多，需要摄像头清晰、距离较近，建议全屏'
    }
  };

  function padNumber(value, width) {
    var text = String(Math.max(0, Math.floor(value)));
    while (text.length < width) text = '0' + text;
    return text;
  }

  function byteLengthOfUtf8(text) {
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(text).length;
    }
    return unescape(encodeURIComponent(text)).length;
  }

  /* ------------------------------------------------------------
   * Base32（RFC 4648，无填充）
   * 使用大写字母和 2-7，正好落在二维码 Alphanumeric 字符集内。
   * ---------------------------------------------------------- */

  function bytesToBase32(bytes) {
    var out = '';
    var buffer = 0;
    var bits = 0;
    for (var i = 0; i < bytes.length; i++) {
      buffer = (buffer << 8) | bytes[i];
      bits += 8;
      while (bits >= 5) {
        out += BASE32.charAt((buffer >>> (bits - 5)) & 31);
        bits -= 5;
      }
    }
    if (bits > 0) {
      out += BASE32.charAt((buffer << (5 - bits)) & 31);
    }
    return out;
  }

  function base32ToBytes(text) {
    var out = new Uint8Array(Math.floor((text.length * 5) / 8));
    var buffer = 0;
    var bits = 0;
    var pos = 0;
    for (var i = 0; i < text.length; i++) {
      var value = BASE32.indexOf(text.charAt(i));
      if (value < 0) throw new Error('invalid base32');
      buffer = (buffer << 5) | value;
      bits += 5;
      if (bits >= 8) {
        out[pos++] = (buffer >>> (bits - 8)) & 255;
        bits -= 8;
      }
    }
    return out;
  }

  function utf8ToBase32(text) {
    if (typeof TextEncoder !== 'undefined') {
      return bytesToBase32(new TextEncoder().encode(text));
    }
    return bytesToBase32(new Uint8Array(unescape(encodeURIComponent(text)).split('').map(function (ch) {
      return ch.charCodeAt(0);
    })));
  }

  function base32ToUtf8(text) {
    var bytes = base32ToBytes(text);
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }
    return decodeURIComponent(escape(String.fromCharCode.apply(null, bytes)));
  }

  function randomTransferId() {
    var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var out = '';
    var values;
    if (globalObject.crypto && globalObject.crypto.getRandomValues) {
      values = new Uint8Array(8);
      globalObject.crypto.getRandomValues(values);
    } else {
      values = new Uint8Array(8);
      for (var i = 0; i < values.length; i++) values[i] = Math.floor(Math.random() * 256);
    }
    for (var j = 0; j < values.length; j++) out += alphabet.charAt(values[j] % alphabet.length);
    return out;
  }

  /* ------------------------------------------------------------
   * 压缩
   * ---------------------------------------------------------- */

  function gzipBytes(bytes) {
    if (!(globalObject.fflate && globalObject.fflate.gzipSync)) {
      throw new Error('压缩组件未加载');
    }
    return globalObject.fflate.gzipSync(bytes, { level: 6, mtime: 0 });
  }

  function gunzipBytes(bytes) {
    if (!(globalObject.fflate && globalObject.fflate.gunzipSync)) {
      throw new Error('解压组件未加载');
    }
    return globalObject.fflate.gunzipSync(bytes);
  }

  function preparePayload(data) {
    if (!(data instanceof Uint8Array)) data = new Uint8Array(data);
    try {
      var compressed = gzipBytes(data);
      if (compressed.length + 64 < data.length) {
        return { payload: compressed, flags: 1 };
      }
    } catch (error) {
      /* 压缩不可用时直接发送原始数据 */
    }
    return { payload: data, flags: 0 };
  }

  /* ------------------------------------------------------------
   * 协议
   * ---------------------------------------------------------- */

  function totalChunks(fileSize, chunkSize) {
    if (!fileSize || fileSize < 0 || !chunkSize) return 0;
    return Math.ceil(fileSize / chunkSize);
  }

  function makeMetaFrame(meta) {
    var flags = (meta.flags || 0) & 1;
    if (meta.channels === 4) flags |= 2;
    return [
      MAGIC,
      'M',
      meta.transferId,
      padNumber(meta.total, 5),
      padNumber(meta.chunkSize, 4),
      utf8ToBase32(meta.fileName),
      String(meta.fileSize),
      String(meta.payloadSize),
      meta.sha256.toUpperCase(),
      String(flags)
    ].join(':');
  }

  function makeDataFrame(frame) {
    var payload = frame.payload;
    if (!(payload instanceof Uint8Array)) payload = new Uint8Array(payload);
    return [
      MAGIC,
      'D',
      frame.transferId,
      padNumber(frame.total, 5),
      padNumber(frame.chunkSize, 4),
      padNumber(frame.index, 5),
      String(frame.channels || 1),
      bytesToBase32(payload)
    ].join(':');
  }

  function parseFrame(text) {
    if (typeof text !== 'string' || text.length < 20 || text.length > 4096) return null;
    if (text.indexOf(MAGIC + ':') !== 0) return null;
    var parts = text.split(':');
    if (parts.length < 8 || parts[0] !== MAGIC) return null;
    var kind = parts[1];
    var transferId = parts[2];
    if (!/^[A-Z2-9]{8}$/.test(transferId)) return null;
    var total = parseInt(parts[3], 10);
    var chunkSize = parseInt(parts[4], 10);
    if (!(total >= 1 && total <= MAX_CHUNKS)) return null;
    if (!(chunkSize >= 64 && chunkSize <= 1280 && chunkSize % 5 === 0)) return null;
    if (total * chunkSize > MAX_FILE_BYTES + chunkSize) return null;

    if (kind === 'D') {
      if (parts.length !== 8) return null;
      var index = parseInt(parts[5], 10);
      var channels = parseInt(parts[6], 10);
      if (!(index >= 0 && index < total)) return null;
      if (channels !== 1 && channels !== 4) return null;
      if (!/^[A-Z2-7]+$/.test(parts[7])) return null;
      var payload;
      try {
        payload = base32ToBytes(parts[7]);
      } catch (error) {
        return null;
      }
      if (payload.length !== chunkSize) return null;
      return {
        kind: 'data',
        transferId: transferId,
        total: total,
        chunkSize: chunkSize,
        index: index,
        channels: channels,
        payload: payload
      };
    }

    if (kind === 'M') {
      if (parts.length !== 10) return null;
      var fileName;
      try {
        if (!/^[A-Z2-7]+$/.test(parts[5])) return null;
        fileName = base32ToUtf8(parts[5]);
      } catch (error2) {
        return null;
      }
      var fileSize = parseInt(parts[6], 10);
      var payloadSize = parseInt(parts[7], 10);
      var sha256 = String(parts[8] || '').toUpperCase();
      var flags = parseInt(parts[9], 10);
      if (!(fileSize >= 1 && fileSize <= MAX_FILE_BYTES)) return null;
      if (!(payloadSize >= 1 && payloadSize <= MAX_FILE_BYTES)) return null;
      if (!/^[A-F0-9]{64}$/.test(sha256)) return null;
      if (!(flags >= 0 && flags <= 3)) return null;
      if (total !== totalChunks(payloadSize, chunkSize)) return null;
      return {
        kind: 'meta',
        transferId: transferId,
        total: total,
        chunkSize: chunkSize,
        fileName: fileName,
        fileSize: fileSize,
        payloadSize: payloadSize,
        sha256: sha256.toLowerCase(),
        flags: flags,
        compressed: (flags & 1) === 1,
        channels: (flags & 2) === 2 ? 4 : 1
      };
    }

    return null;
  }

  function buildChunks(data, chunkSize) {
    if (!(data instanceof Uint8Array)) data = new Uint8Array(data);
    var total = totalChunks(data.length, chunkSize);
    var chunks = new Array(total);
    for (var i = 0; i < total; i++) {
      var start = i * chunkSize;
      var source = data.subarray(start, Math.min(start + chunkSize, data.length));
      var padded = new Uint8Array(chunkSize);
      padded.set(source);
      chunks[i] = padded;
    }
    return chunks;
  }

  function assemble(chunks, payloadSize) {
    var out = new Uint8Array(payloadSize);
    var offset = 0;
    for (var i = 0; i < chunks.length && offset < payloadSize; i++) {
      var length = Math.min(chunks[i].length, payloadSize - offset);
      out.set(chunks[i].subarray(0, length), offset);
      offset += length;
    }
    return out;
  }

  function sha256Hex(bytes) {
    if (!(globalObject.crypto && globalObject.crypto.subtle && globalObject.crypto.subtle.digest)) {
      return Promise.reject(new Error('当前浏览器不支持 SHA-256 校验'));
    }
    return globalObject.crypto.subtle.digest('SHA-256', bytes).then(function (buffer) {
      var view = new Uint8Array(buffer);
      var hex = '';
      for (var i = 0; i < view.length; i++) {
        var part = view[i].toString(16);
        hex += part.length < 2 ? '0' + part : part;
      }
      return hex;
    });
  }

  function estimateRoundSeconds(total, fps, channels) {
    var lanes = channels === 4 ? 4 : 1;
    var groups = Math.ceil(total / lanes);
    var slots = groups + Math.ceil(groups / META_GROUP_EVERY) + 1;
    return slots / Math.max(1, fps);
  }

  function throughputBytesPerSecond(chunkSize, channels, fps) {
    return (chunkSize * (channels === 4 ? 4 : 1) * Math.max(1, fps));
  }

  function safeFileName(name) {
    var cleaned = String(name || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/^\.+/, '')
      .trim();
    if (!cleaned) cleaned = 'received.bin';
    if (cleaned.length > 180) {
      var dot = cleaned.lastIndexOf('.');
      var ext = dot > 0 ? cleaned.slice(dot) : '';
      if (ext.length > 12) ext = '';
      cleaned = cleaned.slice(0, 180 - ext.length) + ext;
    }
    return cleaned;
  }

  var MIME_TYPES = {
    txt: 'text/plain',
    log: 'text/plain',
    csv: 'text/csv',
    json: 'application/json',
    xml: 'application/xml',
    html: 'text/html',
    htm: 'text/html',
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    zip: 'application/zip',
    gz: 'application/gzip',
    tar: 'application/x-tar',
    '7z': 'application/x-7z-compressed',
    rar: 'application/vnd.rar',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    exe: 'application/vnd.microsoft.portable-executable',
    deb: 'application/vnd.debian.binary-package',
    sh: 'text/x-shellscript'
  };

  function mimeForName(name) {
    var match = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    if (!match) return 'application/octet-stream';
    return MIME_TYPES[match[1].toLowerCase()] || 'application/octet-stream';
  }

  return {
    MAGIC: MAGIC,
    MAX_FILE_BYTES: MAX_FILE_BYTES,
    MAX_CHUNKS: MAX_CHUNKS,
    META_GROUP_EVERY: META_GROUP_EVERY,
    DEFAULT_CHANNELS: DEFAULT_CHANNELS,
    PROFILES: PROFILES,
    padNumber: padNumber,
    byteLengthOfUtf8: byteLengthOfUtf8,
    bytesToBase32: bytesToBase32,
    base32ToBytes: base32ToBytes,
    utf8ToBase32: utf8ToBase32,
    base32ToUtf8: base32ToUtf8,
    randomTransferId: randomTransferId,
    gzipBytes: gzipBytes,
    gunzipBytes: gunzipBytes,
    preparePayload: preparePayload,
    totalChunks: totalChunks,
    makeMetaFrame: makeMetaFrame,
    makeDataFrame: makeDataFrame,
    parseFrame: parseFrame,
    buildChunks: buildChunks,
    assemble: assemble,
    sha256Hex: sha256Hex,
    estimateRoundSeconds: estimateRoundSeconds,
    throughputBytesPerSecond: throughputBytesPerSecond,
    safeFileName: safeFileName,
    mimeForName: mimeForName
  };
}));
