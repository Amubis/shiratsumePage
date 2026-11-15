const STATE_KEY = 'state/garden.json';
const IMAGE_KEY = /^(?:media\/|private\/originals\/)[a-f0-9]{64}\.(?:png|jpg|webp)$/;
const mimeFor = key => key.endsWith('.png') ? 'image/png' : key.endsWith('.webp') ? 'image/webp' : 'image/jpeg';

/** The bucket stays private. This adapter never lists or deletes uploaded objects. */
export function createR2Storage(bucket) {
  if (!bucket) throw new Error('Bind a private R2 bucket as BUCKET.');
  const assertKey = key => { if (!IMAGE_KEY.test(key)) throw new Error('Invalid storage object key.'); };
  return {
    async readState() {
      const object = await bucket.get(STATE_KEY);
      if (!object) return null;
      const state = await object.json();
      if (state.schemaVersion !== 1 || !state.draft?.revision || !state.published?.revision) throw new Error('Invalid garden state object.');
      return { state, version: object.etag };
    },
    async writeState(state, expectedVersion) {
      const result = await bucket.put(STATE_KEY, JSON.stringify(state), {
        onlyIf: expectedVersion === null ? { etagDoesNotMatch: '*' } : { etagMatches: expectedVersion },
        httpMetadata: { contentType: 'application/json', cacheControl: 'private, no-store' },
      });
      return result !== null;
    },
    async putObject(key, bytes, { mime }) {
      assertKey(key);
      const result = await bucket.put(key, bytes, {
        onlyIf: { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: mime, cacheControl: key.startsWith('media/') ? 'public, max-age=31536000, immutable' : 'private, no-store' },
      });
      return result !== null;
    },
    async headObject(key) {
      assertKey(key);
      const object = await bucket.head(key);
      return object ? { size: object.size, mime: mimeFor(key) } : null;
    },
    async getObject(key) {
      assertKey(key);
      const object = await bucket.get(key);
      return object ? { body: object.body, size: object.size, mime: mimeFor(key) } : null;
    },
  };
}
