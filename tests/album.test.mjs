import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { ALBUM_MEDIA, ALBUM_VIEWS, buildAlbumPages, normalizeAlbumMedia, albumPhotoPose, createAlbum } from '../src/album.js';

class Element {
  constructor(tag, doc) {
    this.localName = tag; this.ownerDocument = doc; this.children = []; this.listeners = new Map(); this.attributes = new Map(); this.classes = new Set(); this.isConnected = true;
    this.style = { values: new Map(), setProperty(name, value) { this.values.set(name, String(value)); }, getPropertyValue(name) { return this.values.get(name) || ''; } };
    this.classList = { add: (...names) => names.forEach((name) => this.classes.add(name)), remove: (...names) => names.forEach((name) => this.classes.delete(name)), contains: (name) => this.classes.has(name), toggle: (name, enabled) => { if (enabled ?? !this.classes.has(name)) this.classes.add(name); else this.classes.delete(name); } };
    if (doc?.animations) this.animate = (keyframes, options) => {
      let resolve, reject;
      const animation = { node: this, keyframes, options, cancelled: false, finished: new Promise((yes, no) => { resolve = yes; reject = no; }), finish: () => resolve(), cancel() { this.cancelled = true; reject(new Error('cancel')); } };
      doc.animations.push(animation); return animation;
    };
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
  querySelectorAll(selector) { return this.findAll(selector.slice(1)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { for (let current = this; current; current = current.parentElement) if (current.classList.contains(selector.slice(1))) return current; return null; }
  getBoundingClientRect() { return { left: 10, top: 20, width: 200, height: 180, right: 210, bottom: 200 }; }
  scrollIntoView(options) { this.scrollOptions = options; }
  focus() { this.ownerDocument.activeElement = this; this.emit('focus'); }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit('close'); }
}

function fixture(t, { animated = false, packing = null, ...options } = {}) {
  const doc = new Element('document'); doc.ownerDocument = doc; doc.body = new Element('body', doc); doc.append(doc.body);
  if (animated) doc.animations = [];
  const frames = new Map(); let serial = 0;
  doc.defaultView = { requestAnimationFrame(fn) { const id = ++serial; frames.set(id, fn); return id; }, cancelAnimationFrame(id) { frames.delete(id); },addEventListener(){},removeEventListener(){},getComputedStyle(){return {opacity:'1',transform:'none'};} };
  if (packing) Object.assign(doc.defaultView, { innerWidth: packing.width + 400, innerHeight: packing.height + 300 });
  doc.createElement = (tag) => {
    const node = new Element(tag, doc);
    if (packing) { node.clientWidth = packing.width; node.clientHeight = packing.height; }
    return node;
  };
  doc.querySelector = (selector) => selector === 'dialog[open]' ? doc.body.all((node) => node.localName === 'dialog' && node.open)[0] || null : null;
  const container = doc.createElement('div');
  if (animated) { const section = doc.createElement('section'); section.className = 'page-section is-current'; section.append(container); doc.body.append(section); }
  else doc.body.append(container);
  const ready = []; const api = createAlbum({ container, onReady: (state) => ready.push(state), ...options });
  t.after(() => api.destroy());
  return { doc, container, api, ready, frames, get dialog() { return doc.body.find('album-player'); }, find: (name) => container.find(name), flush() { const batch = [...frames]; frames.clear(); batch.forEach(([, fn]) => fn(16)); } };
}
const sample = (id, takenAt, modelIds = ['shiratsume']) => ({ id, url: `./${id}.jpg`, thumbnail: `./${id}-small.jpg`, takenAt, modelIds, sourceKind: 'photo', alt: { zh: id, ja: id } });
const microtick = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
async function settlePage(f) {
  for (let pass = 0; pass < 4; pass++) {
    f.doc.animations.filter(animation => !animation.cancelled).forEach(animation => animation.finish());
    await microtick();
    if (f.find('album-desk').getAttribute('data-page-motion') === 'idle') return;
  }
  assert.fail('photo page transition did not settle');
}
const dateAnimations = (f, part) => f.doc.animations.filter(animation => part ? animation.node.classList.contains(`album-date-${part}`) : ['mark', 'year', 'month'].some(part => animation.node.classList.contains(`album-date-${part}`)));

test('same-month continuation, sorting and filtering leave the visible date stationary', async t => {
  const media = [...Array.from({ length: 9 }, (_, index) => sample(`nov-${index}`, `2026-11-${String(index + 1).padStart(2, '0')}`)), sample('oct', '2026-10-01')];
  const f = fixture(t, { animated: true, media });
  f.api.goToPage(1); await settlePage(f);
  assert.equal(dateAnimations(f).length, 0);
  assert.equal(f.find('album-date-year').textContent, '2026');
  assert.equal(f.find('album-date-month').textContent, '11');
  f.api.setOrder('desc'); await settlePage(f); f.api.setFilter('model'); await settlePage(f);
  assert.equal(dateAnimations(f).length, 0);
  f.api.goToPage(2); await settlePage(f);
  assert.equal(dateAnimations(f).length, 2, 'a different month still exits and enters');
  assert.equal(dateAnimations(f, 'year').length, 0, 'the unchanged year stays still');
  assert.equal(f.find('album-date-month').textContent, '10');
});

test('annual continuation and undated continuation animate only when displayed date fields change', async t => {
  const annual = fixture(t, { animated: true, media: Array.from({ length: 26 }, (_, index) => sample(`year-${index}`, `2026-${index < 13 ? '11' : '10'}-${String(index % 13 + 1).padStart(2, '0')}`)) });
  annual.api.setView('year'); await settlePage(annual);
  assert.equal(dateAnimations(annual).length, 1, 'only the removed month exits');
  assert.equal(dateAnimations(annual, 'year').length, 0);
  annual.api.goToPage(1); await settlePage(annual); annual.api.goToPage(2); await settlePage(annual);
  assert.equal(dateAnimations(annual).length, 1, 'same-year pages do not reanimate the year');
  annual.api.setView('month'); await settlePage(annual);
  assert.equal(dateAnimations(annual).length, 2, 'only the reappearing month enters');
  assert.equal(dateAnimations(annual, 'year').length, 0);
  const undated = fixture(t, { animated: true, media: Array.from({ length: 9 }, (_, index) => sample(`unknown-${index}`, null, [])) });
  undated.api.goToPage(1); await settlePage(undated); undated.api.setView('year'); await settlePage(undated); undated.api.setFilter('model'); await settlePage(undated);
  assert.equal(dateAnimations(undated).length, 0, 'None stays stationary across pages, views and an empty filter');
  assert.equal(undated.find('album-date-year').textContent, 'None');
});

test('changing only the year leaves the identical displayed month stationary', async t => {
  const f = fixture(t, { animated: true, media: [sample('nov-new', '2026-11-01'), sample('nov-old', '2025-11-01')] });
  f.api.goToPage(1); await settlePage(f);
  assert.equal(dateAnimations(f, 'year').length, 2);
  assert.equal(dateAnimations(f, 'month').length, 0);
  assert.equal(f.find('album-date-year').textContent, '2025');
  assert.equal(f.find('album-date-month').textContent, '11');
});

test('rapid page requests compare with the date still rendered instead of the pending page index', async t => {
  const media = [...Array.from({ length: 9 }, (_, index) => sample(`nov-fast-${index}`, `2026-11-${String(index + 1).padStart(2, '0')}`)), sample('oct-fast', '2026-10-01')];
  const f = fixture(t, { animated: true, media });
  f.api.goToPage(2);
  assert.equal(dateAnimations(f).length, 1);
  f.api.goToPage(1);
  assert.ok(dateAnimations(f).every(animation => animation.cancelled), 'the cancelled October exit does not affect the November continuation');
  await settlePage(f);
  assert.equal(dateAnimations(f).length, 1, 'the latest same-month request adds no date animation');
  assert.equal(f.find('album-date-month').textContent, '11');
  f.api.goToPage(2);
  f.doc.animations.filter(animation => !animation.cancelled).forEach(animation => animation.finish());
  await microtick();
  assert.equal(f.find('album-date-month').textContent, '10', 'the new date has committed before its entrance finishes');
  f.api.goToPage(0); await settlePage(f);
  assert.equal(f.find('album-date-month').textContent, '11');
  assert.equal(dateAnimations(f).filter(animation => !animation.cancelled).length, 0);
});

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

test('month and year group existing dates while unknown dates stay explicitly unknown', () => {
  const media = [sample('a', '2026-05-02'), sample('b', '2026-05-01'), sample('c', '2025-10-14'), sample('d', null)];
  assert.deepEqual(buildAlbumPages(media).map((page) => page.key), ['2026-05', '2025-10', 'undated']);
  assert.deepEqual(ALBUM_VIEWS, ['month', 'year']);
  assert.deepEqual(buildAlbumPages(media, { view: 'month' }).map((page) => [page.key, page.items.length]), [['2026-05', 2], ['2025-10', 1], ['undated', 1]]);
  assert.deepEqual(buildAlbumPages(media, { view: 'year' }).map((page) => [page.key, page.items.length]), [['2026', 2], ['2025', 1], ['undated', 1]]);
});

test('an inline description edit keeps the open photograph, page and ordering in place', t => {
  const media = Array.from({ length: 17 }, (_, index) => ({ ...sample(`inline-${index}`, null), caption: { zh: `说明 ${index}` } }));
  const f = fixture(t, { media });
  f.api.setOrder('asc'); f.api.goToPage(1); f.api.openPlayer('inline-9');
  const dialog = f.dialog, focus = f.doc.activeElement;
  f.api.setMedia(media.map(item => item.id === 'inline-9' ? { ...item, caption: { zh: '修改后的照片说明' } } : item), { preservePlayer: true });
  assert.equal(f.dialog, dialog);
  assert.equal(f.api.state.playerOpen, true);
  assert.equal(f.api.state.pageIndex, 1);
  assert.equal(f.api.state.order, 'asc');
  assert.equal(f.doc.activeElement, focus, 'saving a field does not steal focus from the editor');
  assert.equal(dialog.getAttribute('data-photo-id'), 'inline-9');
  assert.equal(dialog.find('album-player-description').textContent, '修改后的照片说明');
  assert.equal(f.ready.at(-1).reason, 'inline-edit');
});

test('an inline refresh safely closes a photograph that is no longer in the selected album', t => {
  const f = fixture(t, { media: [sample('kept', null), sample('removed', null)] });
  f.api.openPlayer('removed');
  f.api.setMedia([sample('kept', null)], { preservePlayer: true });
  assert.equal(f.api.state.playerOpen, false);
  assert.equal(f.api.state.count, 1);
  assert.equal(f.api.state.pageIndex, 0);
});

test('loaded portrait dimensions repack one shared row and pending layout work is released on destruction', t => {
  const f = fixture(t, { media: Array.from({ length: 5 }, (_, index) => sample(`portrait-${index}`, null)) });
  f.doc.defaultView.innerWidth = 1440;
  const grid = f.find('album-photo-grid'); grid.clientWidth = 1000; grid.clientHeight = 580;
  const images = f.container.findAll('album-photo-image');
  for (const image of images) { image.naturalWidth = 576; image.naturalHeight = 1024; image.emit('load'); }
  assert.equal(f.frames.size, 1, 'multiple completed images should share one layout update');
  f.flush();
  assert.equal(grid.getAttribute('data-layout-rows'), '1');
  assert.equal(new Set(f.container.findAll('album-photo').map(node => node.style.getPropertyValue('top'))).size, 1);
  for (const photo of f.container.findAll('album-photo')) assert.ok(parseFloat(photo.style.getPropertyValue('height')) > 290);
  images[0].naturalHeight = 2048; images[0].emit('load');
  assert.equal(f.frames.size, 1);
  f.api.destroy();
  assert.equal(f.frames.size, 0);
});

test('new page rectangles settle before entrance while later image-driven resizing remains animated', t => {
  const f = fixture(t, { media: Array.from({ length: 9 }, (_, index) => sample(`layout-${index}`, null)) });
  const grid = f.find('album-photo-grid'), measure = grid.getBoundingClientRect.bind(grid), measurements = [];
  grid.getBoundingClientRect = () => {
    measurements.push({ initial: grid.classList.contains('is-layout-initializing'), widths: grid.findAll('album-photo').map(node => node.style.getPropertyValue('width')) });
    return measure();
  };
  f.api.goToPage(1);
  assert.equal(measurements.length, 2, 'read the stage, then commit its new print rectangles before enabling transitions');
  assert.ok(measurements.every(entry => entry.initial), 'new nodes cannot animate from the full-sheet fallback dimensions');
  assert.ok(measurements.at(-1).widths.every(value => parseFloat(value) > 0));
  assert.equal(grid.classList.contains('is-layout-initializing'), false);
  measurements.length = 0;
  const image = f.find('album-photo-image'); image.naturalWidth = 9; image.naturalHeight = 16; image.emit('load'); f.flush();
  assert.ok(measurements.length > 0 && measurements.every(entry => !entry.initial), 'ordinary later repacking keeps its existing resize transition');
});

test('model tags control filtering and pages never silently wrap or duplicate photos', () => {
  const media = Array.from({ length: 13 }, (_, index) => sample(String(index), null)); media.push(sample('another', null, ['another-model']));
  const pages = buildAlbumPages(media, { filter: 'model' }); assert.deepEqual(pages.map((page) => page.items.length), [8, 5]);
  assert.equal(new Set(pages.flatMap((page) => page.items.map((item) => item.id))).size, 13);
  assert.equal(buildAlbumPages(media, { filter: 'all', view: 'year' }).flatMap((page) => page.items).length, 14);
  assert.equal(buildAlbumPages(media, { modelId: 'absent', filter: 'model' }).length, 0);
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
  assert.equal(f.find('album-group-title'), undefined); assert.match(f.find('album-source-note').textContent, /视频摘帧/);
  assert.equal(f.find('album-previous').disabled, true); assert.equal(f.find('album-next').disabled, true);
  assert.equal(f.find('album-photo').children[0].classList.contains('album-photo-card'), true);
  assert.equal(f.find('album-cover').parentElement,f.find('album-cover-controls').parentElement);
  assert.equal(f.find('album-filter-tab').parentElement,f.find('album-sort-tab').parentElement);
  assert.equal(f.find('album-cover-unit').classList.contains('album-cover-unit'),true);
  assert.equal(f.find('rule-top'),undefined);
  assert.deepEqual(f.api.state, { pageIndex: 0, pageCount: 1, view: 'month', filter: 'all', order: 'desc', count: 4, playerOpen: false });
});

test('tabs switch scope and density, and locale updates keep content selection', (t) => {
  const f = fixture(t); f.find('album-filter-tab').emit('click'); assert.equal(f.api.state.filter, 'model'); assert.equal(f.api.state.count, 4);
  assert.equal(f.find('album-view').textContent, '更小视图');
  f.find('album-view').emit('click'); assert.equal(f.api.state.view, 'year'); assert.equal(f.find('album-desk').classList.contains('view-year'), true);
  assert.equal(f.find('album-view').textContent, '更大视图');
  const poses = f.container.findAll('album-photo-card').map((card) => card.style.getPropertyValue('--jitter-x'));
  f.api.setLanguage('ja'); assert.equal(f.find('album-date-mark').getAttribute('aria-label'), '日付未設定'); assert.equal(f.find('album-filter-tab').textContent, 'このモデル');
  assert.deepEqual(f.container.findAll('album-photo-card').map((card) => card.style.getPropertyValue('--jitter-x')), poses);
});

test('the connected cover tabs stay underneath the cover paper', async () => {
  const css = await readFile(new URL('../src/album-page.css', import.meta.url), 'utf8');
  const controls = css.match(/\.primary-album \.album-cover-controls\s*\{([^}]+)\}/)?.[1];
  const cover = css.match(/\.primary-album \.album-cover-unit \.album-cover\s*\{([^}]+)\}/)?.[1];
  const layer = rule => Number(rule?.match(/z-index\s*:\s*(\d+)/)?.[1]);
  assert.ok(Number.isFinite(layer(controls)) && layer(controls) < layer(cover), 'paper must mask the tabs\' upper edges');
});

test('page changes clamp at boundaries and dispose old photo event listeners', (t) => {
  const f = fixture(t, { media: Array.from({ length: 17 }, (_, index) => sample(String(index), null)) });
  const old = f.find('album-photo-card'); assert.equal(f.api.goToPage(1), true); assert.equal(f.api.state.pageIndex, 1);
  assert.ok([...old.listeners.values()].every((listeners) => listeners.size === 0));
  assert.equal(f.api.goToPage(2), true); assert.equal(f.container.findAll('album-photo').length, 1); assert.equal(f.api.goToPage(3), false); assert.equal(f.api.goToPage(-1), false);
  f.api.setMedia([sample('new', null)]); assert.equal(f.api.state.pageIndex, 0); assert.equal(f.api.state.count, 1);
});

test('hover raises a card, pushes neighbors and clamps inspect tilt, then releases its frame', (t) => {
  const f = fixture(t); const cards = f.container.findAll('album-photo-card'); const wrappers = f.container.findAll('album-photo');
  wrappers[1].emit('pointerenter', { pointerType: 'mouse', clientX: 1000, clientY: -1000 });
  assert.equal(wrappers[1].classList.contains('is-inspected'), true); assert.ok(parseFloat(cards[0].style.getPropertyValue('--neighbor-x')) < 0); assert.ok(cards.some((card, index) => index !== 1 && parseFloat(card.style.getPropertyValue('--neighbor-y')) !== 0));
  assert.equal(cards[1].style.getPropertyValue('--inspect-rx'), '5.00deg'); assert.equal(cards[1].style.getPropertyValue('--inspect-ry'), '5.00deg');
  wrappers[1].emit('pointermove', { pointerType: 'mouse', clientX: 20, clientY: 30 }); assert.equal(f.frames.size, 1);
  wrappers[1].emit('pointerleave'); assert.equal(f.frames.size, 0); assert.equal(wrappers[1].classList.contains('is-inspected'), false); assert.equal(cards[0].style.getPropertyValue('--neighbor-x'), '0px'); assert.equal(cards[0].style.getPropertyValue('--neighbor-y'), '0px');
});

test('touch and reduced-motion avoid card tilt and neighbor displacement', (t) => {
  const f = fixture(t, { reducedMotion: () => true }); const wrapper = f.find('album-photo');
  wrapper.emit('pointerenter', { pointerType: 'mouse', clientX: 20, clientY: 30 }); wrapper.emit('pointermove', { pointerType: 'touch', clientX: 20, clientY: 30 });
  assert.equal(f.frames.size, 0); assert.equal(f.find('album-photo').classList.contains('is-inspected'), false);
});

test('photo player opens correct photo, cycles with keys and restores focus on close', (t) => {
  const f = fixture(t); const card = f.container.findAll('album-photo-card')[2]; card.focus(); card.emit('click');
  assert.equal(f.dialog.open, true); assert.equal(f.api.state.playerOpen, true); assert.equal(f.doc.body.classList.contains('modal-open'), true);
  assert.equal(f.dialog.find('album-player-image').src, './assets/frame-03.jpg');
  const event = f.dialog.emit('keydown', { key: 'ArrowRight' }); assert.equal(event.prevented, true); assert.equal(event.stopped, true);
  assert.equal(f.dialog.find('album-player-image').src, './assets/frame-04.jpg');
  f.dialog.find('album-player-next').emit('click'); assert.equal(f.dialog.find('album-player-image').src, './assets/frame-01.jpg');
  f.api.closePlayer(); assert.equal(f.doc.activeElement === f.find('album-photo-card'), true); assert.equal(f.doc.body.classList.contains('modal-open'), false);
});

test('disable, model switch and destruction close player and remove listeners', (t) => {
  const f = fixture(t); f.api.openPlayer(0); f.api.setEnabled(false);
  assert.equal(f.api.state.playerOpen, false); assert.equal(f.api.openPlayer(0), false); assert.equal(f.find('album-photo-card').disabled, true);
  f.api.setEnabled(true); f.api.setModel('unknown'); assert.equal(f.api.state.count, 4); f.api.setFilter('model'); assert.equal(f.api.state.count, 0); assert.equal(f.find('album-empty').hidden, false);
  f.api.setFilter('all'); assert.equal(f.api.state.count, 4);
  f.api.destroy(); f.api.destroy(); assert.equal(f.container.children.length, 0); assert.equal(f.frames.size, 0); assert.equal(f.doc.body.find('album-player'), undefined);
  assert.ok([...f.doc.listeners.values()].every((listeners) => listeners.size === 0)); assert.equal(f.api.openPlayer(0), false);
});

test('reapplying the same theme state keeps the current page, prints, and player', (t) => {
  const media = Array.from({ length: 9 }, (_, index) => sample(`same-theme-${index}`, null));
  const f = fixture(t, { media });
  f.api.goToPage(1); f.api.openPlayer(0);
  const print = f.find('album-photo');
  const readyCount = f.ready.length;
  f.api.setModel('shiratsume'); f.api.setEnabled(true); f.api.setLanguage('zh');
  assert.equal(f.api.state.pageIndex, 1);
  assert.equal(f.api.state.playerOpen, true);
  assert.equal(f.find('album-photo'), print);
  assert.equal(f.ready.length, readyCount);
});

test('month boundaries never mix short months and overflow continues the same calendar group',()=>{
 const media=[...Array.from({length:10},(_,i)=>sample(`nov${i}`,`2026-11-${String(i+1).padStart(2,'0')}`)),sample('oct','2026-10-01'),sample('old','2025-12-31')];
 assert.deepEqual(buildAlbumPages(media).map(p=>[p.key,p.items.length]),[['2026-11',8],['2026-11',2],['2026-10',1],['2025-12',1]]);
 assert.deepEqual(buildAlbumPages(media,{view:'year'}).map(p=>[p.key,p.items.length]),[['2026',11],['2025',1]]);
});
test('heading uses the other language, page count and truthful large calendar labels',t=>{
 const f=fixture(t,{media:[sample('a','2026-11-03')]});
 assert.equal(f.find('album-cover-note').textContent,'超アルバム');
 assert.equal(f.find('album-page-status').textContent,'01 / 01');
 assert.equal(f.find('album-date-year').textContent,'2026');assert.equal(f.find('album-date-month').textContent,'11');
 f.api.setView('year');assert.equal(f.find('album-date-month').hidden,true);
 f.api.setLanguage('ja');assert.equal(f.find('album-cover-note').textContent,'超级相册');
 assert.equal(f.find('album-title').textContent,'超アルバム');
});

test('missing and empty capture dates use None without inventing a calendar label', t => {
 const f = fixture(t);
 assert.equal(f.find('album-date-year').textContent, 'None');
 assert.equal(f.find('album-date-month').hidden, true);
 assert.equal(f.find('album-date-mark').getAttribute('aria-label'), '日期待补充');
 f.api.setLanguage('ja');
 assert.equal(f.find('album-date-year').textContent, 'None');
 f.api.setMedia([]);
 assert.equal(f.find('album-date-year').textContent, 'None');
 assert.equal(f.find('album-date-mark').getAttribute('aria-label'), '表示する写真がありません');
});

test('all photos is the initial scope, including unclassified and other-model records', t => {
 const f = fixture(t, { media: [sample('unclassified', null, []), sample('shiratsume', null), sample('milfy', null, ['milfy'])] });
 assert.equal(f.api.state.filter, 'all'); assert.equal(f.api.state.count, 3);
 assert.equal(f.find('album-filter-tab').textContent, '全部照片');
 assert.equal(f.find('album-group-count').parentElement, f.find('album-page-meta'));
 f.find('album-filter-tab').emit('click'); assert.equal(f.api.state.count, 1);
 assert.equal(f.find('album-photo-image').src, './shiratsume-small.jpg');
 f.api.setModel('milfy'); assert.equal(f.api.state.count, 1);
 assert.equal(f.find('album-photo-image').src, './milfy-small.jpg');
 f.api.setFilter('all'); f.api.setModel('unknown'); assert.equal(f.api.state.count, 3);
});

test('chronological order sorts groups and their overflow without mixing months or moving undated photos first', () => {
 const media = [...Array.from({ length: 10 }, (_, i) => sample(`nov${i}`, `2026-11-${String(i + 1).padStart(2, '0')}`)), sample('undated', null), sample('oct', '2026-10-04'), sample('old', '2025-12-31')];
 const before = JSON.stringify(media);
 const pages = buildAlbumPages(media, { order: 'asc' });
 assert.deepEqual(pages.map(page => [page.key, page.items.length]), [['2025-12', 1], ['2026-10', 1], ['2026-11', 8], ['2026-11', 2], ['undated', 1]]);
 assert.deepEqual(pages[2].items.map(item => item.id), Array.from({ length: 8 }, (_, i) => `nov${i}`));
 assert.deepEqual(pages[3].items.map(item => item.id), ['nov8', 'nov9']);
 assert.equal(buildAlbumPages(media, { order: 'desc' }).at(-1).key, 'undated');
 assert.deepEqual(buildAlbumPages(media, { view: 'year', order: 'asc' }).map(page => page.key), ['2025', '2026', 'undated']);
 assert.equal(JSON.stringify(media), before);
});

test('position rail changes pages on release, clamps its target and stays in sync after sorting and localization', t => {
 const f = fixture(t, { media: [sample('new', '2026-11-02'), sample('old', '2025-06-03'), sample('undated', null, [])] });
 const rail = f.find('album-page-position'); const sort = f.find('album-sort');
 assert.equal(rail.type, 'range'); assert.equal(rail.max, '3'); assert.equal(rail.disabled, false);
 rail.value = '3'; rail.emit('input');
 assert.equal(f.api.state.pageIndex, 0, 'dragging previews the rail without repeatedly replacing photos');
 assert.equal(rail.getAttribute('aria-valuetext'), '03 / 03');
 assert.equal(f.find('album-page-rail').style.getPropertyValue('--album-page-position'), '100%');
 assert.equal(f.find('album-page-rail').style.getPropertyValue('--album-page-offset'), '26px');
 rail.emit('change'); assert.equal(f.api.state.pageIndex, 2); assert.equal(f.find('album-date-year').textContent, 'None');
 rail.value = '99'; rail.emit('change'); assert.equal(f.api.state.pageIndex, 2);
 assert.equal(sort.localName, 'button'); assert.equal(sort.getAttribute('aria-pressed'), 'false');
 sort.emit('click');
 assert.equal(f.api.state.order, 'asc'); assert.equal(f.api.state.pageIndex, 0); assert.equal(f.api.state.filter, 'all');
 assert.equal(f.find('album-date-year').textContent, '2025'); assert.equal(rail.value, '1');
 f.api.setLanguage('ja'); assert.equal(sort.getAttribute('aria-pressed'), 'true'); assert.equal(sort.textContent, '古い順');
 assert.equal(rail.getAttribute('aria-label'), 'アルバムのページ位置');
 assert.equal(f.api.setOrder('random'), false); assert.equal(f.api.state.order, 'asc');
 f.api.setEnabled(false); assert.equal(rail.disabled, true); assert.equal(sort.disabled, true);
});

test('empty and single-page albums expose truthful positions without an unusable page rail', t => {
 const f = fixture(t, { media: [] }); const rail = f.find('album-page-position');
 assert.equal(rail.disabled, true); assert.equal(rail.getAttribute('aria-valuetext'), '00 / 00');
 f.api.setMedia([sample('only', null)]);
 assert.equal(rail.disabled, true); assert.equal(rail.getAttribute('aria-valuetext'), '01 / 01');
});

test('player description sits above its date metadata and the photo aspect updates without stale closures', t => {
 const f = fixture(t, { media: [{ ...sample('portrait', '2025-03-12', []), width: 1200, height: 1800, caption: { zh: '梦开始的地方', ja: '夢の始まり' }, worldName: 'A quiet world' }] });
 f.api.openPlayer(0);
 const description = f.dialog.find('album-player-description'); const metadata = f.dialog.find('album-player-caption'); const image = f.dialog.find('album-player-image');
 assert.equal(description.textContent, '梦开始的地方'); assert.equal(description.hidden, false);
 assert.equal(metadata.textContent, '01 / 01 · 2025 / 03 / 12 · A quiet world');
 assert.deepEqual(f.dialog.find('album-player-figure').children, [image, description, metadata]);
 assert.equal(f.dialog.style.getPropertyValue('--player-image-aspect'), '0.666667');
 assert.equal(f.dialog.getAttribute('data-photo-orientation'), 'portrait');
 image.naturalWidth = 3840; image.naturalHeight = 2160; image.emit('load');
 assert.equal(f.dialog.style.getPropertyValue('--player-image-aspect'), '1.777778');
 image.naturalWidth = 0; image.naturalHeight = 0; image.emit('load');
 assert.equal(f.dialog.style.getPropertyValue('--player-image-aspect'), '1.777778');
 f.api.setLanguage('ja'); assert.equal(description.textContent, '夢の始まり');
});

test('player navigation lives outside the resizable photograph stage', t => {
 const f = fixture(t, { media: [sample('wide', null), sample('tall', null)] });
 f.api.openPlayer(0);
 const stage = f.dialog.find('album-player-stage');
 const previous = f.dialog.find('album-player-previous'), next = f.dialog.find('album-player-next');
 assert.equal(previous.parentElement, f.dialog);
 assert.equal(next.parentElement, f.dialog);
 assert.deepEqual(stage.children, [f.dialog.find('album-player-figure')]);
 next.emit('click'); assert.equal(f.dialog.getAttribute('data-photo-id'), 'tall');
 next.emit('click'); assert.equal(f.dialog.getAttribute('data-photo-id'), 'wide');
});

test('closing a photo reached on another page quietly returns to its page, card and focus', t => {
 const media = Array.from({ length: 17 }, (_, i) => sample(`p${i}`, null, []));
 const before = JSON.stringify(media); const f = fixture(t, { media });
 f.find('album-photo-card').focus(); f.api.openPlayer(0);
 for (let i = 0; i < 9; i++) f.dialog.find('album-player-next').emit('click');
 assert.equal(f.dialog.find('album-player-image').src, './p9.jpg');
 assert.equal(f.api.state.pageIndex, 0, 'the paper stays covered until closing starts');
 f.api.closePlayer();
 assert.equal(f.api.state.pageIndex, 1); assert.equal(f.api.state.playerOpen, false);
 assert.equal(f.find('album-page-status').textContent, '02 / 03');
 const target = f.container.findAll('album-photo-card')[1];
 assert.equal(target.children[0].src, './p9-small.jpg');
 assert.equal(target.children[0].loading, 'eager');
 assert.equal(f.doc.activeElement === target, true);
 assert.deepEqual(target.scrollOptions, { block: 'nearest', inline: 'nearest', behavior: 'instant' });
 assert.equal(f.ready.filter(event => event.reason === 'player-return').length, 1);
 assert.equal(f.find('album-desk').getAttribute('data-page-motion'), 'idle');
 assert.equal(JSON.stringify(media), before);
});

test('immediate player shutdown never navigates to a viewed photo or replays return preparation', t => {
 const f = fixture(t, { media: Array.from({ length: 10 }, (_, i) => sample(`p${i}`, null)) });
 f.api.openPlayer(0);
 for (let i = 0; i < 9; i++) f.dialog.find('album-player-next').emit('click');
 f.api.setEnabled(false);
 assert.equal(f.api.state.pageIndex, 0); assert.equal(f.api.state.playerOpen, false);
 assert.equal(f.ready.some(event => event.reason === 'player-return'), false);
 f.api.setEnabled(true); f.api.openPlayer(0);
 f.api.setMedia([sample('replacement', null)]);
 assert.equal(f.api.state.pageIndex, 0); assert.equal(f.api.state.playerOpen, false);
 assert.equal(f.ready.some(event => event.reason === 'player-return'), false);
});

test('a selected photo excluded from the current album falls back to closing without changing the page', t => {
 const f = fixture(t, { media: [sample('shiratsume', null), sample('milfy', null, ['milfy'])] });
 f.api.openPlayer('milfy'); f.api.setFilter('model');
 const events = f.ready.length; f.api.closePlayer();
 assert.equal(f.api.state.pageIndex, 0); assert.equal(f.api.state.playerOpen, false);
 assert.equal(f.api.state.count, 1); assert.equal(f.ready.length, events);
});

test('Escape follows the selected photograph back to its page before closing', t => {
 const f = fixture(t, { media: Array.from({ length: 9 }, (_, i) => sample(`p${i}`, null)) });
 f.api.openPlayer(0);
 for (let i = 0; i < 8; i++) f.dialog.find('album-player-next').emit('click');
 const cancel = f.dialog.emit('cancel');
 assert.equal(cancel.prevented, true); assert.equal(f.api.state.playerOpen, false);
 assert.equal(f.api.state.pageIndex, 1);
 assert.equal(f.doc.activeElement === f.find('album-photo-card'), true);
 assert.equal(f.find('album-photo-image').src, './p8-small.jpg');
});


test('annual density caps every page at twelve and never fills a short year from another year', () => {
 const media = [...Array.from({ length: 26 }, (_, index) => sample(`year-${index}`, `2026-${String(index % 12 + 1).padStart(2, '0')}-01`)), sample('old-year', '2025-12-31'), sample('unknown-year', null)];
 const pages = buildAlbumPages(media, { view: 'year' });
 assert.deepEqual(pages.map(page => [page.key, page.items.length]), [['2026', 12], ['2026', 12], ['2026', 2], ['2025', 1], ['undated', 1]]);
 assert.equal(new Set(pages.flatMap(page => page.items.map(item => item.id))).size, media.length);
});

test('two density actions keep the new labels when existing managed copy has legacy group labels', t => {
 const f = fixture(t, { copy: { zh: { month: '按月', year: '按年', day: '按日', view: '切换照片分组密度' }, ja: { month: '月ごと', year: '年ごと', day: '日ごと', view: '写真のグループと密度を切り替え' } } });
 const mode = f.find('album-view');
 assert.equal(mode.textContent, '更小视图');
 assert.equal(f.api.state.view, 'month');
 assert.equal(f.api.setView('day'), false);
 mode.emit('click'); assert.equal(f.api.state.view, 'year'); assert.equal(mode.textContent, '更大视图');
 f.api.setLanguage('ja'); assert.equal(mode.textContent, '大きく表示');
 mode.emit('click'); assert.equal(f.api.state.view, 'month'); assert.equal(mode.textContent, '小さく表示');
 mode.emit('click'); assert.equal(f.api.state.view, 'year');
});

test('chronological sticker cycles directly like the model filter without a dropdown', t => {
 const f = fixture(t, { media: [sample('new', '2026-11-03'), sample('old', '2025-01-01')] });
 const sort = f.find('album-sort');
 assert.equal(sort.localName, 'button');
 assert.equal(sort.classList.contains('album-sort-tab'), true);
 assert.equal(sort.getAttribute('data-language-text'), '', 'the real sort control declares its translated text boundary');
 assert.equal(f.find('album-filter-tab').getAttribute('data-language-text'), '');
 assert.equal(f.find('album-empty').getAttribute('data-language-text'), '');
 assert.equal(sort.parentElement, f.find('album-filter-tab').parentElement);
 assert.equal(f.container.all(node => node.localName === 'select' || node.localName === 'option').length, 0);
 assert.equal(sort.textContent, '由新到旧');
 sort.emit('click'); assert.equal(f.api.state.order, 'asc'); assert.equal(sort.getAttribute('aria-pressed'), 'true'); assert.equal(sort.textContent, '由旧到新');
 sort.emit('click'); assert.equal(f.api.state.order, 'desc'); assert.equal(sort.getAttribute('aria-pressed'), 'false');
 f.api.setEnabled(false); sort.emit('click'); assert.equal(f.api.state.order, 'desc');
});

function albumLikesFixture(initial = {}) {
  const counts = { ...initial }, liked = new Set(), listeners = new Set();
  const notify = (type, photoId = null) => { for (const listener of listeners) listener({ type, photoId, likes: { ...counts } }); };
  return {
    listeners, enabled: true, snapshot: () => ({ ...counts }),
    get: photoId => ({ photoId, count: counts[photoId] || 0, liked: liked.has(photoId), pending: false, loaded: true, canLike: true, error: '' }),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async toggle(photoId) {
      if (liked.has(photoId)) { liked.delete(photoId); counts[photoId]--; }
      else { liked.add(photoId); counts[photoId] = (counts[photoId] || 0) + 1; }
      notify('toggle', photoId);
    },
    refresh(next) { Object.assign(counts, next); notify('refresh'); },
  };
}

test('liking a photo updates its card and open viewer without moving or replacing the prints', async t => {
  const likesService = albumLikesFixture({ one: 3 });
  const f = fixture(t, { likesService, media: [sample('one', null), sample('two', null)] });
  const wrappers = f.container.findAll('album-photo');
  const rectangles = wrappers.map(node => [...node.style.values]);
  const cardLike = wrappers[0].find('photo-like');
  assert.equal(cardLike.parentElement.classList.contains('album-photo-footer'), true, 'like belongs in the reserved paper footer');
  assert.equal(cardLike.parentElement.parentElement === wrappers[0].find('album-photo-card').parentElement, true, 'the independent buttons share one transform surface');
  const card = wrappers[0].find('album-photo-card'), print = cardLike.parentElement.parentElement;
  wrappers[0].emit('pointerenter', { pointerType: 'mouse', clientX: 140, clientY: 70 });
  assert.equal(print.style.getPropertyValue('--inspect-rx'), card.style.getPropertyValue('--inspect-rx'), 'the complete paper tilts with its attached like control');
  assert.equal(print.style.getPropertyValue('--inspect-lift'), '-12px');
  wrappers[0].emit('pointerleave');
  assert.equal(print.style.getPropertyValue('--inspect-lift'), '0px');
  assert.equal(cardLike.find('photo-like-count').textContent, '3');
  f.api.openPlayer('one');
  const viewerLike = f.dialog.find('photo-like');
  const ready = f.ready.length;
  viewerLike.emit('click'); await microtick();
  assert.equal(viewerLike.getAttribute('aria-pressed'), 'true');
  assert.equal(cardLike.getAttribute('aria-pressed'), 'true');
  assert.equal(cardLike.find('photo-like-count').textContent, '4');
  assert.equal(viewerLike.find('photo-like-count').textContent, '4');
  assert.equal(f.api.state.playerOpen, true);
  assert.equal(f.ready.length, ready, 'an acknowledged own vote does not redraw the paper');
  assert.deepEqual(f.container.findAll('album-photo'), wrappers);
  assert.deepEqual(wrappers.map(node => [...node.style.values]), rectangles);
  f.api.setLanguage('ja');
  assert.equal(f.dialog.find('photo-like').title, 'いいねを取り消す');
  assert.equal(f.container.findAll('photo-like')[0].title, 'いいねを取り消す');
  f.api.destroy(); assert.equal(likesService.listeners.size, 0, 'card and viewer subscriptions are released');
});

test('a like hold keeps the photo raised and tilted until the press ends', t => {
  const likesService = { ...albumLikesFixture(), boost: async () => {} };
  const f = fixture(t, { likesService });
  const wrapper = f.find('album-photo'), like = wrapper.find('photo-like'), print = wrapper.find('album-print');
  const pointer = { pointerId: 1, pointerType: 'mouse', clientX: 160, clientY: 160 };
  wrapper.emit('pointerenter', pointer);
  const tilt = print.style.getPropertyValue('--inspect-rx');
  wrapper.emit('pointermove', { ...pointer, clientY: 150 });
  like.emit('pointerdown', pointer);
  f.flush();
  wrapper.emit('pointerleave', pointer);
  assert.equal(wrapper.classList.contains('is-inspected'), true);
  assert.equal(print.style.getPropertyValue('--inspect-rx'), tilt);
  assert.equal(print.style.getPropertyValue('--inspect-lift'), '-12px');
  like.emit('pointercancel', pointer);
  assert.equal(wrapper.classList.contains('is-inspected'), false);
  assert.equal(print.style.getPropertyValue('--inspect-lift'), '0px');
});

test('adaptive album pagination preserves every photograph, chronological order and month/year boundaries', () => {
  const media = [
    ...Array.from({ length: 25 }, (_, index) => ({ ...sample(`nov-${index}`, `2026-11-${String(index + 1).padStart(2, '0')}`), width: index % 6 ? 600 : 1600, height: 900 })),
    ...Array.from({ length: 3 }, (_, index) => ({ ...sample(`old-${index}`, `2025-09-0${index + 1}`), width: 600, height: 900 })),
    { ...sample('unknown', null), width: 600, height: 900 },
  ];
  const layout = { width: 1360, height: 620, mobile: false };
  for (const view of ['month', 'year']) for (const order of ['asc', 'desc']) {
    const pages = buildAlbumPages(media, { view, order, layout, likes: { 'nov-12': 250 } });
    const ids = pages.flatMap(page => page.items.map(item => item.id));
    assert.equal(ids.length, media.length); assert.equal(new Set(ids).size, media.length);
    assert.deepEqual([...ids].sort(), media.map(item => item.id).sort());
    assert.equal(pages.at(-1).key, 'undated');
    for (const page of pages) {
      assert.ok(page.items.length <= (view === 'month' ? 12 : 18));
      assert.ok(page.items.every(item => page.key === 'undated' ? item.takenAt === null : item.takenAt.startsWith(page.key)));
    }
    const dated = pages.flatMap(page => page.items).filter(item => item.takenAt).map(item => item.takenAt);
    assert.deepEqual(dated, [...dated].sort((a, b) => (order === 'asc' ? 1 : -1) * a.localeCompare(b)));
  }
});

test('closing a player after adaptive multi-page browsing lands on the selected photograph and restores focus', t => {
  const packing = { width: 1240, height: 590 };
  const media = Array.from({ length: 28 }, (_, index) => ({ ...sample(`adaptive-${index}`, `2026-11-${String(index + 1).padStart(2, '0')}`), width: index % 5 ? 600 : 1600, height: 900 }));
  const likesService = albumLikesFixture({ 'adaptive-17': 400 });
  const f = fixture(t, { packing, likesService, media, reducedMotion: () => true });
  const expected = buildAlbumPages(media, { layout: { ...packing, mobile: false, paper: { left: 9, right: 9, top: 9, bottom: 41 } }, likes: likesService.snapshot() });
  assert.equal(f.api.state.pageCount, expected.length);
  assert.ok(expected.length > 1);
  const selected = expected.at(-1).items.at(-1).id;
  assert.equal(f.api.openPlayer(selected), true);
  assert.equal(f.dialog.getAttribute('data-photo-id'), selected);
  f.api.closePlayer();
  assert.equal(f.api.state.playerOpen, false);
  const target = f.container.findAll('album-photo').find(node => node.getAttribute('data-photo-id') === selected);
  assert.ok(target); assert.equal(f.doc.activeElement, target.find('album-photo-card'));
  assert.ok(f.ready.some(event => event.reason === 'player-return'));
});
