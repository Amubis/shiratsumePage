import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../admin/app.js', import.meta.url), 'utf8');
const handler = name => {
  const value = source.match(new RegExp(`^function ${name}\\([\\s\\S]*?^\\}`, 'm'))?.[0];
  assert.ok(value, `exercise the actual ${name} control`);
  return value;
};
function element(tag, attributes = {}, ...children) {
  const listeners = new Map();
  const node = {
    tag, children: children.flat(Infinity).filter(child => child !== undefined && child !== null),
    append(...next) { this.children.push(...next); },
    replaceChildren(...next) { this.children = next; },
    addEventListener(type, callback) { const list = listeners.get(type) || []; list.push(callback); listeners.set(type, list); },
    emit(type) { for (const callback of listeners.get(type) || []) callback({ target: this }); },
  };
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node[key] = value;
  }
  return node;
}
const all = node => [node, ...node.children.filter(child => typeof child === 'object').flatMap(all)];
const text = node => node.children.map(child => typeof child === 'object' ? text(child) : child).join('');
const photo = (id, enabled, name = id) => ({ id, name, enabled, modelIds: [], alt: '', worldId: '', url: `media/${id}.jpg`, takenAt: null });
function fixture(media, { filter = 'published', search = '' } = {}) {
  const state = { content: { media }, selectedPhoto: null, photoFilter: filter, photoSearch: search, photoEditSequence: [], selectedPhotos: new Set(), dirty: false };
  let renders = 0, changes = 0;
  const names = ['cohortIds', 'matchesCohort', 'cohortBadge', 'filteredPhotos', 'photoCategoryTabs', 'openPhotoEditor', 'photoEditItems', 'movePhotoEditor', 'photoDetailNavigation', 'renderPhotoGrid'];
  const controls = runInNewContext(`${names.map(handler).join('\n')}\n({${names.join(',')}})`, {
    state, node: element,
    button: (label, action, kind = 'secondary', attributes = {}) => element('button', { class: `button ${kind}`, onclick: action, ...attributes }, label),
    photoName: item => item.name, localizedValue: value => value || '',
    image: reference => element('img', { src: reference }), empty: (title, description) => element('section', { class: 'empty' }, title, description),
    render() { renders++; }, changed() { changes++; }, $: () => null,
    api() { throw new Error('Navigation must never save or publish content'); },
  });
  return { state, controls, get renders() { return renders; }, get changes() { return changes; } };
}

test('photo categories expose separate counted lists and changing category never edits content', () => {
  const f = fixture([photo('a', true), photo('b', false), photo('c', true)]);
  const before = JSON.stringify(f.state.content);
  const tabs = f.controls.photoCategoryTabs(), buttons = all(tabs).filter(node => node.tag === 'button');
  assert.deepEqual(buttons.map(text), ['已纳入相册2', '未纳入相册1']);
  assert.deepEqual(buttons.map(node => node['aria-pressed']), ['true', 'false']);
  const grid = element('div'); f.controls.renderPhotoGrid(grid);
  assert.deepEqual(grid.children.map(node => all(node).find(child => child.tag === 'img')?.src), ['media/a.jpg', 'media/c.jpg']);
  buttons[1].emit('click');
  f.controls.renderPhotoGrid(grid);
  assert.equal(f.state.photoFilter, 'draft');
  assert.deepEqual(grid.children.map(node => all(node).find(child => child.tag === 'img')?.src), ['media/b.jpg']);
  assert.equal(JSON.stringify(f.state.content), before);
  assert.equal(f.changes, 0);
});

test('detail previous and next retain the opening filter sequence and unsaved edits', () => {
  const a = photo('a', true, 'match A'), b = photo('b', false, 'match B'), c = photo('c', true, 'match C');
  const f = fixture([a, b, c], { search: 'match' });
  assert.equal(f.controls.openPhotoEditor('a'), true);
  assert.deepEqual(Array.from(f.state.photoEditSequence), ['a', 'c']);
  a.enabled = false; a.name = 'edited title'; a.caption = { zh: '尚未保存的说明' }; f.state.dirty = true;
  assert.equal(f.controls.movePhotoEditor(-1), false, 'the first item does not wrap');
  assert.equal(f.controls.movePhotoEditor(1), true);
  assert.equal(f.state.selectedPhoto, 'c', 'excluded photos from another category do not enter the edit sequence');
  assert.equal(f.controls.movePhotoEditor(1), false, 'the last item does not wrap');
  assert.equal(f.controls.movePhotoEditor(-1), true, 'changing a title or inclusion does not remove the current editing reference');
  assert.equal(f.state.selectedPhoto, 'a');
  assert.equal(a.caption.zh, '尚未保存的说明');
  assert.equal(a.enabled, false);
  assert.equal(f.state.dirty, true);
  assert.equal(f.changes, 0, 'moving between items must not mark a fresh mutation or invoke publication');
});

test('detail navigation follows reordered references and skips deleted photos', () => {
  const a = photo('a', true), b = photo('b', true), c = photo('c', true);
  const f = fixture([a, b, c]); f.controls.openPhotoEditor('b');
  f.state.content.media = [c, b, a];
  assert.equal(f.controls.movePhotoEditor(-1), true);
  assert.equal(f.state.selectedPhoto, 'c', 'editor order follows the reordered list');
  f.state.content.media = [c, a];
  assert.equal(f.controls.movePhotoEditor(1), true);
  assert.equal(f.state.selectedPhoto, 'a', 'a removed photo cannot remain a destination');
  const nav = f.controls.photoDetailNavigation(a), buttons = all(nav).filter(node => node.tag === 'button');
  assert.equal(buttons[0].disabled, false); assert.equal(buttons[1].disabled, true);
  assert.match(text(nav), /2 \/ 2/);
  assert.equal(f.controls.openPhotoEditor('missing'), false);
});

test('empty categories explain classification while searches stay inside the selected category', () => {
  const f = fixture([photo('a', true, 'searchable')], { filter: 'draft', search: 'searchable' });
  assert.equal(f.controls.filteredPhotos().length, 0);
  const grid = element('div'); f.controls.renderPhotoGrid(grid);
  assert.match(text(grid), /这个分类没有匹配照片/);
  f.state.photoSearch = ''; f.controls.renderPhotoGrid(grid);
  assert.match(text(grid), /暂无未纳入相册的照片/);
});
