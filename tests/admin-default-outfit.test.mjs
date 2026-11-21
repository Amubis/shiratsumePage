import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { safeGardenURL, normalizeGardenContent } from '../src/garden-content.js';
import { createAdminApi } from '../server/admin-api.mjs';

const source = await readFile(new URL('../admin/app.js', import.meta.url), 'utf8');
const handler = name => {
  const value = source.match(new RegExp(`^function ${name}\\([\\s\\S]*?^\\}`, 'm'))?.[0];
  assert.ok(value, `exercise the actual ${name} control`); return value;
};
function element(tag, attributes = {}, ...children) {
  const listeners = new Map();
  const node = { tag, children: children.flat(Infinity).filter(child => child !== undefined && child !== null), style: {},
    addEventListener(type, callback) { listeners.set(type, callback); },
    emit(type) { return listeners.get(type)?.({ target: this }); },
  };
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value); else node[key] = value;
  }
  return node;
}
const all = node => [node, ...node.children.filter(child => typeof child === 'object').flatMap(all)];
const text = node => node.children.map(child => typeof child === 'object' ? text(child) : child).join('');
const look = (id, front = `media/${id}.png`) => ({ id, front, label: { zh: id, ja: id }, imageWidth: 1440, imageHeight: 2560 });
function fixture({ outfits = [look('sailor'), look('lace')], defaultOutfitId = 'sailor', selected = 'lace' } = {}) {
  const state = { content: normalizeGardenContent({ outfits, settings: { defaultOutfitId } }), selectedOutfit: selected, dirty: false };
  const counts = { changed: 0, rendered: 0 };
  const names = ['localizedValue', 'moveItem', 'reorderButtons', 'defaultOutfitId', 'setDefaultOutfit', 'renderOutfits'];
  const controls = runInNewContext(`${names.map(handler).join('\n')}\n({${names.join(',')}})`, {
    state, safeGardenURL, node: element,
    button: (label, action, kind = 'secondary', attributes = {}) => element('button', { class: kind, onclick: action, ...attributes }, label),
    panel: (...children) => element('section', {}, children), intro: (...children) => element('header', {}, children), empty: (...children) => element('section', {}, children),
    image: (src, alt, className) => element('img', { src, alt, className }),
    localizedFields: () => element('label'), field: () => element('label'), uploadPicker: () => element('button'), identifier: () => 'new',
    confirmAction: async () => true, queueFiles() { throw new Error('Choosing a default must not upload files'); },
    changed() { counts.changed++; state.dirty = true; }, render() { counts.rendered++; },
    api() { throw new Error('Choosing a default must not save or publish automatically'); },
  });
  const render = () => element('div', {}, controls.renderOutfits());
  return { state, counts, controls, render, button(label) { return all(render()).find(node => node.tag === 'button' && text(node) === label); } };
}

test('choosing the default changes only its ID in the draft and keeps the outfit order', () => {
  const f = fixture(), original = f.state.content.outfits;
  const choose = f.button('设为默认展示立绘');
  assert.equal(choose.disabled, false); assert.equal(choose['aria-pressed'], 'false');
  choose.emit('click');
  assert.equal(f.state.content.settings.defaultOutfitId, 'lace');
  assert.equal(f.state.content.outfits, original);
  assert.deepEqual(original.map(item => item.id), ['sailor', 'lace']);
  assert.equal(f.state.selectedOutfit, 'lace'); assert.equal(f.state.dirty, true);
  assert.deepEqual(f.counts, { changed: 1, rendered: 1 });
  assert.equal(f.button('默认展示立绘').disabled, true);
  assert.equal(all(f.render()).filter(node => node.tag === 'small' && text(node).endsWith(' · 默认展示')).length, 1);
});

test('reordering changes the rail order without replacing an explicitly selected default', () => {
  const f = fixture({ defaultOutfitId: 'lace' });
  f.controls.moveItem(f.state.content.outfits, 1, -1);
  assert.deepEqual(f.state.content.outfits.map(item => item.id), ['lace', 'sailor']);
  assert.equal(f.controls.defaultOutfitId(), 'lace');
  f.controls.moveItem(f.state.content.outfits, 0, 1);
  assert.equal(f.state.content.settings.defaultOutfitId, 'lace');
  assert.equal(f.counts.changed, 2);
});

test('outfits without a usable front cannot become the default', () => {
  const f = fixture({ outfits: [look('empty', ''), look('lace')], selected: 'empty' });
  assert.equal(f.controls.defaultOutfitId(), 'lace');
  assert.equal(f.button('设为默认展示立绘').disabled, true);
  assert.equal(f.controls.setDefaultOutfit('empty'), false);
  assert.equal(f.controls.setDefaultOutfit('missing'), false);
  assert.equal(f.counts.changed, 0); assert.equal(f.state.content.settings.defaultOutfitId, 'lace');
});

test('deleting a default selects the next usable portrait and deleting the final portrait clears it', async () => {
  const f = fixture({ defaultOutfitId: 'lace' });
  await f.button('删除这套服装').emit('click');
  assert.equal(f.state.content.settings.defaultOutfitId, 'sailor');
  assert.deepEqual(f.state.content.outfits.map(item => item.id), ['sailor']);
  f.state.selectedOutfit = 'sailor';
  await f.button('删除这套服装').emit('click');
  assert.equal(f.state.content.settings.defaultOutfitId, null);
  assert.equal(f.state.content.outfits.length, 0); assert.equal(f.counts.changed, 2);
});

test('saving the default remains private until publication and survives an API restart', async () => {
  const seed = normalizeGardenContent({ schemaVersion: 1, outfits: [look('sailor'), look('lace')] });
  let stored = null, version = 0;
  const storage = {
    async readState() { return stored ? { state: structuredClone(stored), version: String(version) } : null; },
    async writeState(next, expected) {
      if (expected !== (stored ? String(version) : null)) return false;
      stored = structuredClone(next); version++; return true;
    },
  };
  const origin = 'https://default-outfit.example';
  let api = createAdminApi({ storage, seed, mode: 'local' });
  const request = (path, init = {}) => api(new Request(origin + path, init));
  const session = await (await request('/api/admin/session')).json();
  const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-Garden-CSRF': session.csrfToken };
  const draft = await (await request('/api/admin/content')).json();
  draft.content.settings.defaultOutfitId = 'lace';
  const savedResponse = await request('/api/admin/content', { method: 'PUT', headers, body: JSON.stringify({ content: draft.content, revision: draft.revision }) });
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json();
  assert.equal(saved.content.settings.defaultOutfitId, 'lace');
  assert.deepEqual(saved.content.outfits.map(item => item.id), ['sailor', 'lace']);
  assert.equal((await (await request('/api/content')).json()).settings.defaultOutfitId, 'sailor', 'saving a default does not publish any draft');

  api = createAdminApi({ storage, seed, mode: 'local' });
  const restored = await (await request('/api/admin/content')).json();
  assert.equal(restored.content.settings.defaultOutfitId, 'lace');
  const restoredSession = await (await request('/api/admin/session')).json();
  const publishedResponse = await request('/api/admin/publish', { method: 'POST', headers: { ...headers, 'X-Garden-CSRF': restoredSession.csrfToken }, body: JSON.stringify({ revision: restored.revision }) });
  assert.equal(publishedResponse.status, 200);
  const publication = await publishedResponse.json();
  assert.equal(publication.content.settings.defaultOutfitId, 'lace');
  const publicContent = await (await request('/api/content')).json();
  assert.equal(publicContent.settings.defaultOutfitId, 'lace');
  assert.deepEqual(publicContent.outfits.map(item => item.id), ['sailor', 'lace']);
});
