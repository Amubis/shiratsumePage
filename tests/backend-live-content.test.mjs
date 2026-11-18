import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminApi } from '../server/admin-api.mjs';
import { normalizeGardenContent } from '../src/garden-content.js';

const origin = 'https://owner.example';

async function fixture() {
  const published = normalizeGardenContent({
    owner: { name: 'Amubis', bio: 'Published biography' },
    media: [
      { id: 'photo', url: 'media/photo.webp', caption: { zh: '旧描述', ja: 'Previous Japanese' }, modelIds: ['shiratsume'], originalName: 'private-original.png', metadataSource: { players: ['private-player'] } },
      { id: 'excluded', url: 'media/excluded.webp', enabled: false },
    ],
    journal: [{ id: 'note', title: { zh: '小标题', ja: 'Title' }, body: 'An existing note', images: ['media/note.webp'], published: true }],
  });
  const draft = structuredClone(published);
  draft.owner.bio = 'Unpublished biography';
  draft.media[0].caption.ja = 'Unpublished Japanese description';
  draft.media[0].worldName = 'Private draft world';
  draft.media[0].enabled = false;
  draft.media.push({ ...structuredClone(published.media[0]), id: 'new-upload', caption: 'A private uploaded photograph' });
  draft.journal[0].title.zh = '未发布的标题';
  draft.journal.push({ ...structuredClone(published.journal[0]), id: 'new-note', body: 'Private note, checked for a later publication' });
  let state = { schemaVersion: 1, draft: { content: draft, revision: 'draft-original' }, published: { content: published, revision: 'published-original' }, previousPublished: null };
  let version = 'v1', conflict = false, writes = 0;
  const storage = {
    readState: async () => ({ state: structuredClone(state), version }),
    writeState: async (next, expected) => {
      if (conflict || expected !== version) return false;
      state = structuredClone(next); version = `v${++writes + 1}`; return true;
    },
  };
  const handle = createAdminApi({ storage, seed: published, mode: 'cloud', adminUsername: 'Amubis', adminPassword: 'owner-password', sessionSecret: 'a-session-secret-at-least-32-characters' });
  const login = await handle(new Request(`${origin}/api/admin/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Amubis', password: 'owner-password' }) }));
  assert.equal(login.status, 200);
  const session = await login.json();
  const headers = { Origin: origin, 'Content-Type': 'application/json', Cookie: login.headers.get('set-cookie').split(';')[0], 'X-Garden-CSRF': session.csrfToken };
  const request = (body, changedHeaders = {}, method = 'PATCH') => handle(new Request(`${origin}/api/admin/live-content`, { method, headers: { ...headers, ...changedHeaders }, body: JSON.stringify(body) }));
  return { request, get state() { return state; }, get writes() { return writes; }, failWrite() { conflict = true; } };
}

test('inline photo edits update only selected published/draft text and leave unrelated drafts private', async () => {
  const f = await fixture();
  const previous = structuredClone(f.state);
  const response = await f.request({ targetType: 'photo', targetId: 'photo', locale: 'zh', patch: { caption: '新的照片描述' } });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.published, true);
  assert.equal(result.content.media[0].caption.zh, '新的照片描述');
  assert.equal(result.content.media[0].caption.ja, 'Previous Japanese');
  assert.deepEqual(result.content.media.map(item => item.id), ['photo']);
  assert.deepEqual(result.content.journal.map(item => item.id), ['note']);
  assert.equal(result.content.owner.bio, 'Published biography');
  assert.ok(!JSON.stringify(result).includes('private-original'));
  assert.equal(f.state.draft.content.media[0].caption.zh, '新的照片描述');
  assert.equal(f.state.draft.content.media[0].caption.ja, 'Unpublished Japanese description');
  assert.equal(f.state.draft.content.media[0].worldName, 'Private draft world');
  assert.equal(f.state.draft.content.media[0].enabled, false, 'editing its live text does not undo a pending exclusion');
  assert.equal(f.state.draft.content.owner.bio, 'Unpublished biography');
  assert.deepEqual(f.state.draft.content.media.slice(1), previous.draft.content.media.slice(1));
  assert.deepEqual(f.state.draft.content.journal, previous.draft.content.journal);
  assert.equal(f.state.previousPublished.revision, 'published-original');
  assert.equal(f.writes, 1);
});

test('inline journal edits preserve other locales, images and pending deletion in the draft', async () => {
  const f = await fixture();
  let response = await f.request({ targetType: 'journal', targetId: 'note', locale: 'ja', patch: { title: '新しい題名', body: '新しい本文' } });
  assert.equal(response.status, 200);
  let result = await response.json();
  assert.deepEqual(result.content.journal[0].title, { zh: '小标题', ja: '新しい題名' });
  assert.deepEqual(result.content.journal[0].body, { zh: 'An existing note', ja: '新しい本文' });
  assert.deepEqual(result.content.journal[0].images, f.state.draft.content.journal[0].images);
  assert.equal(f.state.draft.content.journal[0].title.zh, '未发布的标题');
  assert.equal(f.state.draft.content.journal.length, 2);
  // An entry removed from an unpublished draft must not be recreated by a live edit.
  f.state.draft.content.journal = f.state.draft.content.journal.filter(item => item.id !== 'note');
  const draftRevision = f.state.draft.revision;
  response = await f.request({ targetType: 'journal', targetId: 'note', locale: 'zh', patch: { body: '已上线的新正文' } });
  assert.equal(response.status, 200);
  result = await response.json();
  assert.equal(result.content.journal[0].body.zh, '已上线的新正文');
  assert.equal(f.state.draft.content.journal.some(item => item.id === 'note'), false);
  assert.equal(f.state.draft.revision, draftRevision);
});

test('inline writes retain authentication, CSRF and narrow field validation', async () => {
  const f = await fixture();
  const body = { targetType: 'photo', targetId: 'photo', locale: 'zh', patch: { caption: '' } };
  assert.equal((await f.request(body, { Cookie: '' })).status, 401);
  assert.equal((await f.request(body, { 'X-Garden-CSRF': '' })).status, 403);
  assert.equal((await f.request(body, { Origin: 'https://another.example' })).status, 403);
  for (const changed of [
    { patch: { enabled: true } }, { patch: { originalKey: 'private/originals/anything.png' } },
    { patch: {} }, { patch: { caption: 'x'.repeat(5001) } }, { locale: 'en' },
    { targetType: 'owner' },
  ]) assert.equal((await f.request({ ...body, ...changed })).status, 422);
  assert.equal((await f.request({ ...body, targetId: 'new-upload' })).status, 404, 'private draft uploads cannot be published through the inline text endpoint');
  assert.equal((await f.request({ ...body, targetId: 'excluded' })).status, 404, 'excluded published references are not visitor-facing targets');
  assert.equal(f.writes, 0);
  assert.equal((await f.request(body)).status, 200, 'empty photo descriptions are valid');
});

test('a concurrent storage write returns conflict without publishing or changing the read snapshot', async () => {
  const f = await fixture(), before = structuredClone(f.state);
  f.failWrite();
  const response = await f.request({ targetType: 'journal', targetId: 'note', locale: 'zh', patch: { body: 'Conflicting edit' } });
  assert.equal(response.status, 409);
  assert.deepEqual(f.state, before);
  assert.equal(f.writes, 0);
});
