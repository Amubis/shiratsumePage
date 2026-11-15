import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { extractPhotoMetadata, parsePhotoMetadata } from '../src/photo-metadata.js';

const pngPixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhGQAAAAASUVORK5CYII=', 'base64');
const worldId = 'wrld_b2d24c29-1ded-4990-a90d-dd6dcc440300';
const vrcx = { application: 'VRCX', version: 1, author: { id: 'usr_secret', displayName: 'private author' }, world: { name: 'Japan Shrine[autumn] / 秋', id: worldId, instanceId: 'private-instance' }, players: [{ id: 'usr_roster', displayName: 'private roster' }] };
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const contents = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(contents));
  return Buffer.concat([length, contents, crc]);
}
const png = (...chunks) => Buffer.concat([pngPixel.subarray(0, -12), ...chunks, pngPixel.subarray(-12)]);
const text = (key, value) => chunk('tEXt', Buffer.from(key + '\0' + value));
const itxt = (key, value, compressed = false) => chunk('iTXt', Buffer.concat([Buffer.from(key + '\0'), Buffer.from([compressed ? 1 : 0, 0, 0, 0]), compressed ? deflateSync(Buffer.from(value)) : Buffer.from(value)]));
function xmp({ date = '2026-11-10T20:14:15+09:00', name = '夜の温泉 &amp; 星', id = worldId } = {}) {
  return '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:vrc="http://ns.vrchat.com/vrc/1.0/" xmlns:tiff="http://ns.adobe.com/tiff/1.0/"><vrc:WorldID>' + id + '</vrc:WorldID><vrc:WorldDisplayName>' + name + '</vrc:WorldDisplayName><tiff:DateTime>' + date + '</tiff:DateTime></rdf:Description></rdf:RDF></x:xmpmeta>';
}
const ascii = value => Buffer.from(value + '\0');
function tiff(rootEntries, exifEntries = [], little = true) {
  const root = [...rootEntries];
  if (exifEntries.length) root.push({ tag: 0x8769, type: 4, data: Buffer.alloc(4), pointer: true });
  const rootSize = 2 + root.length * 12 + 4, subOffset = 8 + rootSize;
  const subSize = exifEntries.length ? 2 + exifEntries.length * 12 + 4 : 0;
  const allocation = subOffset + subSize + [...root, ...exifEntries].reduce((sum, e) => sum + (e.data.length > 4 ? e.data.length : 0), 0);
  const result = Buffer.alloc(allocation);
  result.write(little ? 'II' : 'MM');
  const w16 = (v, p) => little ? result.writeUInt16LE(v, p) : result.writeUInt16BE(v, p);
  const w32 = (v, p) => little ? result.writeUInt32LE(v, p) : result.writeUInt32BE(v, p);
  w16(42, 2); w32(8, 4); let dataOffset = subOffset + subSize;
  for (const [entries, offset] of [[root, 8], [exifEntries, subOffset]]) {
    if (!entries.length && offset !== 8) continue;
    w16(entries.length, offset);
    entries.forEach((e, index) => {
      const pos = offset + 2 + index * 12;
      w16(e.tag, pos); w16(e.type ?? 2, pos + 2); w32(e.type === 4 ? 1 : e.data.length, pos + 4);
      if (e.pointer) w32(subOffset, pos + 8);
      else if (e.data.length <= 4) e.data.copy(result, pos + 8);
      else { w32(dataOffset, pos + 8); e.data.copy(result, dataOffset); dataOffset += e.data.length; }
    });
  }
  return result;
}
function jpeg(...segments) {
  const sof = Buffer.from([8, 2, 208, 5, 0, 1, 1, 0x11, 0]);
  const segment = (marker, data) => { const header = Buffer.from([255, marker, 0, 0]); header.writeUInt16BE(data.length + 2, 2); return Buffer.concat([header, data]); };
  return Buffer.concat([Buffer.from([255, 216]), ...segments.map(data => segment(0xe1, data)), segment(0xc0, sof), Buffer.from([255, 217])]);
}

test('VRCX UTF-8 Description fills only public world hints and filename supplies the absent date', async () => {
  const result = await parsePhotoMetadata(png(text('Description', JSON.stringify(vrcx))), { name: 'VRChat_2026-11-10_20-14-15.123_3840x2160.png' });
  assert.equal(result.worldName, vrcx.world.name); assert.equal(result.worldId, worldId);
  assert.equal(result.takenAt, '2026-11-10T20:14:15.123'); assert.equal(result.timeZone, 'unspecified');
  assert.equal(result.source.takenAt, 'filename'); assert.match(result.source.world, /^vrcx:/);
  assert.equal(result.width, 1); assert.equal(result.height, 1); assert.equal(result.format, 'png');
  assert.ok(!JSON.stringify(result).includes('private')); assert.ok(!JSON.stringify(result).includes('usr_'));
  assert.equal(result.players, undefined); assert.equal(result.author, undefined); assert.equal(result.instanceId, undefined);
});

test('native VRChat XMP provides dates and world information without guessing a timezone', async () => {
  const result = await parsePhotoMetadata(png(itxt('XML:com.adobe.xmp', xmp())), { name: 'VRChat_2025-01-01_01-01-01.png' });
  assert.equal(result.worldName, '夜の温泉 & 星'); assert.equal(result.worldId, worldId);
  assert.equal(result.takenAt, '2026-11-10T20:14:15+09:00'); assert.equal(result.timeZone, 'offset');
  assert.equal(result.source.takenAt, 'xmp:DateTime');
});

test('zTXt and compressed iTXt are decompressed and VRCX world names take priority over XMP', async () => {
  const compressedDescription = chunk('zTXt', Buffer.concat([Buffer.from('Description\0\0'), deflateSync(Buffer.from(JSON.stringify(vrcx)))]));
  const result = await parsePhotoMetadata(png(compressedDescription, itxt('XML:com.adobe.xmp', xmp(), true)));
  assert.equal(result.worldName, vrcx.world.name); assert.equal(result.takenAt, '2026-11-10T20:14:15+09:00');
  assert.match(result.source.world, /png\/zTXt/);
});

test('PNG eXIf DateTimeOriginal beats other metadata and preserves offset/subseconds', async () => {
  const exif = tiff([{ tag: 0x0132, data: ascii('2024:01:01 01:02:03') }], [
    { tag: 0x9003, data: ascii('2025:04:03 12:13:14') }, { tag: 0x9291, data: ascii('345') }, { tag: 0x9011, data: ascii('+09:00') },
  ]);
  const result = await parsePhotoMetadata(png(itxt('XML:com.adobe.xmp', xmp()), chunk('eXIf', exif)), { name: 'VRChat_2026-11-10_20-14-15.png' });
  assert.equal(result.takenAt, '2025-04-03T12:13:14.345+09:00'); assert.equal(result.source.takenAt, 'exif:DateTimeOriginal');
});

test('big-endian JPEG EXIF reads Unicode UserComment JSON, original date and dimensions', async () => {
  const json = JSON.stringify({ ...vrcx, timestamp: '2024-01-01T01:02:03Z' });
  const unicode = Buffer.from(json, 'utf16le'); for (let i = 0; i < unicode.length; i += 2) [unicode[i], unicode[i + 1]] = [unicode[i + 1], unicode[i]];
  const exif = tiff([], [{ tag: 0x9286, type: 7, data: Buffer.concat([Buffer.from('UNICODE\0'), unicode]) }, { tag: 0x9003, data: ascii('2026:11:10 23:45:56') }], false);
  const result = await parsePhotoMetadata(jpeg(Buffer.concat([Buffer.from('Exif\0\0'), exif])));
  assert.equal(result.worldName, vrcx.world.name); assert.equal(result.takenAt, '2026-11-10T23:45:56'); assert.equal(result.timeZone, 'unspecified');
  assert.equal(result.width, 1280); assert.equal(result.height, 720); assert.equal(result.format, 'jpeg');
});

test('JPEG XMP attributes are read with entity decoding and explicit UTC preserved', async () => {
  const xml = '<x:xmpmeta><rdf:RDF><rdf:Description vrc:WorldID="' + worldId + '" vrc:WorldDisplayName="A &quot;Quiet&quot; Room" xmp:CreateDate="2026-10-02T03:04:05Z"/></rdf:RDF></x:xmpmeta>';
  const result = await parsePhotoMetadata(jpeg(Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0'), Buffer.from(xml)])));
  assert.equal(result.worldName, 'A "Quiet" Room'); assert.equal(result.takenAt, '2026-10-02T03:04:05Z');
});

test('file modification time is kept as a suggestion and never masquerades as capture time', async () => {
  const result = await parsePhotoMetadata(pngPixel, { name: 'edited.png', lastModified: Date.UTC(2026, 10, 10) });
  assert.equal(result.takenAt, null); assert.equal(result.source.takenAt, null);
  assert.equal(result.fileModifiedAt, '2026-11-10T00:00:00.000Z'); assert.ok(result.warnings.length);
});

test('invalid calendar values do not silently roll over, and date-only filenames stay date-only', async () => {
  assert.equal((await parsePhotoMetadata(pngPixel, { name: 'VRChat_2026-02-30_20-14-15.png' })).takenAt, null);
  assert.equal((await parsePhotoMetadata(pngPixel, { name: 'VRChat_2026-11-10_25-14-15.png' })).takenAt, null);
  const result = await parsePhotoMetadata(pngPixel, { name: '2024-02-29.png' });
  assert.equal(result.takenAt, '2024-02-29'); assert.equal(result.timeZone, null);
});

test('truncated PNG/EXIF and corrupt compressed metadata fall back safely to filename', async () => {
  const damagedChunk = Buffer.from([0, 0, 255, 255, 116, 69, 88, 116, 0, 0, 0, 0]);
  const name = 'VRChat_2026-11-10_20-14-15.png';
  for (const bytes of [
    Buffer.concat([pngPixel.subarray(0, -12), damagedChunk]),
    png(chunk('eXIf', Buffer.from('II*\0\xff\xff\xff\xff', 'binary'))),
    png(chunk('zTXt', Buffer.from('Description\0\0not-deflate'))),
    png(text('Description', '{"application":"VRCX",broken')),
  ]) {
    const result = await parsePhotoMetadata(bytes, { name });
    assert.equal(result.takenAt, '2026-11-10T20:14:15');
    assert.equal(result.worldName, null);
  }
});

test('inflated text is bounded and cannot replace trusted capture hints', async () => {
  const bomb = chunk('zTXt', Buffer.concat([Buffer.from('Description\0\0'), deflateSync(Buffer.alloc(1024 * 1024 + 100, 65))]));
  const result = await parsePhotoMetadata(png(bomb), { name: 'VRChat_2026-11-10_20-14-15.png' });
  assert.equal(result.takenAt, '2026-11-10T20:14:15'); assert.ok(result.warnings.some(value => value.includes('压缩')));
});

test('File/Blob adapter reads bytes without image decoding or requiring EXIF support in the browser', async () => {
  const file = new Blob([png(text('Description', JSON.stringify(vrcx)))], { type: 'image/png' });
  Object.defineProperties(file, { name: { value: 'VRChat_2026-11-10_20-14-15.png' }, lastModified: { value: Date.UTC(2026, 10, 11) } });
  const result = await extractPhotoMetadata(file);
  assert.equal(result.worldId, worldId); assert.equal(result.takenAt, '2026-11-10T20:14:15');
});

test('EXIF file-change date never overrides XMP capture date or filename capture hints', async () => {
  const exif = chunk('eXIf', tiff([{ tag: 0x0132, data: ascii('2026:11:10 12:00:00') }]));
  const xml = '<x:xmpmeta><rdf:RDF><rdf:Description><exif:DateTimeOriginal>2020-02-03T04:05:06Z</exif:DateTimeOriginal></rdf:Description></rdf:RDF></x:xmpmeta>';
  const result = await parsePhotoMetadata(png(itxt('XML:com.adobe.xmp', xml), exif), { name: 'VRChat_2024-02-03_04-05-06.png' });
  assert.equal(result.takenAt, '2020-02-03T04:05:06Z');
  assert.equal(result.metadataModifiedAt, '2026-11-10T12:00:00');
  assert.equal((await parsePhotoMetadata(png(exif), { name: 'VRChat_2024-02-03_04-05-06.png' })).takenAt, '2024-02-03T04:05:06');
  const unknown = await parsePhotoMetadata(png(exif), { name: 'edited.png' });
  assert.equal(unknown.takenAt, null); assert.ok(unknown.warnings.some(value => value.includes('EXIF')));
});

test('digitized timestamp uses its own timezone and subseconds rather than modification offset', async () => {
  const exif = tiff([{ tag: 0x0132, data: ascii('2026:11:10 11:00:00') }], [
    { tag: 0x9004, data: ascii('2025:03:04 05:06:07') }, { tag: 0x9010, data: ascii('+02:00') },
    { tag: 0x9012, data: ascii('+09:00') }, { tag: 0x9292, data: ascii('123') },
  ]);
  const result = await parsePhotoMetadata(jpeg(Buffer.concat([Buffer.from('Exif\0\0'), exif])));
  assert.equal(result.takenAt, '2025-03-04T05:06:07.123+09:00');
  assert.equal(result.metadataModifiedAt, '2026-11-10T11:00:00+02:00');
});

test('PNG tail bytes after IEND cannot masquerade as embedded world metadata', async () => {
  const result = await parsePhotoMetadata(Buffer.concat([pngPixel, text('Description', JSON.stringify({ ...vrcx, timestamp: '2020-01-01T01:02:03Z' }))]), { name: 'VRChat_2026-11-10_20-14-15.png' });
  assert.equal(result.worldName, null); assert.equal(result.worldId, null);
  assert.equal(result.takenAt, '2026-11-10T20:14:15');
});

test('an entire file has a cumulative decompression budget across small compressed chunks', async () => {
  const compressed = deflateSync(Buffer.alloc(1024 * 1024, 65));
  const chunks = Array.from({ length: 8 }, (_, i) => chunk('zTXt', Buffer.concat([Buffer.from('Note' + i + '\0\0'), compressed])));
  const result = await parsePhotoMetadata(png(...chunks, text('Description', JSON.stringify(vrcx))), { name: 'VRChat_2026-11-10_20-14-15.png' });
  assert.equal(result.worldName, null);
  assert.ok(result.warnings.some(value => value.includes('累计')));
  assert.equal(result.takenAt, '2026-11-10T20:14:15');
});

test('oversized File adapter does not read the entire file into browser memory', async () => {
  let read = false;
  const file = { size: 129 * 1024 * 1024, name: 'VRChat_2026-11-10_20-14-15.png', arrayBuffer() { read = true; throw new Error('must not read'); } };
  const result = await extractPhotoMetadata(file);
  assert.equal(read, false); assert.equal(result.takenAt, '2026-11-10T20:14:15');
  assert.ok(result.warnings.some(value => value.includes('文件过大')));
});
