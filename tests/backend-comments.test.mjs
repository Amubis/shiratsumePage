import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createLocalAdminServer } from '../server/local-admin.mjs';
import { createAdminApi } from '../server/admin-api.mjs';
import { normalizeGardenContent } from '../src/garden-content.js';

const seed = normalizeGardenContent({
  schemaVersion: 1,
  settings: { publicSiteUrl: 'https://public.example/garden/' },
  owner: { name: 'Garden author' },
  media: [{ id: 'photo-live', url: './assets/photo.png', enabled: true }, { id: 'photo-hidden', url: './assets/hidden.png', enabled: false }],
  journal: [{ id: 'note-live', body: 'A published note', published: true }, { id: 'note-hidden', body: 'A private note', published: false }],
});
const photoTarget = { targetType: 'photo', targetId: 'photo-live' };
const noteTarget = { targetType: 'note', targetId: 'note-live' };
const query = target => `/api/comments?${new URLSearchParams(target)}`;

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
  server.closeIdleConnections();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
async function json(response, status = 200) {
  const value = await response.json();
  assert.equal(response.status, status, JSON.stringify(value));
  return value;
}
async function local(t, options = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), 'garden-comments-http-'));
  const dataDir = join(rootDir, '.garden-data');
  const errors = [];
  const context = { rootDir, dataDir, origin: '', server: null, headers: {} };
  const start = async () => {
    context.server = await createLocalAdminServer({ rootDir, dataDir, seed, ...options, onError: error => errors.push(error) });
    context.origin = await listen(context.server);
    const session = await json(await fetch(`${context.origin}/api/admin/session`));
    context.headers = { Origin: context.origin, 'Content-Type': 'application/json', 'X-Garden-CSRF': session.csrfToken };
  };
  await start();
  context.restart = async () => { await close(context.server); await start(); };
  t.after(async () => { await close(context.server); await rm(rootDir, { recursive: true, force: true }); assert.deepEqual(errors, []); });
  return context;
}
const submit = (context, body, origin = context.origin) => fetch(`${context.origin}/api/comments`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin === null ? {} : { Origin: origin }) }, body: JSON.stringify(body),
});
const admin = (context, path, method = 'GET', body, headers = {}) => fetch(`${context.origin}/api/admin/${path}`, {
  method, headers: { ...context.headers, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const publicComments = (context, target = photoTarget) => fetch(`${context.origin}${query(target)}`);
const createComment = async (context, body = 'Hello garden', target = photoTarget) => (await json(await submit(context, { ...target, body }), 201)).comment;
const moderate = async (context, id, body) => json(await admin(context, `comments/${id}`, 'PATCH', body));

test('an omitted nickname remains localizable rather than storing a Chinese display label', async t => {
  const context=await local(t);
  const comment=await createComment(context,'こんにちは');
  await moderate(context,comment.id,{status:'approved'});
  const result=await json(await publicComments(context));
  assert.equal(result.comments[0].nickname,'');
});

test('owner comment lists filter the requested thread and keep the unfiltered manager listing', async t => {
  const context = await local(t, { seed: normalizeGardenContent({ ...seed, media: [...seed.media, { id: 'photo-other', url: './assets/other.png', enabled: true }] }) });
  const first = await createComment(context, 'Photo one');
  const second = await createComment(context, 'Photo two');
  const other = await createComment(context, 'Other photo', { targetType: 'photo', targetId: 'photo-other' });
  const note = await createComment(context, 'Note message', noteTarget);
  await moderate(context, first.id, { status: 'approved' });
  const list = async target => (await json(await admin(context, `comments?${new URLSearchParams(target)}`))).comments;
  assert.deepEqual((await list(photoTarget)).map(item => item.id).sort(), [first.id, second.id].sort());
  assert.deepEqual((await list(noteTarget)).map(item => item.id), [note.id]);
  assert.deepEqual((await list({ targetType: 'photo', targetId: 'photo-other' })).map(item => item.id), [other.id]);
  const all = await json(await admin(context, 'comments'));
  assert.equal(all.comments.length, 4);
  assert.deepEqual(new Set(all.comments.map(item => item.id)), new Set([first.id, second.id, other.id, note.id]));
  for (const params of [{ targetType: 'photo' }, { targetId: 'photo-live' }, { targetType: 'owner', targetId: 'photo-live' }]) {
    await json(await admin(context, `comments?${new URLSearchParams(params)}`), 422);
  }
});

test('anonymous HTTP comments await moderation and server-controlled author replies become public', async t => {
  const context = await local(t);
  const text = '<img src=x onerror=alert(1)>\nこんにちは，花园';
  const submitted = await json(await submit(context, { ...photoTarget, body: text, verified: true, status: 'approved', nickname: 'Garden author', readAt: '2026-01-01T00:00:00Z', ip: '203.0.113.42' }), 201);
  assert.equal(submitted.comment.status, 'pending');
  assert.equal('body' in submitted.comment, false);
  const publicResponse = await publicComments(context);
  assert.equal(publicResponse.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(await json(publicResponse), { available: true, comments: [] });
  let review = await json(await admin(context, 'comments?status=pending&unread=true'));
  assert.equal(review.unreadCount, 1);
  assert.equal(review.pendingCount, 1);
  assert.equal(review.comments[0].verified, false);
  assert.equal(review.comments[0].body, text);
  assert.equal(review.comments[0].readAt, null);
  assert.equal('ip' in review.comments[0], false);
  const notifications = await json(await admin(context, 'notifications'));
  assert.deepEqual(notifications.notifications.map(item => item.id), [submitted.comment.id]);
  await json(await admin(context, `comments/${submitted.comment.id}`, 'PATCH', { status: 'approved' }, { 'X-Garden-CSRF': 'wrong' }), 403);
  await json(await admin(context, `comments/${submitted.comment.id}`, 'PATCH', { status: 'approved' }, { Origin: 'https://evil.example' }), 403);
  const approved = await moderate(context, submitted.comment.id, { status: 'approved', read: true });
  assert.equal(approved.unreadCount, 0);
  assert.equal(approved.pendingCount, 0);
  assert.equal(approved.comment.status, 'approved');
  assert.ok(approved.comment.readAt);
  const reply = await json(await admin(context, `comments/${submitted.comment.id}/reply`, 'POST', { body: '作者的回复', verified: false, nickname: 'Someone else' }), 201);
  assert.equal(reply.comment.verified, true);
  assert.equal(reply.comment.nickname, 'Garden author');
  assert.equal(reply.comment.parentId, submitted.comment.id);
  assert.equal(reply.comment.status, 'approved');
  const published = (await json(await publicComments(context))).comments;
  assert.equal(published.length, 2);
  assert.equal(published.find(item => item.id === submitted.comment.id).body, text);
  assert.equal(published.find(item => item.id === submitted.comment.id).verified, false);
  assert.equal(published.find(item => item.id === reply.comment.id).verified, true);
  for (const item of published) for (const privateField of ['readAt', 'ip', 'address', 'rateKey']) assert.equal(privateField in item, false);
  const disk = JSON.parse(await readFile(join(context.dataDir, 'comments.json'), 'utf8'));
  assert.equal(disk.comments.some(item => 'ip' in item || 'address' in item), false);
  assert.equal(JSON.stringify(disk).includes('203.0.113.42'), false);
  review = await json(await admin(context, 'notifications'));
  assert.equal(review.unreadCount, 0);
  assert.equal(review.pendingCount, 0);
});

test('public HTTP comment CORS permits only the current, published site and configured site Origins', async t => {
  const context = await local(t, { publicSiteOrigins: ['https://extra.example'] });
  for (const origin of [null, 'https://evil.example', 'null', 'https://public.example/']) {
    const denied = await submit(context, { ...photoTarget, body: 'Denied origin' }, origin);
    await json(denied, 403);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
  }
  for (const origin of [context.origin, 'https://public.example', 'https://extra.example']) {
    const response = await submit(context, { ...photoTarget, body: `Allowed ${origin}` }, origin);
    await json(response, 201);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.equal(response.headers.get('vary'), 'Origin');
  }
  const preflight = origin => fetch(`${context.origin}/api/comments`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  const allowed = await preflight('https://public.example');
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://public.example');
  assert.equal(allowed.headers.get('access-control-allow-headers'), 'Content-Type');
  await json(await preflight('https://evil.example'), 403);
  await json(await fetch(`${context.origin}/api/comments`, { method: 'OPTIONS', headers: { Origin: 'https://public.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-garden-csrf' } }), 403);
  const draft = await json(await admin(context, 'content'));
  draft.content.settings.publicSiteUrl = 'https://future.example/garden/';
  const saved = await json(await admin(context, 'content', 'PUT', { content: draft.content, revision: draft.revision }));
  await json(await submit(context, { ...photoTarget, body: 'Draft cannot allow this origin' }, 'https://future.example'), 403);
  await json(await admin(context, 'publish', 'POST', { revision: saved.revision }));
  await json(await submit(context, { ...photoTarget, body: 'Published origin' }, 'https://future.example'), 201);
  await json(await submit(context, { ...photoTarget, body: 'Old origin' }, 'https://public.example'), 403);
});

test('HTTP validation rejects malformed comments and unpublished photo or note targets', async t => {
  const cases = [
    ['missing text', { ...photoTarget }, 422],
    ['blank text', { ...photoTarget, body: ' \n ' }, 422],
    ['non-text body', { ...photoTarget, body: { html: 'no' } }, 422],
    ['too long text', { ...photoTarget, body: '🌸'.repeat(2001) }, 422],
    ['too long nickname', { ...photoTarget, body: 'Hello', nickname: '🌸'.repeat(41) }, 422],
    ['unknown target kind', { targetType: 'owner', targetId: 'photo-live', body: 'Hello' }, 422],
    ['hidden photo', { targetType: 'photo', targetId: 'photo-hidden', body: 'Hello' }, 404],
    ['hidden note', { targetType: 'note', targetId: 'note-hidden', body: 'Hello' }, 404],
    ['missing target', { targetType: 'photo', targetId: 'absent', body: 'Hello' }, 404],
    ['missing parent', { ...photoTarget, parentId: 'not-a-comment', body: 'Hello' }, 422],
  ];
  for (const [name, body, status] of cases) await t.test(name, async child => {
    const context = await local(child);
    await json(await submit(context, body), status);
    assert.equal((await json(await admin(context, 'comments'))).comments.length, 0);
  });
  await t.test('JSON and Content-Type', async child => {
    const context = await local(child);
    for (const [body, mime, status] of [['{bad', 'application/json', 400], ['[]', 'application/json', 400], ['{}', 'text/plain', 415]]) {
      await json(await fetch(`${context.origin}/api/comments`, { method: 'POST', headers: { Origin: context.origin, 'Content-Type': mime }, body }), status);
    }
    const hiddenGet = await fetch(`${context.origin}${query({ targetType: 'note', targetId: 'note-hidden' })}`);
    await json(hiddenGet, 404);
    assert.equal(hiddenGet.headers.get('access-control-allow-origin'), '*');
  });
});

test('anonymous HTTP replies require an approved top-level parent on the same published target', async t => {
  const context = await local(t);
  const parent = await createComment(context);
  await json(await submit(context, { ...photoTarget, parentId: parent.id, body: 'Parent still pending' }), 422);
  await json(await admin(context, `comments/${parent.id}/reply`, 'POST', { body: 'Author reply too early' }), 409);
  await moderate(context, parent.id, { status: 'approved' });
  await json(await submit(context, { ...noteTarget, parentId: parent.id, body: 'Wrong target' }), 422);
  const child = await json(await submit(context, { ...photoTarget, parentId: parent.id, body: 'One-level reply' }), 201);
  assert.equal((await json(await publicComments(context))).comments.length, 1);
  await moderate(context, child.comment.id, { status: 'approved' });
  await json(await submit(context, { ...photoTarget, parentId: child.comment.id, body: 'Too deep' }), 422);
  assert.equal((await json(await publicComments(context))).comments.length, 2);
  const authorReply = await json(await admin(context, `comments/${child.comment.id}/reply`, 'POST', { body: 'Reply to this thread' }), 201);
  assert.equal(authorReply.comment.parentId, parent.id);
  await moderate(context, parent.id, { status: 'rejected' });
  assert.deepEqual((await json(await publicComments(context))).comments, []);
  await json(await admin(context, `comments/${parent.id}/reply`, 'POST', { body: 'Hidden thread' }), 409);
});

test('HTTP moderation filters, notifications and batch read actions preserve their state independently', async t => {
  const context = await local(t);
  const first = await createComment(context, 'First message');
  const second = await createComment(context, 'Second message', noteTarget);
  const third = await createComment(context, 'Third message');
  assert.equal((await json(await admin(context, 'comments?status=pending&unread=true'))).comments.length, 3);
  for (const path of ['comments?status=bogus', 'comments?unread=1', 'comments?limit=501']) await json(await admin(context, path), 400);
  for (const body of [{}, { status: 'pending' }, { read: false }]) await json(await admin(context, `comments/${first.id}`, 'PATCH', body), 422);
  const read = await json(await admin(context, 'notifications/read', 'POST', { ids: [first.id, first.id] }));
  assert.equal(read.updated, 1);
  assert.equal(read.unreadCount, 2);
  assert.equal(read.pendingCount, 3);
  assert.deepEqual((await json(await admin(context, 'comments?unread=false'))).comments.map(item => item.id), [first.id]);
  const spam = await moderate(context, second.id, { status: 'spam', read: true });
  assert.equal(spam.unreadCount, 1);
  assert.equal(spam.pendingCount, 2);
  assert.deepEqual((await json(await admin(context, 'comments?status=spam'))).comments.map(item => item.id), [second.id]);
  const notifications = await json(await admin(context, 'notifications'));
  assert.deepEqual(notifications.notifications.map(item => item.id), [third.id]);
  const all = await json(await admin(context, 'notifications/read', 'POST', { all: true }));
  assert.equal(all.updated, 1);
  assert.equal(all.unreadCount, 0);
  assert.equal((await json(await admin(context, 'notifications/read', 'POST', { all: true }))).updated, 0);
  await moderate(context, first.id, { status: 'rejected' });
  await moderate(context, third.id, { status: 'deleted' });
  const stored = await json(await admin(context, 'comments?status=all'));
  assert.equal(stored.comments.length, 3);
  assert.equal(stored.pendingCount, 0);
  assert.deepEqual((await json(await publicComments(context))).comments, []);
  await json(await admin(context, 'notifications/read', 'POST', {}), 422);
  await json(await admin(context, 'notifications/read', 'POST', { all: true }, { 'X-Garden-CSRF': '' }), 403);
});

test('reviewing a message marks it read immediately and keeps the first read time after restart', async t => {
  const context = await local(t);
  const first = await createComment(context, 'Approve this message');
  const second = await createComment(context, 'Reject this message');
  const approved = await moderate(context, first.id, { status: 'approved' });
  assert.ok(approved.comment.readAt);
  assert.equal(approved.unreadCount, 1);
  assert.equal(approved.pendingCount, 1);
  const rejected = await moderate(context, second.id, { status: 'rejected' });
  assert.ok(rejected.comment.readAt);
  assert.equal(rejected.unreadCount, 0);
  assert.equal(rejected.pendingCount, 0);
  const again = await moderate(context, first.id, { status: 'approved' });
  assert.equal(again.comment.readAt, approved.comment.readAt);
  await context.restart();
  const notifications = await json(await admin(context, 'notifications'));
  assert.equal(notifications.unreadCount, 0);
  assert.deepEqual(notifications.notifications, []);
});

test('local storage repairs previously reviewed unread messages without marking pending messages read', async t => {
  const context = await local(t);
  const reviewed = await createComment(context, 'Previously approved');
  const pending = await createComment(context, 'Still pending');
  const file = join(context.dataDir, 'comments.json');
  const state = JSON.parse(await readFile(file, 'utf8'));
  const old = state.comments.find(comment => comment.id === reviewed.id);
  old.status = 'approved';
  old.updatedAt = '2026-01-02T01:00:00.000Z';
  old.readAt = null;
  await writeFile(file, JSON.stringify(state));
  await context.restart();
  const notifications = await json(await admin(context, 'notifications'));
  assert.equal(notifications.unreadCount, 1);
  assert.deepEqual(notifications.notifications.map(comment => comment.id), [pending.id]);
  const approved = await json(await admin(context, 'comments?status=approved'));
  assert.equal(approved.comments[0].readAt, old.updatedAt);
});

test('HTTP honeypot submission is silent and concurrent anonymous submissions are limited atomically', async t => {
  await t.test('honeypot', async child => {
    const context = await local(child);
    const result = await json(await submit(context, { ...photoTarget, body: 'Robot payload', website: 'https://spam.example' }), 202);
    assert.equal(result.accepted, true);
    assert.equal((await json(await admin(context, 'comments'))).comments.length, 0);
  });
  await t.test('rate limit', async child => {
    const context = await local(child);
    const responses = await Promise.all(Array.from({ length: 6 }, (_, index) => submit(context, { ...photoTarget, body: `Concurrent ${index}` })));
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 201, 201, 201, 201, 429]);
    for (const response of responses) {
      await json(response, response.status);
      if (response.status === 429) {
        assert.ok(Number(response.headers.get('retry-after')) > 0);
        assert.ok(Number(response.headers.get('retry-after')) <= 600);
        assert.equal(response.headers.get('access-control-allow-origin'), context.origin);
      }
    }
    const review = await json(await admin(context, 'comments'));
    assert.equal(review.comments.length, 5);
    assert.equal(review.unreadCount, 5);
    assert.equal(review.pendingCount, 5);
    const file = JSON.parse(await readFile(join(context.dataDir, 'comments.json'), 'utf8'));
    assert.equal(Object.keys(file.rates).length, 1);
    assert.match(Object.keys(file.rates)[0], /^[a-f\d]{64}$/);
  });
});

test('local HTTP comments, moderation and replies survive a server restart without touching content storage', async t => {
  const context = await local(t);
  const submitted = await createComment(context, 'Persistent message');
  await moderate(context, submitted.id, { status: 'approved', read: true });
  const reply = await json(await admin(context, `comments/${submitted.id}/reply`, 'POST', { body: 'Persistent author reply' }), 201);
  await context.restart();
  const published = (await json(await publicComments(context))).comments;
  assert.deepEqual(published.map(item => item.id).sort(), [submitted.id, reply.comment.id].sort());
  assert.equal(published.find(item => item.id === reply.comment.id).verified, true);
  const review = await json(await admin(context, 'comments'));
  assert.equal(review.unreadCount, 0);
  assert.equal(review.pendingCount, 0);
  await assert.rejects(readFile(join(context.dataDir, 'state.json')), { code: 'ENOENT' });
});

test('HTTP comments report an explicit unavailable state when the cloud comments database is absent', async t => {
  const errors = [];
  const handler = createAdminApi({ seed, storage: { readState: async () => null }, mode: 'local', onError: error => errors.push(error) });
  let origin;
  const server = createServer(async (incoming, outgoing) => {
    const request = new Request(`${origin}${incoming.url}`, { method: incoming.method, headers: incoming.headers });
    const response = await handler(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) await pipeline(Readable.fromWeb(response.body), outgoing);
    else outgoing.end();
  });
  origin = await listen(server);
  t.after(async () => { await close(server); assert.deepEqual(errors, []); });
  for (const path of [query(photoTarget), '/api/admin/comments', '/api/admin/notifications']) {
    const response = await fetch(`${origin}${path}`);
    const value = await json(response, 503);
    assert.equal(value.code, 'comments_unavailable');
    assert.equal(value.available, false);
    if (path.startsWith('/api/comments')) assert.equal(response.headers.get('access-control-allow-origin'), '*');
  }
});
