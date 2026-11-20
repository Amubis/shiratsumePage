import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

const locks = new Map();
const blank = () => ({ schemaVersion: 1, likes: [], rates: {} });

/** Independent local state mirrors the D1 contract and survives editor restarts. */
export function createLocalPhotoLikesStore(dataDir) {
  const directory = resolve(dataDir), path = resolve(directory, 'photo-likes.json');
  const read = async () => {
    try {
      const state = JSON.parse(await readFile(path, 'utf8'));
      if (state.schemaVersion !== 1 || !Array.isArray(state.likes) || !state.rates || typeof state.rates !== 'object') throw new Error('Invalid photo likes state.');
      return state;
    } catch (error) { if (error.code === 'ENOENT') return blank(); throw error; }
  };
  const mutate = operation => {
    const result = (locks.get(path) || Promise.resolve()).then(async () => {
      const state = await read();
      const value = operation(state);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = resolve(directory, `.photo-likes-${crypto.randomUUID()}.tmp`);
      try {
        await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
        await rename(temporary, path);
      } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      return value;
    });
    const pending = result.catch(() => {});
    locks.set(path, pending);
    pending.finally(() => { if (locks.get(path) === pending) locks.delete(path); });
    return result;
  };
  const resultFor = (state, photoId, visitorHash) => {
    const likes = state.likes.filter(like => like.photoId === photoId);
    return { photoId, count: likes.length, liked: Boolean(visitorHash && likes.some(like => like.visitorHash === visitorHash)) };
  };
  return {
    async list(ids, visitorHash = '') {
      const state = await read();
      return [...new Set(ids)].map(id => resultFor(state, id, visitorHash));
    },
    set: (photoId, visitorHash, liked, createdAt) => mutate(state => {
      const index = state.likes.findIndex(like => like.photoId === photoId && like.visitorHash === visitorHash);
      if (liked && index === -1) state.likes.push({ photoId, visitorHash, createdAt });
      if (!liked && index !== -1) state.likes.splice(index, 1);
      return resultFor(state, photoId, visitorHash);
    }),
    consumeRateLimit: (key, nowMs, { windowMs, max }) => mutate(state => {
      for (const [id, entry] of Object.entries(state.rates)) if (entry.resetAt <= nowMs) delete state.rates[id];
      const entry = state.rates[key] ||= { count: 0, resetAt: nowMs + windowMs };
      entry.count++;
      const allowed = entry.count <= max;
      return { allowed, retryAfter: allowed ? 0 : Math.max(1, Math.ceil((entry.resetAt - nowMs) / 1000)) };
    }),
  };
}
