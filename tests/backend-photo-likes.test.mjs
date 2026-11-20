import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPhotoLikesApi } from '../server/photo-likes-api.mjs';
import { createLocalPhotoLikesStore } from '../server/local-photo-likes-storage.mjs';
import { createAdminApi } from '../server/admin-api.mjs';
import worker from '../worker/index.mjs';

const origin = 'https://amubis.example';
const content = { media: [{ id: 'photo-one' }, { id: 'photo-two' }] };
const request = (method = 'GET', body, headers = {}) => new Request(`${origin}/api/photo-likes`, {
  method, headers: { ...(method === 'POST' ? { Origin: origin, 'Content-Type': 'application/json' } : {}), ...headers },
  ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
});
async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'photo-likes-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createLocalPhotoLikesStore(directory);
  const handle = createPhotoLikesApi({ store, getPublishedContent: async () => content, identitySecret: 'stable-test-secret', ...overrides });
  const first = await handle(request());
  assert.equal(first.status, 200);
  const cookie = first.headers.get('set-cookie').split(';', 1)[0];
  return { handle, store, directory, first, cookie };
}
async function result(response, status = 200) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}

test('anonymous likes bootstrap securely, survive a store/API restart and are idempotent for each browser', async t => {
  const f = await fixture(t);
  assert.match(f.first.headers.get('set-cookie'), /^__Host-photo_visitor=[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000$/);
  assert.equal(f.first.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await f.first.json(), { available: true, likes: content.media.map(item => ({ photoId: item.id, count: 0, liked: false })) });
  const post = liked => f.handle(request('POST', { photoId: 'photo-one', liked }, { Cookie: f.cookie }));
  assert.deepEqual(await result(await post(true)), { photoId: 'photo-one', count: 1, liked: true });
  assert.deepEqual(await result(await post(true)), { photoId: 'photo-one', count: 1, liked: true });
  const restarted = createPhotoLikesApi({ store: createLocalPhotoLikesStore(f.directory), getPublishedContent: async () => content, identitySecret: 'stable-test-secret' });
  const retained = await result(await restarted(request('GET', undefined, { Cookie: f.cookie })));
  assert.deepEqual(retained.likes[0], { photoId: 'photo-one', count: 1, liked: true });
  assert.deepEqual(await result(await post(false)), { photoId: 'photo-one', count: 0, liked: false });
  assert.deepEqual(await result(await post(false)), { photoId: 'photo-one', count: 0, liked: false });
  const persisted = await readFile(join(f.directory, 'photo-likes.json'), 'utf8');
  assert.equal(persisted.includes(f.cookie.split('=')[1]), false, 'raw cookie tokens are never stored');
  assert.equal(persisted.includes('127.0.0.1'), false);
});

test('distinct browsers add independently and one browser cannot remove another browser vote', async t => {
  const f = await fixture(t);
  const second = (await f.handle(request())).headers.get('set-cookie').split(';', 1)[0];
  const post = (cookie, liked) => f.handle(request('POST', { photoId: 'photo-one', liked }, { Cookie: cookie }));
  await result(await post(f.cookie, true));
  assert.deepEqual(await result(await post(second, true)), { photoId: 'photo-one', count: 2, liked: true });
  assert.deepEqual(await result(await post(f.cookie, false)), { photoId: 'photo-one', count: 1, liked: false });
  const states = await result(await f.handle(request('GET', undefined, { Cookie: second })));
  assert.equal(states.likes[0].liked, true);
});

test('cross-origin mirrors receive public totals without identity and cannot write through third-party cookies', async t => {
  const f = await fixture(t);
  await result(await f.handle(request('POST', { photoId: 'photo-one', liked: true }, { Cookie: f.cookie })));
  const response = await f.handle(request('GET', undefined, { Origin: 'https://amubis.github.io', Cookie: f.cookie }));
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal((await result(response)).likes[0].liked, false);
  await result(await f.handle(request('POST', { photoId: 'photo-one', liked: true }, { Origin: 'https://other.example', Cookie: f.cookie })), 403);
  const missing = new Request(`${origin}/api/photo-likes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"photoId":"photo-one","liked":true}' });
  await result(await f.handle(missing), 403);
});

test('only published photos are exposed and target/body errors cannot mutate counts', async t => {
  const f = await fixture(t);
  await f.store.set('private-photo', 'hidden-hash', true, '2026-11-20T00:00:00Z');
  const list = await result(await f.handle(request('GET', undefined, { Cookie: f.cookie })));
  assert.equal(list.likes.some(item => item.photoId === 'private-photo'), false);
  for (const body of [{ photoId: 'private-photo', liked: true }, { photoId: 'missing', liked: false }]) await result(await f.handle(request('POST', body, { Cookie: f.cookie })), 404);
  for (const body of [{ photoId: 'photo-one', liked: 'true' }, { photoId: '', liked: true }, { liked: true }, []]) await result(await f.handle(request('POST', body, { Cookie: f.cookie })), Array.isArray(body) ? 400 : 422);
  await result(await f.handle(request('POST', '{invalid', { Cookie: f.cookie })), 400);
  await result(await f.handle(request('POST', '{}', { Cookie: f.cookie, 'Content-Type': 'text/plain' })), 415);
  await result(await f.handle(request('POST', ' '.repeat(1100), { Cookie: f.cookie })), 413);
  assert.equal((await result(await f.handle(request('GET', undefined, { Cookie: f.cookie })))).likes[0].count, 0);
});

test('local adapter serializes concurrent writes across independent instances without duplicate rows', async t => {
  const f = await fixture(t);
  const second = createLocalPhotoLikesStore(f.directory);
  await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? second : f.store).set('photo-one', `browser-${index % 5}`, true, '2026-11-20T00:00:00Z')));
  assert.deepEqual((await f.store.list(['photo-one'], 'browser-1'))[0], { photoId: 'photo-one', count: 5, liked: true });
  await Promise.all(Array.from({ length: 10 }, () => second.set('photo-one', 'browser-1', false, '2026-11-20T00:00:00Z')));
  assert.equal((await f.store.list(['photo-one']))[0].count, 4);
});

test('per-browser limits expire, and storage unavailability is separate from public content', async t => {
  let timestamp = 1_000_000;
  const f = await fixture(t, { now: () => timestamp });
  const post = () => f.handle(request('POST', { photoId: 'photo-one', liked: true }, { Cookie: f.cookie }));
  for (let index = 0; index < 120; index++) await result(await post());
  const limited = await post();
  assert.equal(limited.headers.get('retry-after'), '600');
  await result(limited, 429);
  timestamp += 600_000;
  assert.equal((await result(await post())).count, 1);
  const unavailable = createPhotoLikesApi({ store: null, getPublishedContent: async () => content });
  assert.equal((await result(await unavailable(request()), 503)).code, 'likes_unavailable');
  const errors = [];
  const broken = createPhotoLikesApi({ store: { list: async () => { throw new Error('private failure detail'); } }, getPublishedContent: async () => content, onError: error => errors.push(error) });
  const body = await result(await broken(request()), 500);
  assert.equal(body.error.includes('private failure detail'), false);
  assert.equal(errors.length, 1);
});

test('admin and Worker route photo likes without authenticating anonymous visitors', async () => {
  const api = createAdminApi({ storage: { readState: async () => null }, seed: { schemaVersion: 1, media: [{ id: 'photo-one', url: './assets/photo.jpg', enabled: true }] }, photoLikesStore: { list: async ids => ids.map(photoId => ({ photoId, count: 9, liked: false })) } });
  const list = await result(await api(request()));
  assert.equal(list.likes[0].count, 9);
  const missingDB = await worker.fetch(request(), { BUCKET: { get: async () => null }, ASSETS: { fetch: async () => new Response('static fallback') } });
  assert.equal((await result(missingDB, 503)).code, 'likes_unavailable');
});
