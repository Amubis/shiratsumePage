import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createD1PhotoLikesStore } from '../worker/photo-likes-storage.mjs';

let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); }
catch (error) { if (!['ERR_UNKNOWN_BUILTIN_MODULE', 'ERR_MODULE_NOT_FOUND'].includes(error.code)) throw error; }
const options = { skip: DatabaseSync ? false : 'Optional node:sqlite is unavailable.' };
const timestamp = '2026-11-20T00:00:00Z';
async function fixture(t, { legacyVote = false } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(await readFile(new URL('../worker/migrations/0003_photo_likes.sql', import.meta.url), 'utf8'));
  if (legacyVote) sqlite.prepare('INSERT INTO photo_likes VALUES (?, ?, ?)').run('photo-one', 'visitor-a', timestamp);
  sqlite.exec(await readFile(new URL('../worker/migrations/0004_photo_like_weights.sql', import.meta.url), 'utf8'));
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const bound = args => ({
        bind(...values) { assert.ok(values.length <= 100); return bound(values); },
        first: async () => statement.get(...args) || null,
        all: async () => ({ results: statement.all(...args) }),
        run: async () => ({ meta: { changes: Number(statement.run(...args).changes) } }),
        execute: async () => /^\s*SELECT\b/.test(sql) ? { results: statement.all(...args) } : { results: [], meta: { changes: Number(statement.run(...args).changes) } },
      });
      return bound([]);
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { sqlite, store: createD1PhotoLikesStore(db) };
}

test('D1 unique votes and transactional counts remain idempotent and nonnegative', options, async t => {
  const { store, sqlite } = await fixture(t);
  assert.deepEqual(await store.set('photo-one', 'visitor-a', true, timestamp), { photoId: 'photo-one', count: 1, liked: true, weight: 1 });
  assert.deepEqual(await store.set('photo-one', 'visitor-a', true, timestamp), { photoId: 'photo-one', count: 1, liked: true, weight: 1 });
  assert.deepEqual(await store.set('photo-one', 'visitor-b', true, timestamp), { photoId: 'photo-one', count: 2, liked: true, weight: 1 });
  assert.deepEqual(await store.set('photo-one', 'visitor-a', false, timestamp), { photoId: 'photo-one', count: 1, liked: false, weight: 0 });
  assert.deepEqual(await store.set('photo-one', 'visitor-a', false, timestamp), { photoId: 'photo-one', count: 1, liked: false, weight: 0 });
  await store.set('photo-one', 'visitor-b', false, timestamp);
  assert.deepEqual(await store.set('photo-one', 'visitor-b', false, timestamp), { photoId: 'photo-one', count: 0, liked: false, weight: 0 });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM photo_likes').get().count, 0);
});

test('D1 migration keeps old votes and promotes one row to five likes without stacking', options, async t => {
  const { store, sqlite } = await fixture(t, { legacyVote: true });
  assert.deepEqual((await store.list(['photo-one'], 'visitor-a'))[0], { photoId: 'photo-one', count: 1, liked: true, weight: 1 });
  await store.set('photo-one', 'visitor-b', true, timestamp);
  const boosted = { photoId: 'photo-one', count: 6, liked: true, weight: 5 };
  assert.deepEqual(await store.set('photo-one', 'visitor-a', true, timestamp, 5), boosted);
  assert.deepEqual(await store.set('photo-one', 'visitor-a', true, timestamp, 5), boosted);
  assert.deepEqual(await store.set('photo-one', 'visitor-a', true, timestamp), boosted);
  assert.deepEqual((await store.list(['photo-one']))[0], { photoId: 'photo-one', count: 6, liked: false, weight: 0 });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM photo_likes').get().count, 2);
  assert.deepEqual(await store.set('photo-one', 'visitor-a', false, timestamp), { photoId: 'photo-one', count: 1, liked: false, weight: 0 });
});

test('D1 batches public photo lists within parameter limits and preserves original order', options, async t => {
  const { store } = await fixture(t);
  const ids = Array.from({ length: 206 }, (_, index) => `photo-${index}`);
  await store.set('photo-0', 'visitor-a', true, timestamp);
  await store.set('photo-205', 'visitor-b', true, timestamp);
  await store.set('private-photo', 'visitor-a', true, timestamp);
  const result = await store.list(ids, 'visitor-a');
  assert.deepEqual(result.map(item => item.photoId), ids);
  assert.deepEqual(result[0], { photoId: 'photo-0', count: 1, liked: true, weight: 1 });
  assert.deepEqual(result.at(-1), { photoId: 'photo-205', count: 1, liked: false, weight: 0 });
  assert.equal(result.slice(1, -1).every(item => item.count === 0 && !item.liked), true);
  assert.deepEqual(await store.list([], 'visitor-a'), []);
});

test('D1 like rate limiting resets windows and expires old identity hashes', options, async t => {
  const { store, sqlite } = await fixture(t);
  const limit = { windowMs: 600_000, max: 2 };
  assert.equal((await store.consumeRateLimit('hash-a', 1000, limit)).allowed, true);
  assert.equal((await store.consumeRateLimit('hash-a', 1000, limit)).allowed, true);
  assert.deepEqual(await store.consumeRateLimit('hash-a', 1000, limit), { allowed: false, retryAfter: 600 });
  assert.equal((await store.consumeRateLimit('hash-a', 601_000, limit)).allowed, true);
  await store.consumeRateLimit('hash-b', 3 * 86400_000, limit);
  assert.deepEqual(sqlite.prepare('SELECT visitor_hash FROM photo_like_rate_limits').all().map(row => row.visitor_hash), ['hash-b']);
});
