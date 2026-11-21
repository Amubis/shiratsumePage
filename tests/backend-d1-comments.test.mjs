import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createD1CommentsStore } from '../worker/comments-storage.mjs';

// node:sqlite is optional on earlier supported Node 22 releases. Production uses
// D1; these tests execute its actual migration and SQL without a cloud account.
let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); }
catch (error) {
  if (!['ERR_UNKNOWN_BUILTIN_MODULE', 'ERR_MODULE_NOT_FOUND'].includes(error.code)) throw error;
}
const options = { skip: DatabaseSync ? false : 'This Node version does not provide optional node:sqlite.' };
const createdAt = '2026-11-15T00:00:00.000Z';
const updatedAt = '2026-11-15T01:00:00.000Z';

async function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(await readFile(new URL('../worker/migrations/0001_comments.sql', import.meta.url), 'utf8'));
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const bound = args => ({
        bind(...values) {
          // Exercise the D1 bound-parameter limit, including large read batches.
          assert.ok(values.length <= 100, 'D1 statement exceeds 100 bound parameters');
          return bound(values);
        },
        first: async () => statement.get(...args) || null,
        all: async () => ({ results: statement.all(...args) }),
        run: async () => ({ meta: { changes: Number(statement.run(...args).changes) } }),
      });
      return bound([]);
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const store = createD1CommentsStore(db);
  const insert = (id, changes = {}) => store.insert({ id, targetType: 'photo', targetId: 'photo-1', parentId: null, nickname: '匿名访客', body: 'Hello <script> stays plain text', status: 'pending', verified: false, createdAt, updatedAt: createdAt, readAt: null, ...changes });
  return { sqlite, store, insert };
}

test('D1 migration and adapter preserve moderation, target and explicit unread filters', options, async t => {
  const { store, insert } = await fixture(t);
  const pending = await insert('pending');
  assert.equal(pending.verified, false);
  assert.equal(pending.body, 'Hello <script> stays plain text');
  await insert('reviewed', { status: 'approved', readAt: createdAt });
  await insert('note', { targetType: 'note', targetId: 'note-1' });
  assert.equal((await store.list()).length, 3);
  assert.deepEqual((await store.list({ unread: false })).map(comment => comment.id), ['reviewed']);
  assert.deepEqual((await store.list({ unread: true })).map(comment => comment.id), ['note', 'pending']);
  assert.deepEqual((await store.list({ targetType: 'photo', targetId: 'photo-1', status: 'pending' })).map(comment => comment.id), ['pending']);
  assert.equal(await store.unreadCount(), 2);
  assert.equal(await store.pendingCount(), 2);
  const reviewed = await store.moderate('pending', { status: 'rejected', read: true }, updatedAt);
  assert.equal(reviewed.status, 'rejected');
  assert.equal(reviewed.readAt, updatedAt);
  assert.equal(reviewed.updatedAt, updatedAt);
  assert.equal(await store.unreadCount(), 1);
  assert.equal(await store.pendingCount(), 1);
  assert.equal(await store.get('missing'), null);
  assert.equal(await store.moderate('missing', { read: true }, updatedAt), null);
});

test('D1 public lists hide unapproved comments and replies without an approved matching top-level parent', options, async t => {
  const { store, insert } = await fixture(t);
  await insert('pending');
  await insert('parent', { status: 'approved' });
  await insert('reply', { parentId: 'parent', status: 'approved', verified: true, readAt: createdAt });
  await insert('deep-reply', { parentId: 'reply', status: 'approved' });
  await insert('mismatched-reply', { parentId: 'parent', targetId: 'photo-2', status: 'approved' });
  assert.deepEqual((await store.list({ publicOnly: true })).map(comment => comment.id), ['parent', 'reply']);
  assert.equal((await store.get('reply')).verified, true);
  await store.moderate('parent', { status: 'deleted' }, updatedAt);
  assert.deepEqual(await store.list({ publicOnly: true }), []);
  await store.moderate('parent', { status: 'approved' }, updatedAt);
  assert.equal((await store.list({ publicOnly: true, targetId: 'photo-1', limit: 1 })).length, 1);
  assert.deepEqual(await store.list({ publicOnly: true, before: createdAt }), []);
});

test('D1 notification inbox filters and marks only visible visitor comments, newest first', options, async t => {
  const { store, insert } = await fixture(t);
  await insert('photo', { status: 'approved' });
  await insert('note', { status: 'approved', targetType: 'note', targetId: 'note-1', createdAt: updatedAt });
  await insert('verified', { status: 'approved', verified: true, parentId: 'photo' });
  await insert('legacy');
  await insert('hidden-reply', { status: 'approved', parentId: 'legacy' });
  assert.equal(await store.unreadCount({ inbox: true }), 2);
  assert.deepEqual((await store.list({ inbox: true })).map(comment => comment.id), ['note', 'photo']);
  assert.deepEqual((await store.list({ inbox: true, targetType: 'photo' })).map(comment => comment.id), ['photo']);
  assert.equal(await store.markRead({ inbox: true, ids: ['photo', 'legacy', 'verified', 'hidden-reply'] }), 1);
  assert.deepEqual((await store.list({ inbox: true, unread: false })).map(comment => comment.id), ['photo']);
  assert.equal(await store.markRead({ inbox: true, all: true }), 1);
  assert.equal(await store.unreadCount({ inbox: true }), 0);
  assert.equal(await store.unreadCount(), 3);
});

test('D1 moderation marks messages read atomically without overwriting their first read time', options, async t => {
  const { store, insert } = await fixture(t);
  for (const status of ['approved', 'rejected', 'spam', 'deleted']) await insert(status);
  assert.equal(await store.unreadCount(), 4);
  for (const [index, status] of ['approved', 'rejected', 'spam', 'deleted'].entries()) {
    const reviewed = await store.moderate(status, { status }, updatedAt);
    assert.equal(reviewed.status, status);
    assert.equal(reviewed.readAt, updatedAt);
    assert.equal(await store.unreadCount(), 3 - index);
    const again = await store.moderate(status, { status }, '2026-11-16T00:00:00.000Z');
    assert.equal(again.readAt, updatedAt);
  }
});

test('reviewed-comment migration backfills old reviews but leaves pending and previously read messages alone', options, async t => {
  const { sqlite, store, insert } = await fixture(t);
  await insert('pending');
  for (const status of ['approved', 'rejected', 'spam', 'deleted']) await insert(status, { status, updatedAt });
  await insert('already-read', { status: 'approved', readAt: createdAt, updatedAt });
  const migration = await readFile(new URL('../worker/migrations/0002_reviewed_comments_read.sql', import.meta.url), 'utf8');
  sqlite.exec(migration);
  assert.equal(await store.unreadCount(), 1);
  for (const status of ['approved', 'rejected', 'spam', 'deleted']) assert.equal((await store.get(status)).readAt, updatedAt);
  assert.equal((await store.get('already-read')).readAt, createdAt);
  assert.equal((await store.get('pending')).readAt, null);
  sqlite.exec(migration);
  assert.equal(await store.unreadCount(), 1);
});

test('D1 marks selected or all notifications read and chunks large ID batches within D1 limits', options, async t => {
  const { store, insert } = await fixture(t);
  const ids = Array.from({ length: 105 }, (_, index) => `comment-${index}`);
  await Promise.all(ids.map(id => insert(id)));
  assert.equal(await store.markRead({ ids: [ids[0], ids[0], 'missing'] }), 1);
  const first = await store.get(ids[0]);
  assert.ok(first.readAt);
  assert.equal(first.updatedAt, first.readAt);
  assert.equal(await store.markRead({ ids: ids.slice(0, 100) }), 99);
  assert.equal(await store.unreadCount(), 5);
  assert.equal(await store.markRead({ ids: [] }), 0);
  assert.equal(await store.markRead({ all: true }), 5);
  assert.equal(await store.markRead({ all: true }), 0);
  assert.equal(await store.unreadCount(), 0);
  assert.equal((await store.list({ unread: false })).length, 105);
});

test('D1 rate limiting uses an atomic window across concurrent requests and expires stale hashes', options, async t => {
  const { store, sqlite } = await fixture(t);
  const rate = (key, now) => store.consumeRateLimit(key, now, { windowMs: 1000, max: 3 });
  const results = await Promise.all(Array.from({ length: 8 }, () => rate('hashed-address', 10000)));
  assert.equal(results.filter(result => result.allowed).length, 3);
  assert.ok(results.filter(result => !result.allowed).every(result => result.retryAfter === 1));
  assert.deepEqual(await rate('hashed-address', 11000), { allowed: true, retryAfter: 0 });
  assert.deepEqual(await rate('other-hashed-address', 11000), { allowed: true, retryAfter: 0 });
  await rate('next-day', 10000 + 25 * 60 * 60 * 1000);
  assert.deepEqual(sqlite.prepare('SELECT rate_key FROM garden_comment_rate_limits').all().map(row => row.rate_key), ['next-day']);
  await assert.rejects(() => store.consumeRateLimit('hash', 10000, { windowMs: 0, max: 3 }), /Invalid comment rate limit/);
});
