import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { OUTFITS, MODEL_PROFILE, wrapOutfitIndex, createOutfitShowcase } from '../src/outfits.js';

class Element {
  constructor(tag, doc) {
    this.localName = tag;
    this.ownerDocument = doc;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      contains: (name) => this.classes.has(name),
      toggle: (name, force) => {
        const add = force ?? !this.classes.has(name);
        if (add) this.classes.add(name); else this.classes.delete(name);
        return add;
      },
    };
    if (tag === 'img') this.decode = async () => {
      if (doc.failedImages.has(this.src)) throw new Error('Missing image');
    };
  }
  set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'class') this.className = String(value);
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  emit(type, fields = {}) {
    const event = { type, target: this, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...fields };
    this.listeners.get(type)?.forEach((handler) => handler(event));
    return event;
  }
  all(predicate) { return this.children.flatMap((node) => [...(predicate(node) ? [node] : []), ...node.all(predicate)]); }
  find(className) { return this.all((node) => node.classList.contains(className))[0]; }
}

function fixture(t, options = {}) {
  const doc = { failedImages: new Set() };
  doc.createElement = (tag) => new Element(tag, doc);
  doc.createElementNS = (_, tag) => new Element(tag, doc);
  const container = doc.createElement('div');
  const changed = [];
  const api = createOutfitShowcase({ container, reducedMotion: () => true, onChange: (index) => changed.push(index), ...options });
  t.after(() => api.destroy());
  return { doc, container, api, changed, stage: container.find('outfit-stage'), image: container.find('outfit-image'), dots: container.all((node) => node.classList.contains('outfit-dot')), cue: container.find('outfit-cue'), status: container.find('outfit-status') };
}

async function settle() { for (let i = 0; i < 10; i += 1) await Promise.resolve(); }

test('four real front assets are configured in both languages without manufactured back views', async () => {
  assert.equal(OUTFITS.length, 4);
  assert.equal(new Set(OUTFITS.map(({ id }) => id)).size, 4);
  for (const outfit of OUTFITS) {
    assert.equal(outfit.back, null);
    assert.ok(outfit.label.zh);
    assert.ok(outfit.label.ja);
    assert.ok((await stat(new URL(`../${outfit.front}`, import.meta.url))).size > 1000);
  }
  for (const locale of ['zh', 'ja']) for (const key of ['heading', 'lead', 'description']) assert.ok(MODEL_PROFILE[locale][key]);
  assert.equal(wrapOutfitIndex(-1), 3);
  assert.equal(wrapOutfitIndex(4), 0);
  assert.equal(wrapOutfitIndex(9), 1);
  assert.throws(() => wrapOutfitIndex(1.5), TypeError);
});

test('stage cycles through every outfit, loops, and keeps one selected dot and front image', async (t) => {
  const f = fixture(t);
  assert.equal(f.api.index, 0);
  assert.equal(f.cue.hidden, false);
  assert.equal(f.image.src, OUTFITS[0].front);
  for (const expected of [1, 2, 3, 0]) {
    f.stage.emit('click');
    await settle();
    assert.equal(f.api.index, expected);
    assert.equal(f.image.src, OUTFITS[expected].front);
    assert.equal(f.dots.filter((dot) => dot.getAttribute('aria-pressed') === 'true').length, 1);
    assert.equal(f.dots[expected].getAttribute('aria-pressed'), 'true');
  }
  assert.deepEqual(f.changed, [1, 2, 3, 0]);
  assert.equal(f.cue.hidden, true);
  assert.equal(f.container.all((node) => node.localName === 'img').length, 1);
});

test('dots select directly and language changes preserve the outfit and update accessible names', async (t) => {
  const f = fixture(t);
  f.dots[3].emit('click');
  await settle();
  assert.equal(f.api.index, 3);
  assert.ok(f.status.textContent.includes('蓝白格套装'));
  f.api.setLanguage('ja');
  assert.equal(f.api.index, 3);
  assert.ok(f.image.alt.includes('ブルーのギンガムコーデ'));
  assert.ok(f.stage.getAttribute('aria-label').includes('タップして次のコーデへ'));
  assert.ok(f.dots[3].getAttribute('aria-label').includes('(4 / 4)'));
  assert.equal(f.cue.hidden, true);
});

test('arrow keys and endpoints are handled inside the stage rather than turning page chapters', async (t) => {
  const f = fixture(t);
  const event = f.stage.emit('keydown', { key: 'ArrowLeft' });
  await settle();
  assert.equal(f.api.index, 3);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  f.stage.emit('keydown', { key: 'Home' });
  await settle();
  assert.equal(f.api.index, 0);
  const tab = f.stage.emit('keydown', { key: 'Tab' });
  assert.equal(tab.prevented, false);
});

test('failed image decoding keeps the existing portrait visible and allows a later retry', async (t) => {
  const f = fixture(t);
  await settle();
  f.doc.failedImages.add(OUTFITS[2].front);
  assert.equal(await f.api.goTo(2), false);
  assert.equal(f.api.index, 0);
  assert.equal(f.image.src, OUTFITS[0].front);
  assert.equal(f.stage.getAttribute('aria-busy'), 'false');
  assert.ok(f.status.textContent.includes('加载失败'));
  f.doc.failedImages.clear();
  assert.equal(await f.api.goTo(2), true);
  assert.equal(f.api.index, 2);
});

test('concurrent requests do not race or leave the stage busy; disabling blocks interactions', async (t) => {
  const f = fixture(t);
  const first = f.api.goTo(1);
  assert.equal(await f.api.goTo(3), false);
  assert.equal(await first, true);
  assert.equal(f.api.index, 1);
  f.api.setEnabled(false);
  assert.equal(await f.api.next(), false);
  assert.equal(f.stage.disabled, true);
  f.api.setEnabled(true);
  assert.equal(await f.api.previous(), true);
  assert.equal(f.api.index, 0);
});

test('stable silhouette masks use alpha, preserve source dimensions, and have distinct resource IDs', (t) => {
  const a = fixture(t);
  const b = fixture(t);
  const masks = [a, b].map((f) => f.container.all((node) => node.localName === 'mask')[0]);
  assert.notEqual(masks[0].getAttribute('id'), masks[1].getAttribute('id'));
  assert.equal(masks[0].getAttribute('mask-type'), 'alpha');
  const source = masks[0].children[0];
  assert.equal(source.getAttribute('width'), '941');
  assert.equal(source.getAttribute('height'), '1672');
  assert.equal(source.getAttribute('href'), OUTFITS[0].front);
  const group = a.container.all((node) => node.localName === 'g')[0];
  assert.equal(group.getAttribute('mask'), `url(#${masks[0].getAttribute('id')})`);
  assert.equal(group.getAttribute('opacity'), '.36');
});

test('destroy removes all handlers and prevents asynchronous changes', async (t) => {
  const f = fixture(t);
  const pending = f.api.goTo(1);
  f.api.destroy();
  assert.equal(await pending, false);
  assert.equal(f.stage.listeners.get('click').size, 0);
  assert.equal(f.container.children.length, 0);
  assert.equal(await f.api.next(), false);
  assert.equal(f.api.index, 0);
});
