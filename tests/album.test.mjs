import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { ALBUM_MEDIA, buildAlbumPages, normalizeAlbumMedia, albumPhotoPose, createAlbum } from '../src/album.js';

class Element {
  constructor(tag, doc) {
    this.localName = tag; this.ownerDocument = doc; this.children = []; this.listeners = new Map(); this.attributes = new Map(); this.classes = new Set(); this.isConnected = true;
    this.style = { values: new Map(), setProperty(name, value) { this.values.set(name, String(value)); }, getPropertyValue(name) { return this.values.get(name) || ''; } };
    this.classList = { add: (...names) => names.forEach((name) => this.classes.add(name)), remove: (...names) => names.forEach((name) => this.classes.delete(name)), contains: (name) => this.classes.has(name), toggle: (name, enabled) => { if (enabled ?? !this.classes.has(name)) this.classes.add(name); else this.classes.delete(name); } };
    if (tag === 'dialog') this.open = false;
  }
  set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children.forEach((node) => { node.parentElement = null; node.isConnected = false; }); this.children = []; this.append(...nodes); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((node) => node !== this); this.parentElement = null; this.isConnected = false; }
  addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(handler); }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  emit(type, fields = {}) { const event = { target: this, type, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...fields }; for (const handler of this.listeners.get(type) || []) handler(event); return event; }
  all(predicate) { return this.children.flatMap((node) => [...(predicate(node) ? [node] : []), ...node.all(predicate)]); }
  find(className) { return this.all((node) => node.classList.contains(className))[0]; }
  findAll(className) { return this.all((node) => node.classList.contains(className)); }
  getBoundingClientRect() { return { left: 10, top: 20, width: 200, height: 180, right: 210, bottom: 200 }; }
  focus() { this.ownerDocument.activeElement = this; this.emit('focus'); }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit('close'); }
}

function fixture(t, options = {}) {
  const doc = new Element('document'); doc.ownerDocument = doc; doc.body = new Element('body', doc); doc.append(doc.body);
  const frames = new Map(); let serial = 0;
  doc.defaultView = { requestAnimationFrame(fn) { const id = ++serial; frames.set(id, fn); return id; }, cancelAnimationFrame(id) { frames.delete(id); },addEventListener(){},removeEventListener(){},getComputedStyle(){return {opacity:'1',transform:'none'};} };
  doc.createElement = (tag) => new Element(tag, doc);
  doc.querySelector = (selector) => selector === 'dialog[open]' ? doc.body.all((node) => node.localName === 'dialog' && node.open)[0] || null : null;
  const container = doc.createElement('div'); doc.body.append(container);
  const ready = []; const api = createAlbum({ container, onReady: (state) => ready.push(state), ...options });
  t.after(() => api.destroy());
  return { doc, container, api, ready, frames, get dialog() { return doc.body.find('album-player'); }, find: (name) => container.find(name), flush() { const batch = [...frames]; frames.clear(); batch.forEach(([, fn]) => fn(16)); } };
}
const sample = (id, takenAt, modelIds = ['shiratsume']) => ({ id, url: `./${id}.jpg`, thumbnail: `./${id}-small.jpg`, takenAt, modelIds, sourceKind: 'photo', alt: { zh: id, ja: id } });

test('the four supplied video stills remain undated and refer to real local assets', async () => {
  assert.equal(ALBUM_MEDIA.length, 4);
  for (const item of ALBUM_MEDIA) {
    assert.equal(item.sourceKind, 'video-still'); assert.equal(item.takenAt, null); assert.deepEqual(item.modelIds, ['shiratsume']);
    assert.ok(item.alt.zh && item.alt.ja); assert.ok((await stat(new URL('../' + item.url, import.meta.url))).size > 0);
  }
});

test('future content ingestion rejects executable URLs, duplicate IDs and impossible dates', () => {
  const normalized = normalizeAlbumMedia([
    sample('leap', '2024-02-29'), sample('bad-date', '2025-02-29'), sample('april', '2026-04-31'), sample('unknown', null),
    { id: 'evil', url: 'javascript:alert(1)' }, { id: 'data', url: 'data:image/svg+xml,<svg/>' }, sample('leap', '2024-01-01'),
  ]);
  assert.deepEqual(normalized.map((item) => item.id), ['leap', 'bad-date', 'april', 'unknown']);
  assert.equal(normalized[0].takenAt, '2024-02-29'); assert.ok(normalized.slice(1).every((item) => item.takenAt === null));
});

test('day month and year group existing dates while unknown dates stay explicitly unknown', () => {
  const media = [sample('a', '2026-05-02'), sample('b', '2026-05-01'), sample('c', '2025-10-14'), sample('d', null)];
  assert.deepEqual(buildAlbumPages(media).map((page) => page.key), ['2026-05-02', '2026-05-01', '2025-10-14', 'undated']);
  assert.deepEqual(buildAlbumPages(media, { view: 'month' }).map((page) => [page.key, page.items.length]), [['2026-05', 2], ['2025-10', 1], ['undated', 1]]);
  assert.deepEqual(buildAlbumPages(media, { view: 'year' }).map((page) => [page.key, page.items.length]), [['2026', 2], ['2025', 1], ['undated', 1]]);
});

test('model tags control filtering and pages never silently wrap or duplicate photos', () => {
  const media = Array.from({ length: 13 }, (_, index) => sample(String(index), null)); media.push(sample('another', null, ['another-model']));
  const pages = buildAlbumPages(media); assert.deepEqual(pages.map((page) => page.items.length), [6, 6, 1]);
  assert.equal(new Set(pages.flatMap((page) => page.items.map((item) => item.id))).size, 13);
  assert.equal(buildAlbumPages(media, { filter: 'all', view: 'year' }).flatMap((page) => page.items).length, 14);
  assert.equal(buildAlbumPages(media, { modelId: 'absent' }).length, 0);
});

test('paper placement is stable and stays within the requested ten-percent jitter', () => {
  assert.deepEqual(albumPhotoPose('same', 2), albumPhotoPose('same', 2)); assert.notDeepEqual(albumPhotoPose('same', 2), albumPhotoPose('same', 3));
  for (let index = 0; index < 300; index++) {
    const pose = albumPhotoPose(`photo-${index}`, index % 12);
    assert.ok(Math.abs(pose.x) <= 7 && Math.abs(pose.y) <= 7 && Math.abs(pose.rotation) <= 5.5); assert.ok(pose.depth >= 2 && pose.depth <= 9);
  }
});

test('album creates three entry-safe papers, truthful labels and disabled empty pagination', (t) => {
  const f = fixture(t); assert.equal(f.container.findAll('album-paper').length, 3); assert.equal(f.container.findAll('album-photo').length, 4);
  assert.equal(f.find('album-group-title').textContent, '日期待补充'); assert.match(f.find('album-source-note').textContent, /视频摘帧/);
  assert.equal(f.find('album-previous').disabled, true); assert.equal(f.find('album-next').disabled, true);
  assert.equal(f.find('album-photo').children[0].classList.contains('album-photo-card'), true);
  assert.deepEqual(f.api.state, { pageIndex: 0, pageCount: 1, view: 'day', filter: 'model', count: 4, playerOpen: false });
});

test('tabs switch scope and density, and locale updates keep content selection', (t) => {
  const f = fixture(t); f.find('album-filter-tab').emit('click'); assert.equal(f.api.state.filter, 'all'); assert.equal(f.api.state.count, 4);
  f.find('album-view').emit('click'); assert.equal(f.api.state.view, 'month'); assert.equal(f.find('album-desk').classList.contains('view-month'), true);
  const poses = f.container.findAll('album-photo-card').map((card) => card.style.getPropertyValue('--jitter-x'));
  f.api.setLanguage('ja'); assert.equal(f.find('album-group-title').textContent, '日付未設定'); assert.equal(f.find('album-filter-tab').textContent, 'すべての写真');
  assert.deepEqual(f.container.findAll('album-photo-card').map((card) => card.style.getPropertyValue('--jitter-x')), poses);
});

test('page changes clamp at boundaries and dispose old photo event listeners', (t) => {
  const f = fixture(t, { media: Array.from({ length: 13 }, (_, index) => sample(String(index), null)) });
  const old = f.find('album-photo-card'); assert.equal(f.api.goToPage(1), true); assert.equal(f.api.state.pageIndex, 1);
  assert.ok([...old.listeners.values()].every((listeners) => listeners.size === 0));
  assert.equal(f.api.goToPage(2), true); assert.equal(f.container.findAll('album-photo').length, 1); assert.equal(f.api.goToPage(3), false); assert.equal(f.api.goToPage(-1), false);
  f.api.setMedia([sample('new', null)]); assert.equal(f.api.state.pageIndex, 0); assert.equal(f.api.state.count, 1);
});

test('hover raises a card, pushes neighbors and clamps inspect tilt, then releases its frame', (t) => {
  const f = fixture(t); const cards = f.container.findAll('album-photo-card'); const wrappers = f.container.findAll('album-photo');
  cards[1].emit('pointerenter', { pointerType: 'mouse', clientX: 1000, clientY: -1000 });
  assert.equal(wrappers[1].classList.contains('is-inspected'), true); assert.equal(cards[0].style.getPropertyValue('--neighbor-shift'), '-8px'); assert.equal(cards[2].style.getPropertyValue('--neighbor-shift'), '8px');
  assert.equal(cards[1].style.getPropertyValue('--inspect-rx'), '5.00deg'); assert.equal(cards[1].style.getPropertyValue('--inspect-ry'), '5.00deg');
  cards[1].emit('pointermove', { pointerType: 'mouse', clientX: 20, clientY: 30 }); assert.equal(f.frames.size, 1);
  cards[1].emit('pointerleave'); assert.equal(f.frames.size, 0); assert.equal(wrappers[1].classList.contains('is-inspected'), false); assert.equal(cards[0].style.getPropertyValue('--neighbor-shift'), '0px');
});

test('touch and reduced-motion avoid card tilt and neighbor displacement', (t) => {
  const f = fixture(t, { reducedMotion: () => true }); const card = f.find('album-photo-card');
  card.emit('pointerenter', { pointerType: 'mouse', clientX: 20, clientY: 30 }); card.emit('pointermove', { pointerType: 'touch', clientX: 20, clientY: 30 });
  assert.equal(f.frames.size, 0); assert.equal(f.find('album-photo').classList.contains('is-inspected'), false);
});

test('photo player opens correct photo, cycles with keys and restores focus on close', (t) => {
  const f = fixture(t); const card = f.container.findAll('album-photo-card')[2]; card.focus(); card.emit('click');
  assert.equal(f.dialog.open, true); assert.equal(f.api.state.playerOpen, true); assert.equal(f.doc.body.classList.contains('modal-open'), true);
  assert.equal(f.dialog.find('album-player-image').src, './assets/frame-03.jpg');
  const event = f.dialog.emit('keydown', { key: 'ArrowRight' }); assert.equal(event.prevented, true); assert.equal(event.stopped, true);
  assert.equal(f.dialog.find('album-player-image').src, './assets/frame-04.jpg');
  f.dialog.find('album-player-next').emit('click'); assert.equal(f.dialog.find('album-player-image').src, './assets/frame-01.jpg');
  f.api.closePlayer(); assert.equal(f.doc.activeElement, card); assert.equal(f.doc.body.classList.contains('modal-open'), false);
});

test('disable, model switch and destruction close player and remove listeners', (t) => {
  const f = fixture(t); f.api.openPlayer(0); f.api.setEnabled(false);
  assert.equal(f.api.state.playerOpen, false); assert.equal(f.api.openPlayer(0), false); assert.equal(f.find('album-photo-card').disabled, true);
  f.api.setEnabled(true); f.api.setModel('unknown'); assert.equal(f.api.state.count, 0); assert.equal(f.find('album-empty').hidden, false);
  f.api.setFilter('all'); assert.equal(f.api.state.count, 4);
  f.api.destroy(); f.api.destroy(); assert.equal(f.container.children.length, 0); assert.equal(f.frames.size, 0); assert.equal(f.doc.body.find('album-player'), undefined);
  assert.ok([...f.doc.listeners.values()].every((listeners) => listeners.size === 0)); assert.equal(f.api.openPlayer(0), false);
});
