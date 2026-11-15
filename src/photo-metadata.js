// VRCX writes UTF-8 JSON into PNG Description; VRChat writes XMP into
// XML:com.adobe.xmp. Reference: vrcx-team/VRCX, commit 267cb691,
// Dotnet/ScreenshotMetadata/{PNGHelper,ScreenshotHelper}.cs.
const TEXT_LIMIT = 1024 * 1024;
const TOTAL_TEXT_LIMIT = 4 * 1024 * 1024;
const FILE_LIMIT = 128 * 1024 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true });
const latin1 = new TextDecoder('windows-1252');
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const worldPattern = /^wrld_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decode(bytes) {
  try { return utf8.decode(bytes).replace(/^\uFEFF/, '').replace(/\0+$/, ''); }
  catch { return latin1.decode(bytes).replace(/\0+$/, ''); }
}
function bytesFor(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('Photo bytes must be an ArrayBuffer or typed array.');
}
function warn(state, message) {
  if (!state.warnings.includes(message)) state.warnings.push(message);
}
function chargeText(state, size) {
  state.textBytes = (state.textBytes || 0) + size;
  if (state.textBytes <= TOTAL_TEXT_LIMIT) return true;
  warn(state, '图片内嵌文字累计过大，已跳过后续信息。'); return false;
}
function normalizedDate(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T _](\d{2})[:-](\d{2})[:-](\d{2})(?:[.,](\d{1,9}))?(?:\s*(Z|[+-]\d{2}:?\d{2}))?)?$/i);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction, zone] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  if (hour === undefined) return { value: year + '-' + month + '-' + day, timeZone: null };
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  let suffix = '';
  if (zone) {
    if (zone.toUpperCase() === 'Z') suffix = 'Z';
    else {
      const compact = zone.replace(':', '');
      const zh = Number(compact.slice(1, 3)), zm = Number(compact.slice(3));
      if (zh > 14 || zm > 59 || zh === 14 && zm !== 0) return null;
      suffix = compact.slice(0, 3) + ':' + compact.slice(3);
    }
  }
  return { value: year + '-' + month + '-' + day + 'T' + hour + ':' + minute + ':' + second + (fraction ? '.' + fraction : '') + suffix, timeZone: suffix ? 'offset' : 'unspecified' };
}
function offerDate(state, value, source, rank) {
  const date = normalizedDate(value);
  if (!date || rank <= (state.date?.rank || 0)) return false;
  state.date = { ...date, source, rank }; return true;
}
function offerWorld(state, name, id, source, rank) {
  if (typeof name === 'string' && name.trim() && rank > (state.name?.rank || 0)) {
    state.name = { value: name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 500), source, rank };
  }
  if (typeof id === 'string' && worldPattern.test(id.trim()) && rank > (state.world?.rank || 0)) {
    state.world = { value: id.trim().toLowerCase(), source, rank };
  }
}
function xmlText(value) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (all, entity) => {
    const known = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (known[entity]) return known[entity];
    const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : all;
  }).trim();
}
function xmlValue(text, localName) {
  const prefix = '(?:[\\w.-]+:)?' + localName;
  const tag = new RegExp('<' + prefix + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + prefix + '\\s*>', 'i').exec(text);
  if (tag) return xmlText(tag[1]);
  const attribute = new RegExp('(?:\\s|<)' + prefix + '\\s*=\\s*(["\\x27])([\\s\\S]*?)\\1', 'i').exec(text);
  return attribute ? xmlText(attribute[2]) : null;
}
function inspectText(state, text, source, keyword = '') {
  if (!text || text.length > TEXT_LIMIT) return;
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed);
      const application = data?.application ?? data?.Application;
      if (typeof application === 'string' && application.toUpperCase() === 'VRCX') {
        const world = data.world ?? data.World;
        offerWorld(state, world?.name ?? world?.Name, world?.id ?? world?.Id, 'vrcx:' + source, 100);
        for (const key of ['timestamp', 'Timestamp', 'creationDate', 'takenAt']) {
          if (offerDate(state, data[key], 'vrcx:' + key, 80)) break;
        }
        // Do not return player lists, author IDs or instance identifiers.
      }
    } catch { if (/Description|Comment/i.test(keyword)) warn(state, '图片描述中的 JSON 信息已损坏，未采用。'); }
  }
  if (/<(?:[\w.-]+:)?(?:xmpmeta|RDF)\b/i.test(text)) {
    offerWorld(state, xmlValue(text, 'WorldDisplayName'), xmlValue(text, 'WorldID') || xmlValue(text, 'World'), 'xmp', 90);
    for (const key of ['DateTimeOriginal', 'CreateDate', 'DateTime']) {
      if (offerDate(state, xmlValue(text, key), 'xmp:' + key, 90)) break;
    }
  }
  if (/^(?:Creation Time|DateTimeOriginal|DateTime)$/i.test(keyword)) offerDate(state, text, 'png:' + keyword, 70);
}
async function inflateText(bytes, state) {
  if (typeof DecompressionStream !== 'function') throw new Error('unavailable');
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (!chargeText(state, item.value.length) || size > TEXT_LIMIT) { await reader.cancel(); throw new Error('limit'); }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
function zeroAt(bytes, start) {
  const index = bytes.indexOf(0, start);
  return index < 0 ? bytes.length : index;
}
async function pngText(state, bytes, type) {
  if ((state.textBytes || 0) >= TOTAL_TEXT_LIMIT) { chargeText(state, 1); return; }
  const keyEnd = zeroAt(bytes, 0);
  if (keyEnd === bytes.length || keyEnd > 79) return;
  const keyword = decode(bytes.subarray(0, keyEnd)); let payload, inflated = false;
  try {
    if (type === 'tEXt') payload = bytes.subarray(keyEnd + 1);
    else if (type === 'zTXt') {
      if (bytes[keyEnd + 1] !== 0) throw new Error('compression');
      payload = await inflateText(bytes.subarray(keyEnd + 2), state); inflated = true;
    } else {
      const compressed = bytes[keyEnd + 1], method = bytes[keyEnd + 2];
      if (![0, 1].includes(compressed) || method !== 0) throw new Error('compression');
      const languageEnd = zeroAt(bytes, keyEnd + 3), translatedEnd = zeroAt(bytes, languageEnd + 1);
      if (languageEnd === bytes.length || translatedEnd === bytes.length) return;
      payload = bytes.subarray(translatedEnd + 1);
      if (compressed) { payload = await inflateText(payload, state); inflated = true; }
    }
    if (payload.length > TEXT_LIMIT) { warn(state, '图片内嵌文字过大，已跳过。'); return; }
    if (!inflated && !chargeText(state, payload.length)) return;
    inspectText(state, decode(payload), 'png/' + type + ':' + keyword, keyword);
  } catch { warn(state, '一段压缩元数据无法读取，已继续检查其他日期来源。'); }
}
function exifComment(bytes, littleEndian) {
  if (bytes.length < 8) return decode(bytes);
  const charset = decode(bytes.subarray(0, 8));
  const body = bytes.subarray(8);
  if (charset.startsWith('UNICODE')) {
    let little = littleEndian;
    if (body[0] === 255 && body[1] === 254) little = true;
    else if (body[0] === 254 && body[1] === 255) little = false;
    return new TextDecoder(little ? 'utf-16le' : 'utf-16be').decode(body).replace(/^\uFEFF/, '').replace(/\0+$/, '');
  }
  return charset.startsWith('ASCII') ? decode(body) : decode(bytes);
}
function readExif(state, original) {
  let bytes = original;
  if (decode(bytes.subarray(0, 6)) === 'Exif') bytes = bytes.subarray(6);
  if (bytes.length < 8) { warn(state, 'EXIF 信息不完整，已跳过。'); return; }
  const little = bytes[0] === 73 && bytes[1] === 73;
  if (!little && !(bytes[0] === 77 && bytes[1] === 77)) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = offset => view.getUint16(offset, little), u32 = offset => view.getUint32(offset, little);
  const seen = new Set(), tags = new Map();
  const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  function ifd(offset, depth = 0) {
    if (depth > 3 || seen.has(offset) || offset < 8 || offset + 2 > bytes.length) return;
    seen.add(offset);
    const count = u16(offset);
    if (count > 512 || offset + 2 + count * 12 > bytes.length) { warn(state, 'EXIF 目录不完整，已跳过损坏字段。'); return; }
    for (let index = 0; index < count; index++) {
      const pos = offset + 2 + index * 12, tag = u16(pos), type = u16(pos + 2), count = u32(pos + 4);
      const size = (sizes[type] || 0) * count;
      if (!size || size > TEXT_LIMIT) continue;
      const start = size <= 4 ? pos + 8 : u32(pos + 8);
      if (start < 0 || start + size > bytes.length) continue;
      const value = bytes.subarray(start, start + size);
      if (tag === 0x8769 && type === 4 && count === 1) ifd(u32(start), depth + 1);
      else if ([0x010e, 0x0132, 0x9003, 0x9004, 0x9010, 0x9011, 0x9012, 0x9290, 0x9291, 0x9292, 0x9286].includes(tag)) {
        if (tags.has(tag) || !chargeText(state, size)) continue;
        tags.set(tag, tag === 0x9286 ? exifComment(value, little) : decode(value));
      } else if (tag === 0x9c9c && !tags.has(0x9286) && chargeText(state, size)) tags.set(0x9286, new TextDecoder('utf-16le').decode(value).replace(/\0+$/, ''));
    }
  }
  try {
    if (u16(2) !== 42) return;
    ifd(u32(4));
    for (const tag of [0x010e, 0x9286]) inspectText(state, tags.get(tag), 'exif:' + (tag === 0x9286 ? 'UserComment' : 'ImageDescription'), 'Comment');
    for (const [tag, label, offsetTag, subsecTag] of [[0x9003, 'DateTimeOriginal', 0x9011, 0x9291], [0x9004, 'DateTimeDigitized', 0x9012, 0x9292]]) {
      let value = tags.get(tag);
      if (!value) continue;
      if (/^\d+$/.test(tags.get(subsecTag) || '') && !/[.,]\d/.test(value)) value += '.' + tags.get(subsecTag);
      const offset = tags.get(offsetTag);
      if (/^[+-]\d{2}:?\d{2}$/.test(offset || '') && !/(Z|[+-]\d{2}:?\d{2})$/i.test(value)) value += offset;
      if (offerDate(state, value, 'exif:' + label, tag === 0x9003 ? 110 : 105)) break;
    }
    let modified = tags.get(0x0132);
    if (modified) {
      if (/^\d+$/.test(tags.get(0x9290) || '')) modified += '.' + tags.get(0x9290);
      if (/^[+-]\d{2}:?\d{2}$/.test(tags.get(0x9010) || '')) modified += tags.get(0x9010);
      state.modified = normalizedDate(modified);
    }
  } catch { warn(state, 'EXIF 信息不完整，已继续检查文件名。'); }
}
async function readPng(state, bytes) {
  state.format = 'png'; let offset = 8, chunks = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset + 12 <= bytes.length && chunks++ < 4096) {
    const size = view.getUint32(offset), type = decode(bytes.subarray(offset + 4, offset + 8));
    if (size > bytes.length - offset - 12) { warn(state, 'PNG 数据块不完整，已跳过损坏部分。'); break; }
    const payload = bytes.subarray(offset + 8, offset + 8 + size);
    if (type === 'IEND') break;
    if (type === 'IHDR' && size >= 8) { state.width = view.getUint32(offset + 8); state.height = view.getUint32(offset + 12); }
    else if (['tEXt', 'iTXt', 'zTXt'].includes(type) && size <= TEXT_LIMIT) await pngText(state, payload, type);
    else if (type === 'eXIf' && size <= TEXT_LIMIT) readExif(state, payload);
    else if (['tEXt', 'iTXt', 'zTXt', 'eXIf'].includes(type)) warn(state, '一段内嵌信息过大，已跳过。');
    offset += size + 12;
  }
}
function readJpeg(state, bytes) {
  state.format = 'jpeg'; let offset = 2, markers = 0;
  while (offset + 1 < bytes.length && markers++ < 4096) {
    if (bytes[offset++] !== 255) { warn(state, 'JPEG 数据段不完整，已跳过损坏部分。'); break; }
    while (bytes[offset] === 255) offset++;
    const type = bytes[offset++];
    if (type === 0xd9 || type === 0xda) break;
    if (type === 0x01 || type >= 0xd0 && type <= 0xd7) continue;
    if (offset + 2 > bytes.length) break;
    const size = bytes[offset] * 256 + bytes[offset + 1];
    if (size < 2 || size > bytes.length - offset) { warn(state, 'JPEG 数据段不完整，已跳过损坏部分。'); break; }
    const payload = bytes.subarray(offset + 2, offset + size);
    if ((state.textBytes || 0) >= TOTAL_TEXT_LIMIT && [0xe1, 0xfe].includes(type)) { offset += size; continue; }
    if (type === 0xe1 && payload.length <= TEXT_LIMIT) {
      if (decode(payload.subarray(0, 6)) === 'Exif') readExif(state, payload);
      else {
        const text = decode(payload);
        const start = text.search(/<(?:\?xpacket|(?:[\w.-]+:)?xmpmeta|(?:[\w.-]+:)?RDF)\b/i);
        if (start >= 0 && chargeText(state, payload.length)) inspectText(state, text.slice(start), 'jpeg/xmp', 'XMP');
      }
    } else if (type === 0xfe && payload.length <= TEXT_LIMIT && chargeText(state, payload.length)) inspectText(state, decode(payload), 'jpeg/comment', 'Comment');
    if (type >= 0xc0 && type <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(type) && payload.length >= 5) {
      state.height = payload[1] * 256 + payload[2]; state.width = payload[3] * 256 + payload[4];
    }
    offset += size;
  }
}
function filenameDate(name) {
  const timed = String(name || '').match(/(?:^|[^\d])(\d{4})[-_](\d{2})[-_](\d{2})[ _T](\d{2})[-_:](\d{2})[-_:](\d{2})(?:[.,](\d{1,9}))?/);
  if (timed) return timed[1] + '-' + timed[2] + '-' + timed[3] + 'T' + timed[4] + ':' + timed[5] + ':' + timed[6] + (timed[7] ? '.' + timed[7] : '');
  return String(name || '').match(/(?:^|[^\d])(\d{4}-\d{2}-\d{2})(?!\d)/)?.[1] || null;
}

/** Read-only import hints. No private VRCX roster or instance data leaves this boundary. */
export async function parsePhotoMetadata(input, { name = '', lastModified } = {}) {
  const state = { warnings: [], width: null, height: null, format: null };
  const bytes = bytesFor(input);
  if (bytes.length > FILE_LIMIT) warn(state, '图片文件过大，已跳过元数据分析。');
  else if (pngSignature.every((value, index) => bytes[index] === value)) await readPng(state, bytes);
  else if (bytes[0] === 255 && bytes[1] === 216) readJpeg(state, bytes);
  else warn(state, '暂时仅能读取 PNG 和 JPEG 的内嵌信息。');
  if (!state.date) offerDate(state, filenameDate(name), 'filename', 50);
  if (!state.date) warn(state, '未找到可靠拍摄日期，请手动补充；文件修改时间未当作拍摄时间。');
  if (!state.date && state.modified) warn(state, 'EXIF 仅含修改时间，未当作拍摄时间。');
  const worldSource = [...new Set([state.name?.source, state.world?.source].filter(Boolean))].join(' + ') || null;
  const modified = Number.isFinite(lastModified) && lastModified > 0 && lastModified <= 8.64e15 ? new Date(lastModified).toISOString() : null;
  return {
    takenAt: state.date?.value || null, timeZone: state.date?.timeZone || null,
    worldName: state.name?.value || null, worldId: state.world?.value || null,
    width: state.width > 0 ? state.width : null, height: state.height > 0 ? state.height : null, format: state.format,
    source: { takenAt: state.date?.source || null, world: worldSource, worldName: state.name?.source || null, worldId: state.world?.source || null },
    fileModifiedAt: modified, warnings: state.warnings,
    metadataModifiedAt: state.modified?.value || null,
  };
}

export async function extractPhotoMetadata(file) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new TypeError('A photo File or Blob is required.');
  if (Number.isFinite(file.size) && file.size > FILE_LIMIT) {
    const result = await parsePhotoMetadata(new Uint8Array(), { name: file.name, lastModified: file.lastModified });
    result.warnings = result.warnings.filter(message => !message.includes('仅能读取'));
    result.warnings.unshift('图片文件过大，已跳过元数据分析。');
    return result;
  }
  return parsePhotoMetadata(await file.arrayBuffer(), { name: file.name, lastModified: file.lastModified });
}
