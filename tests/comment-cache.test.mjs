import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommentService } from '../src/comments.js';

const base = 'https://amubis.example';
const target = (targetId = 'photo-a', targetType = 'photo') => ({ targetType, targetId });
const comment = (id, changes = {}) => ({ id, parentId: null, nickname: '访客', body: `正文 ${id}`, status: 'approved', createdAt: '2026-11-20T00:00:00Z', ...changes });
const response = (comments = [], status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => ({ comments, available: true }) });
const session = (csrfToken = 'stable-owner-token') => ({ authenticated: true, csrfToken, username: 'Amubis' });
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function fixture() {
  const calls = [];
  let version = 1;
  let status = 200;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const parsed = new URL(url), type = parsed.searchParams.get('targetType') || 'photo', id = parsed.searchParams.get('targetId') || 'photo-a';
    if (options.method !== 'GET') return { ok: true, status: 200, json: async () => ({ comment: comment('mutated', { targetType: type, targetId: id }) }) };
    return response([comment(`${type}-${id}-${version}`, { targetType: type, targetId: id }), ...(url.includes('/api/admin/') ? [comment(`pending-${id}-${version}`, { targetType: type, targetId: id, status: 'pending' })] : [])], status);
  };
  const service = createCommentService({ baseUrl: base, pageURL: `${base}/`, fetchImpl });
  return { service, calls, set version(value) { version = value; }, set status(value) { status = value; }, get reads() { return calls.filter(call => call.options.method === 'GET'); } };
}

test('comment reads remain cached by photo/note target until a new page service is created', async () => {
  const f = fixture();
  const first = await f.service.getComments(target());
  f.version = 2;
  assert.deepEqual(await f.service.getComments(target()), first);
  assert.equal(f.reads.length, 1, 'reopening a thread does not refetch');
  const note = await f.service.getComments(target('photo-a', 'note'));
  assert.equal(f.reads.length, 2, 'photo and note IDs use independent cache entries');
  assert.notEqual(note[0].id, first[0].id);
  await f.service.getComments(target('photo-b'));
  await f.service.getComments(target('photo-a', 'note'));
  assert.equal(f.reads.length, 3);
  const nextPage = createCommentService({ baseUrl: base, pageURL: `${base}/`, fetchImpl: async () => response([comment('fresh-page')]) });
  assert.equal((await nextPage.getComments(target()))[0].id, 'fresh-page', 'cache is in-memory rather than persisted across page refresh');
});

test('concurrent readers share one request and cancelling one panel does not cancel the other reader', async () => {
  const calls = [];
  let release;
  const service = createCommentService({ baseUrl: base, pageURL: `${base}/`, fetchImpl: (url, options) => {
    calls.push({ url, options });
    return new Promise(resolve => { release = resolve; });
  } });
  const controller = new AbortController();
  const first = service.getComments({ ...target(), signal: controller.signal });
  const second = service.getComments(target());
  const aborted = assert.rejects(first, error => error.name === 'AbortError');
  await tick();
  assert.equal(calls.length, 1);
  controller.abort();
  await aborted;
  assert.equal(calls[0].options.signal?.aborted === true, false, 'a caller does not own the shared fetch signal');
  release(response([comment('shared-result')]));
  assert.equal((await second)[0].id, 'shared-result');
  assert.equal((await service.getComments(target()))[0].id, 'shared-result');
  assert.equal(calls.length, 1);
});

test('failed reads are not cached and an explicit retry bypasses a previously successful result', async () => {
  const f = fixture();
  f.status = 503;
  await assert.rejects(f.service.getComments(target()), error => error.status === 503);
  f.status = 200;
  const first = await f.service.getComments(target());
  assert.equal(f.reads.length, 2);
  f.version = 2;
  assert.deepEqual(await f.service.getComments(target()), first);
  const retried = await f.service.getComments({ ...target(), force: true });
  assert.equal(f.reads.length, 3);
  assert.notEqual(retried[0].id, first[0].id);
  assert.deepEqual(await f.service.getComments(target()), retried);
  assert.equal(f.reads.length, 3);
});

test('unchanged owner sessions do not notify subscribers or invalidate cached private threads', async () => {
  const f = fixture();
  let notifications = 0;
  f.service.subscribe(() => notifications++);
  f.service.setOwnerSession(session());
  const ownerResult = await f.service.getComments(target());
  assert.equal(ownerResult.some(item => item.status === 'pending'), true);
  const before = notifications;
  f.service.setOwnerSession({ ...session() });
  f.version = 2;
  assert.equal(notifications, before, 'an ordinary focus/session confirmation is a no-op');
  assert.deepEqual(await f.service.getComments(target()), ownerResult);
  assert.equal(f.reads.length, 1);
  f.service.setOwnerSession(session('changed-owner-token'));
  assert.equal(notifications, before + 1);
  assert.notDeepEqual(await f.service.getComments(target()), ownerResult);
  assert.equal(f.reads.length, 2);
});

test('logout and API base changes discard pending/private cache and cannot serve it to anonymous readers', async () => {
  const f = fixture();
  await f.service.getComments(target());
  f.service.setOwnerSession(session());
  assert.equal((await f.service.getComments(target())).some(item => item.status === 'pending'), true);
  f.version = 2;
  f.service.setOwnerSession({ authenticated: false });
  const anonymous = await f.service.getComments(target());
  assert.equal(anonymous.some(item => item.status === 'pending'), false);
  assert.equal(anonymous[0].id, 'photo-photo-a-2');
  assert.equal(f.reads.length, 3);
  f.service.setBaseUrl('https://another.example');
  await f.service.getComments(target());
  assert.equal(f.reads.length, 4);
  assert.equal(new URL(f.reads.at(-1).url).origin, 'https://another.example');
  assert.equal(f.service.ownerSession.authenticated, false);
});

test('late private responses after logout cannot repopulate the anonymous cache', async () => {
  let resolvePrivate;
  const calls = [];
  const service = createCommentService({ baseUrl: base, pageURL: `${base}/`, fetchImpl: (url, options) => {
    calls.push({ url, options });
    if (url.includes('/api/admin/')) return new Promise(resolve => { resolvePrivate = resolve; });
    return Promise.resolve(response([comment('public-only')]));
  } });
  service.setOwnerSession(session());
  const privateRead = service.getComments(target());
  const privateFailure = assert.rejects(privateRead);
  await tick();
  service.setOwnerSession({ authenticated: false });
  resolvePrivate(response([comment('pending-private', { targetType: 'photo', targetId: 'photo-a', status: 'pending' })]));
  await privateFailure;
  const visible = await service.getComments(target());
  assert.deepEqual(visible.map(item => item.id), ['public-only']);
  assert.equal(calls.length, 2);
});

test('posting invalidates only the affected target and leaves other cached threads available', async () => {
  const f = fixture();
  await f.service.getComments(target('photo-a'));
  const other = await f.service.getComments(target('photo-b'));
  await f.service.postComment({ ...target('photo-a'), body: '新留言', nickname: '' });
  f.version = 2;
  const updated = await f.service.getComments(target('photo-a'));
  assert.equal(updated[0].id, 'photo-photo-a-2');
  assert.deepEqual(await f.service.getComments(target('photo-b')), other);
  assert.equal(f.reads.length, 3);
});

test('owner reply and moderation invalidate their affected thread without refetching unrelated threads', async () => {
  const f = fixture();
  f.service.setOwnerSession(session());
  const affected = await f.service.getComments(target('photo-a'));
  const other = await f.service.getComments(target('photo-b'));
  await f.service.moderateComment(affected[0].id, 'approved');
  f.version = 2;
  assert.equal((await f.service.getComments(target('photo-a')))[0].id, 'photo-photo-a-2');
  assert.deepEqual(await f.service.getComments(target('photo-b')), other);
  assert.equal(f.reads.length, 3);
  await f.service.postComment({ ...target('photo-a'), parentId: 'photo-photo-a-2', body: '站长回复' });
  f.version = 3;
  assert.equal((await f.service.getComments(target('photo-a')))[0].id, 'photo-photo-a-3');
  assert.deepEqual(await f.service.getComments(target('photo-b')), other);
  assert.equal(f.reads.length, 4);
});
