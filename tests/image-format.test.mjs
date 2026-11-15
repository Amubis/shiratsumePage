import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspectImage } from '../server/image-format.mjs';

// Real 1x1 files encoded by Pillow, plus an existing photographic JPEG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOQS3EDAAFsAMnoB9dkAAAAAElFTkSuQmCC', 'base64');
const WEBP = Buffer.from('UklGRjAAAABXRUJQVlA4ICQAAABwAQCdASoBAAEAAUAmJaACdAF1AAD+82js3/8Wh/bz/g1tKAA=', 'base64');
const LOSSLESS_WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
const JPEG = await readFile(new URL('../assets/frame-04.jpg', import.meta.url));

test('recognizes actual PNG, JPEG, lossy WebP and lossless WebP bytes', () => {
  assert.deepEqual(inspectImage(PNG, 'image/png'), { extension: 'png', mime: 'image/png', width: 1, height: 1 });
  assert.deepEqual(inspectImage(JPEG, 'image/jpeg'), { extension: 'jpg', mime: 'image/jpeg', width: 1280, height: 720 });
  assert.deepEqual(inspectImage(WEBP, 'image/webp'), { extension: 'webp', mime: 'image/webp', width: 1, height: 1 });
  assert.deepEqual(inspectImage(LOSSLESS_WEBP, 'image/webp'), { extension: 'webp', mime: 'image/webp', width: 1, height: 1 });
  assert.equal(inspectImage(PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength), 'image/png; charset=binary').width, 1);
});

test('rejects mismatched, absent and unsupported content types', () => {
  for (const mime of ['image/jpeg', 'image/svg+xml', 'text/html', 'application/octet-stream', '']) {
    assert.throws(() => inspectImage(PNG, mime), /Content-Type/);
  }
  assert.throws(() => inspectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/png'));
  assert.throws(() => inspectImage(Buffer.from('<html>not an image</html>'), 'image/jpeg'));
});

test('rejects truncated containers, appended payloads and header-only imitations', () => {
  for (const [image, mime] of [[PNG, 'image/png'], [JPEG, 'image/jpeg'], [WEBP, 'image/webp']]) {
    for (const length of [2, 12, Math.floor(image.length / 2), image.length - 1]) {
      assert.throws(() => inspectImage(image.subarray(0, length), mime), `${mime} truncation ${length}`);
    }
    assert.throws(() => inspectImage(Buffer.concat([image, Buffer.from('<script>alert(1)</script>')]), mime));
  }
  assert.throws(() => inspectImage(Buffer.from([255, 216, 255, 217]), 'image/jpeg'));
  const fakePng = Buffer.from(PNG);
  fakePng.fill(0, 41, 43); // invalid deflate/zlib stream header
  assert.throws(() => inspectImage(fakePng, 'image/png'));
});

test('rejects corrupt PNG control chunks, impossible WebP lengths and JPEG markers', () => {
  const png = Buffer.from(PNG);
  png[20] ^= 1;
  assert.throws(() => inspectImage(png, 'image/png'), /checksum/);
  const webp = Buffer.from(WEBP);
  webp.writeUInt32LE(0xffffffff, 16);
  assert.throws(() => inspectImage(webp, 'image/webp'));
  const jpeg = Buffer.from(JPEG);
  jpeg[jpeg.length - 1] = 0;
  assert.throws(() => inspectImage(jpeg, 'image/jpeg'));
});

test('rejects decompression-sized WebP dimensions before accepting media', () => {
  const webp = Buffer.from(LOSSLESS_WEBP);
  // Lossless header stores each dimension minus one in fourteen bits.
  webp.writeUInt32LE(0x0fffffff, 21);
  assert.throws(() => inspectImage(webp, 'image/webp'), /dimensions/);
});
