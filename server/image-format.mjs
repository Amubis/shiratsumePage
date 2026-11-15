/** Strict image container inspection shared by the local server and Cloudflare Worker.
 * This deliberately supports the browser image formats accepted by the uploader.
 * It does not trust the extension or Content-Type supplied by the browser.
 */
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const MIME_EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MAX_DIMENSION = 20_000;
const MAX_PIXELS = 100_000_000;

function invalid(message = 'Invalid or truncated image data') {
  throw new Error(message);
}
function dimensions(width, height) {
  if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    invalid('Image dimensions exceed the supported limit');
  }
  return { width, height };
}
function ascii(bytes, start, length) {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}
function u16be(bytes, offset) { return bytes[offset] * 256 + bytes[offset + 1]; }
function u32be(bytes, offset) { return (bytes[offset] * 0x1000000 + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0; }
function u32le(bytes, offset) { return (bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16) + bytes[offset + 3] * 0x1000000) >>> 0; }
function u24le(bytes, offset) { return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16); }

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(bytes, start, end) {
  let value = 0xffffffff;
  for (let i = start; i < end; i++) value = CRC_TABLE[(value ^ bytes[i]) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function png(bytes) {
  if (bytes.length < 57 || !PNG_SIGNATURE.every((v, i) => bytes[i] === v)) invalid();
  let offset = 8;
  let size;
  let colorType;
  let bitDepth;
  let idatSeen = false;
  let idatEnded = false;
  let paletteSeen = false;
  let compressedBytes = 0;
  const zlibHeader = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) invalid();
    const length = u32be(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    if (!/^[A-Za-z]{4}$/.test(type) || type[2] !== type[2].toUpperCase()) invalid();
    const data = offset + 8;
    const end = data + length;
    if (end + 4 > bytes.length) invalid('Invalid PNG chunk');
    // IDAT can be 25 MiB. Avoid a second full byte scan in CPU-limited Workers;
    // validate its complete container boundaries and zlib header below. Small
    // control chunks, including IHDR, keep their integrity check.
    if (type !== 'IDAT' && length <= 65_536 && crc32(bytes, offset + 4, end) !== u32be(bytes, end)) invalid('Invalid PNG chunk checksum');
    if (offset === 8 && type !== 'IHDR') invalid();
    if (type === 'IHDR') {
      if (offset !== 8 || length !== 13) invalid();
      size = dimensions(u32be(bytes, data), u32be(bytes, data + 4));
      bitDepth = bytes[data + 8];
      colorType = bytes[data + 9];
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[colorType]?.includes(bitDepth) || bytes[data + 10] || bytes[data + 11] || bytes[data + 12] > 1) invalid();
    } else if (type === 'PLTE') {
      if (paletteSeen || idatSeen || colorType === 0 || colorType === 4 || length < 3 || length > 768 || length % 3 || (colorType === 3 && length / 3 > 2 ** bitDepth)) invalid();
      paletteSeen = true;
    } else if (type === 'IDAT') {
      if (idatEnded || (colorType === 3 && !paletteSeen)) invalid();
      for (let i = 0; i < length && zlibHeader.length < 2; i++) zlibHeader.push(bytes[data + i]);
      idatSeen = true;
      compressedBytes += length;
    } else if (type === 'IEND') {
      if (length || !idatSeen || compressedBytes < 6 || end + 4 !== bytes.length) invalid();
      // PNG uses a zlib stream with deflate and without a preset dictionary.
      const [cmf, flg] = zlibHeader;
      if ((cmf & 15) !== 8 || (cmf >>> 4) > 7 || ((cmf << 8) + flg) % 31 || (flg & 32)) invalid();
      return size;
    } else {
      if (idatSeen) idatEnded = true;
      // Unknown critical chunks cannot be decoded safely by a conforming reader.
      if (type[0] === type[0].toUpperCase()) invalid('Unsupported PNG critical chunk');
    }
    offset = end + 4;
  }
  invalid();
}

function jpeg(bytes) {
  if (bytes.length < 26 || bytes[0] !== 255 || bytes[1] !== 216) invalid();
  let offset = 2;
  let size;
  let components = [];
  let scans = 0;
  let entropyBytes = 0;
  let quantization = false;
  let huffman = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 255) invalid();
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 217) {
      if (!size || !scans || !entropyBytes || !quantization || !huffman || offset !== bytes.length) invalid();
      return size;
    }
    if (marker === undefined || marker === 0 || marker === 216 || (marker >= 208 && marker <= 215) || marker === 1) invalid();
    if (offset + 2 > bytes.length) invalid();
    const length = u16be(bytes, offset);
    const data = offset + 2;
    const end = offset + length;
    if (length < 2 || end > bytes.length) invalid();
    if ([192, 193, 194].includes(marker)) {
      if (size || length < 11 || bytes[data] !== 8) invalid('Unsupported JPEG frame');
      size = dimensions(u16be(bytes, data + 3), u16be(bytes, data + 1));
      const count = bytes[data + 5];
      if (![1, 3, 4].includes(count) || length !== 8 + 3 * count) invalid();
      for (let i = 0; i < count; i++) {
        const start = data + 6 + i * 3;
        const sampling = bytes[start + 1];
        if (components.includes(bytes[start]) || !(sampling >> 4) || (sampling >> 4) > 4 || !(sampling & 15) || (sampling & 15) > 4 || bytes[start + 2] > 3) invalid();
        components.push(bytes[start]);
      }
    } else if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
      invalid('Unsupported JPEG frame');
    } else if (marker === 219) {
      let cursor = data;
      while (cursor < end) {
        const info = bytes[cursor++];
        if ((info >> 4) > 1 || (info & 15) > 3) invalid();
        cursor += (info >> 4) ? 128 : 64;
      }
      if (cursor !== end) invalid();
      quantization = true;
    } else if (marker === 196) {
      let cursor = data;
      while (cursor < end) {
        const info = bytes[cursor++];
        if ((info >> 4) > 1 || (info & 15) > 3 || cursor + 16 > end) invalid();
        let count = 0;
        for (let i = 0; i < 16; i++) count += bytes[cursor++];
        if (!count || count > 256) invalid();
        cursor += count;
      }
      if (cursor !== end) invalid();
      huffman = true;
    } else if (marker === 218) {
      if (!size || !quantization || !huffman || length < 8) invalid();
      const count = bytes[data];
      if (!count || count > components.length || length !== 6 + 2 * count) invalid();
      const scanComponents = new Set();
      for (let i = 0; i < count; i++) {
        const id = bytes[data + 1 + i * 2];
        const tables = bytes[data + 2 + i * 2];
        if (!components.includes(id) || scanComponents.has(id) || (tables >> 4) > 3 || (tables & 15) > 3) invalid();
        scanComponents.add(id);
      }
      const spectralStart = bytes[end - 3], spectralEnd = bytes[end - 2], approximation = bytes[end - 1];
      if (spectralStart > spectralEnd || spectralEnd > 63 || (approximation >> 4) > 13 || (approximation & 15) > 13) invalid();
      scans++;
      offset = end;
      while (offset < bytes.length) {
        if (bytes[offset] !== 255) { entropyBytes++; offset++; continue; }
        const next = bytes[offset + 1];
        if (next === 0) { entropyBytes++; offset += 2; continue; }
        if (next >= 208 && next <= 215) { offset += 2; continue; }
        if (next === 255) { offset++; continue; }
        break;
      }
      continue;
    } else if (marker === 221 && length !== 4) invalid();
    offset = end;
  }
  invalid();
}

function webpFrame(bytes, start, end, type) {
  if (type === 'VP8 ') {
    if (end - start < 10 || (bytes[start] & 1) || ascii(bytes, start + 3, 3) !== '\x9d\x01\x2a') invalid();
    // The first partition length must fit in the complete encoded frame.
    const partition = (bytes[start] + (bytes[start + 1] << 8) + (bytes[start + 2] << 16)) >>> 5;
    if (partition < 1 || partition + 10 > end - start) invalid();
    return dimensions((bytes[start + 6] + (bytes[start + 7] << 8)) & 0x3fff, (bytes[start + 8] + (bytes[start + 9] << 8)) & 0x3fff);
  }
  if (end - start < 6 || bytes[start] !== 47 || bytes[start + 4] >>> 5) invalid();
  const packed = u32le(bytes, start + 1);
  return dimensions((packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1);
}
function webp(bytes) {
  if (bytes.length < 26 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP' || u32le(bytes, 4) + 8 !== bytes.length) invalid();
  let offset = 12;
  let size;
  let frame;
  let extended = false;
  let animated = false;
  let animationHeader = false;
  let frames = 0;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) invalid();
    const type = ascii(bytes, offset, 4);
    const length = u32le(bytes, offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end + (length & 1) > bytes.length || ((length & 1) && bytes[end] !== 0)) invalid();
    if (type === 'VP8X') {
      if (extended || offset !== 12 || length !== 10 || (bytes[start] & 193) || bytes[start + 1] || bytes[start + 2] || bytes[start + 3]) invalid();
      extended = true;
      animated = Boolean(bytes[start] & 2);
      size = dimensions(u24le(bytes, start + 4) + 1, u24le(bytes, start + 7) + 1);
    } else if (type === 'VP8 ' || type === 'VP8L') {
      if (frame || animated) invalid();
      frame = webpFrame(bytes, start, end, type);
    } else if (type === 'ANIM') {
      if (!animated || animationHeader || length !== 6) invalid();
      animationHeader = true;
    } else if (type === 'ANMF') {
      if (!animated || !animationHeader || length < 32 || bytes[start + 15] & 252) invalid();
      const x = u24le(bytes, start) * 2, y = u24le(bytes, start + 3) * 2;
      const width = u24le(bytes, start + 6) + 1, height = u24le(bytes, start + 9) + 1;
      if (x + width > size.width || y + height > size.height) invalid();
      let cursor = start + 16;
      let found = false;
      while (cursor < end) {
        if (cursor + 8 > end) invalid();
        const frameType = ascii(bytes, cursor, 4);
        const frameLength = u32le(bytes, cursor + 4);
        const frameStart = cursor + 8, frameEnd = frameStart + frameLength;
        if (frameEnd + (frameLength & 1) > end || ((frameLength & 1) && bytes[frameEnd])) invalid();
        if (frameType === 'VP8 ' || frameType === 'VP8L') {
          if (found) invalid();
          const encoded = webpFrame(bytes, frameStart, frameEnd, frameType);
          if (encoded.width !== width || encoded.height !== height) invalid();
          found = true;
        } else if (frameType !== 'ALPH') invalid();
        cursor = frameEnd + (frameLength & 1);
      }
      if (!found) invalid();
      frames++;
    } else if (!extended || !['ALPH', 'ICCP', 'EXIF', 'XMP '].includes(type)) invalid('Unsupported WebP chunk');
    offset = end + (length & 1);
  }
  if (offset !== bytes.length || (animated ? !frames : !frame)) invalid();
  if (size && frame && (size.width !== frame.width || size.height !== frame.height)) invalid();
  return size || frame;
}

export function inspectImage(input, claimedContentType = '') {
  const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
  if (!bytes) invalid('Image bytes must be a Uint8Array or ArrayBuffer');
  let mime, size;
  if (bytes[0] === 137 && bytes[1] === 80) { mime = 'image/png'; size = png(bytes); }
  else if (bytes[0] === 255 && bytes[1] === 216) { mime = 'image/jpeg'; size = jpeg(bytes); }
  else if (ascii(bytes, 0, 4) === 'RIFF') { mime = 'image/webp'; size = webp(bytes); }
  else invalid('Only PNG, JPEG and WebP images are accepted');
  const claimed = String(claimedContentType || '').split(';', 1)[0].trim().toLowerCase();
  if (claimed !== mime) invalid('Content-Type must match the PNG, JPEG or WebP image bytes');
  return { extension: MIME_EXTENSIONS[mime], mime, ...size };
}
