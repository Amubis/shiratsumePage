import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../admin/app.js', import.meta.url), 'utf8');
const handler = name => {
  const value = source.match(new RegExp(`^function ${name}\\([\\s\\S]*?^\\}`, 'm'))?.[0];
  assert.ok(value, `exercise the real ${name} control`);
  return value;
};
function element(tag, attributes = {}, ...children) {
  return { tag, ...attributes, children: children.flat(Infinity).filter(child => child !== null && child !== undefined) };
}
const nodes = root => [root, ...root.children.filter(child => typeof child === 'object').flatMap(nodes)];
const text = root => root.children.map(child => typeof child === 'object' ? text(child) : child).join('');
function fixture() {
  const storage = new Map();
  const state = {
    content: { media: [{ id: 'old-photo', enabled: true }, { id: 'new-photo', enabled: false }], journal: [{ id: 'old-note' }, { id: 'new-note' }] },
    photoFilter: 'all', photoCohort: 'all', journalCohort: 'all', photoSearch: '', dirty: false,
  };
  let renders = 0;
  const names = ['cohortIds', 'cohortSnapshot', 'persistCohort', 'restoreCohort', 'markCreated', 'matchesCohort', 'cohortBadge', 'cohortTabs', 'filteredPhotos'];
  const controls = runInNewContext(`${names.map(handler).join('\n')}\n({${names.join(',')}})`, {
    state, Set, COHORT_KEY: 'editor-session-additions',
    sessionStorage: { setItem(key, value) { storage.set(key, value); } },
    node: element, button: (label, onclick, kind, attributes) => element('button', { onclick, kind, ...attributes }, label),
    photoName: item => item.id, localizedValue: () => '', render() { renders++; },
    api() { throw new Error('Organizing labels must never save or publish content'); },
  });
  return { state, storage, controls, get renders() { return renders; } };
}

test('new photo and note cohorts are independent local labels and never change publication flags', () => {
  const f = fixture(), before = JSON.stringify(f.state.content);
  f.controls.markCreated('media', 'new-photo'); f.controls.markCreated('journal', 'new-note');
  assert.equal(f.controls.matchesCohort('media', f.state.content.media[0], 'existing'), true);
  assert.equal(f.controls.matchesCohort('media', f.state.content.media[1], 'new'), true);
  assert.equal(f.controls.matchesCohort('journal', f.state.content.journal[0], 'new'), false);
  assert.equal(f.controls.matchesCohort('journal', f.state.content.journal[1], 'new'), true);
  assert.equal(JSON.stringify(f.state.content), before);
  assert.equal(f.state.dirty, false);
  f.state.photoCohort = 'new';
  assert.deepEqual(f.controls.filteredPhotos().map(item => item.id), ['new-photo']);
  f.state.photoFilter = 'published';
  assert.equal(f.controls.filteredPhotos().length, 0, 'cohort filtering does not mix album inclusion categories');
});

test('new-content tabs carry counts and leave edited content intact when switching views', () => {
  const f = fixture(); f.controls.markCreated('media', 'new-photo');
  const tabs = f.controls.cohortTabs('media', f.state.content.media);
  const buttons = nodes(tabs).filter(node => node.tag === 'button');
  assert.deepEqual(buttons.map(text), ['全部2', '已有照片1', '本次新增1']);
  buttons[2].onclick();
  assert.equal(f.state.photoCohort, 'new'); assert.equal(f.renders, 1);
  assert.equal(f.state.dirty, false);
  assert.equal(text(f.controls.cohortBadge('media', f.state.content.media[1])), '本次新增');
  assert.equal(text(f.controls.cohortBadge('journal', f.state.content.journal[0])), '已有记录');
});

test('cohort identifiers survive editor reload through session metadata without being inserted into content', () => {
  const first = fixture(); first.controls.markCreated('media', 'new-photo'); first.controls.markCreated('journal', 'new-note');
  const stored = JSON.parse(first.storage.get('editor-session-additions'));
  assert.deepEqual(stored, { media: ['new-photo'], journal: ['new-note'] });
  const second = fixture(); second.controls.restoreCohort(stored);
  assert.equal(second.controls.matchesCohort('media', second.state.content.media[1], 'new'), true);
  assert.equal(second.controls.matchesCohort('journal', second.state.content.journal[1], 'new'), true);
  assert.equal('additions' in second.state.content, false);
  assert.equal('cohort' in second.state.content, false);
});
