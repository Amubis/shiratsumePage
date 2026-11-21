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
  const request = (body, changedHeaders = {}, method = 'PATCH', path = '/api/admin/live-content') => handle(new Request(`${origin}${path}`, { method, headers: { ...headers, ...changedHeaders }, body: JSON.stringify(body) }));
  const addEmail = (body, changedHeaders) => request(body, changedHeaders, 'POST', '/api/admin/owner/contact');
  return { request, addEmail, get state() { return state; }, get writes() { return writes; }, failWrite() { conflict = true; } };
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

test('bilingual photo descriptions update both languages in one write without publishing other drafts', async () => {
  const f = await fixture(), before = structuredClone(f.state);
  const caption = { zh: '新的中文描述', ja: '新しい日本語の説明' };
  const response = await f.request({ targetType: 'photo', targetId: 'photo', patch: { caption } });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.content.media[0].caption, caption);
  assert.deepEqual(result.content.media.map(item => item.id), ['photo']);
  assert.equal(result.content.owner.bio, before.published.content.owner.bio);
  const expectedPublished = structuredClone(before.published.content);
  expectedPublished.media[0].caption = caption;
  assert.deepEqual(f.state.published.content, expectedPublished);
  const expectedDraft = structuredClone(before.draft.content);
  expectedDraft.media[0].caption = caption;
  assert.deepEqual(f.state.draft.content, expectedDraft);
  assert.deepEqual(f.state.previousPublished, before.published);
  assert.equal(f.writes, 1, 'both descriptions share the same conditional state write');

  // A legacy unlocalized description can be replaced without inventing text
  // in the language deliberately left empty by the editor.
  f.state.published.content.media[0].caption = 'Legacy description';
  f.state.draft.content.media[0].caption = 'Legacy draft description';
  const emptyJapanese = await f.request({ targetType: 'photo', targetId: 'photo', patch: { caption: { zh: '中文\u0000描述', ja: '' } } });
  assert.equal(emptyJapanese.status, 200);
  assert.deepEqual((await emptyJapanese.json()).content.media[0].caption, { zh: '中文描述', ja: '' });
  assert.deepEqual(f.state.draft.content.media[0].caption, { zh: '中文描述', ja: '' });
  assert.equal(f.writes, 2);
});

test('bilingual photo validation rejects an invalid language before either description changes', async () => {
  const f = await fixture(), before = structuredClone(f.state);
  const body = { targetType: 'photo', targetId: 'photo', patch: { caption: { zh: 'valid Chinese', ja: 'valid Japanese' } } };
  for (const caption of [
    { zh: 'valid', ja: 'x'.repeat(5001) }, { zh: 'x'.repeat(5001), ja: 'valid' },
    { zh: 'valid', ja: 42 }, { zh: 'valid' }, { ja: 'valid' },
    { zh: 'valid', ja: 'valid', en: 'extra language' }, {}, [], null,
  ]) assert.equal((await f.request({ ...body, patch: { caption } })).status, 422);
  assert.equal((await f.request({ ...body, locale: 'en' })).status, 422);
  assert.equal((await f.request({ ...body, targetType: 'journal', targetId: 'note' })).status, 422);
  assert.equal((await f.request({ ...body, patch: { ...body.patch, enabled: true } })).status, 422);
  assert.deepEqual(f.state, before);
  assert.equal(f.writes, 0);
  const response = await f.request({ ...body, patch: { caption: { zh: '中'.repeat(5000), ja: '日'.repeat(5000) } } });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.content.media[0].caption.zh.length, 5000);
  assert.equal(result.content.media[0].caption.ja.length, 5000);
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

test('bilingual journal fields share one write while unedited draft translations stay private', async () => {
  const f = await fixture(), before = structuredClone(f.state);
  const patch = { title: { ja: '新しい題名' }, body: { zh: '新的正文', ja: '新しい本文' } };
  const response = await f.request({ targetType: 'journal', targetId: 'note', patch });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.content.journal[0].title, { zh: '小标题', ja: '新しい題名' });
  assert.deepEqual(result.content.journal[0].body, patch.body);
  assert.deepEqual(f.state.draft.content.journal[0].title, { zh: '未发布的标题', ja: '新しい題名' });
  assert.deepEqual(f.state.published.content.journal[0].images, before.published.content.journal[0].images);
  assert.deepEqual(f.state.draft.content.journal[1], before.draft.content.journal[1]);
  assert.deepEqual(f.state.previousPublished, before.published);
  assert.equal(f.writes, 1);
});

test('invalid journal translations leave both versions unchanged', async () => {
  const f = await fixture(), before = structuredClone(f.state);
  for (const title of [{ zh: 'valid', ja: 'x'.repeat(501) }, { zh: 42 }, { en: 'unsupported' }, {}]) {
    assert.equal((await f.request({ targetType: 'journal', targetId: 'note', patch: { title, body: { zh: 'valid' } } })).status, 422);
  }
  assert.deepEqual(f.state, before);
  assert.equal(f.writes, 0);
  const response = await f.request({ targetType: 'journal', targetId: 'note', patch: { body: { zh: '新的正文' } } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).content.journal[0].body, '新的正文', 'untranslated legacy text retains its public fallback without inventing a translation');
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
  const photoResponse = await f.request({ targetType: 'photo', targetId: 'photo', patch: { caption: { zh: 'Conflicting Chinese', ja: 'Conflicting Japanese' } } });
  assert.equal(photoResponse.status, 409);
  assert.deepEqual(f.state, before);
  assert.equal(f.writes, 0);
});

test('adding a live email appends only the contact and preserves existing draft labels', async () => {
  const f = await fixture();
  f.state.published.content.owner.contacts.push({ label: 'Website', url: 'https://example.org/' });
  f.state.draft.content.owner.contacts.push({ label: 'Existing email', url: 'mailto:Owner@Example.org?subject=Hello' });
  const before = structuredClone(f.state);
  const response = await f.addEmail({ email: 'owner@example.org' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { email: 'owner@example.org', updated: true });
  const expected = structuredClone(before.published.content);
  expected.owner.contacts.push({ label: 'owner@example.org', url: 'mailto:owner@example.org' });
  assert.deepEqual(f.state.published.content, expected);
  assert.deepEqual(f.state.draft, before.draft);
  assert.deepEqual(f.state.previousPublished, before.published);
  const duplicate = await f.addEmail({ email: 'OWNER@example.org' });
  assert.deepEqual(await duplicate.json(), { email: 'OWNER@example.org', updated: false });
  assert.equal(f.writes, 1);
});

test('publishing an owner email requires authorization and a successful conditional write', async () => {
  const f = await fixture(), before = structuredClone(f.state);
  const payload = { email: 'owner@example.org' };
  assert.equal((await f.addEmail(payload, { Cookie: '' })).status, 401);
  assert.equal((await f.addEmail(payload, { 'X-Garden-CSRF': '' })).status, 403);
  assert.equal((await f.addEmail(payload, { Origin: 'https://another.example' })).status, 403);
  assert.equal((await f.addEmail({ email: 'owner@example.org?bcc=spam@example.org' })).status, 422);
  assert.equal((await f.addEmail({ ...payload, label: 'Other fields are unsupported' })).status, 422);
  f.failWrite();
  assert.equal((await f.addEmail(payload)).status, 409);
  assert.deepEqual(f.state, before);
  assert.equal(f.writes, 0);
});
