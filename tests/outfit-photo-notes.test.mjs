import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutfitPhotoNotes, outfitNoteCrop, outfitNotePeelFrames, outfitNoteStickFrames, OUTFIT_NOTE_TIMING } from '../src/outfit-photo-notes.js';

class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, listener) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(listener); }
  removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener); }
  emit(name) { for (const listener of [...this.listeners.get(name) || []]) listener({ type: name, target: this }); }
}

function fixture({ reduced = false, active = true } = {}) {
  const doc = new Target(), win = new Target(), animations = [], decodes = [];
  doc.defaultView = win; doc.hidden = false;
  class Node extends Target {
    constructor(tag) {
      super(); this.tagName = tag; this.ownerDocument = doc; this.children = []; this.attributes = new Map(); this.classes = new Set();
      this.classList = { add: (...items) => items.forEach(value => this.classes.add(value)), remove: (...items) => items.forEach(value => this.classes.delete(value)), contains: value => this.classes.has(value) };
      const properties = new Map(); this.style = { setProperty: (name, value) => properties.set(name, value), getPropertyValue: name => properties.get(name) || '' };
    }
    set className(value) { this.classes = new Set(value.split(' ')); }
    get className() { return [...this.classes].join(' '); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
    replaceChildren(...nodes) { this.children.forEach(node => node.parentElement = null); this.children = []; this.append(...nodes); }
    animate(frames, options) {
      let resolve, reject;
      const finished = new Promise((yes, no) => { resolve = yes; reject = no; });
      const animation = { node: this, frames, options, finished, cancelled: false, done: false, finish() { this.done = true; resolve(); }, cancel() { this.done = true; this.cancelled = true; reject(new Error('cancelled')); } };
      animations.push(animation); return animation;
    }
    decode() { return new Promise((resolve, reject) => decodes.push({ node: this, resolve, reject })); }
  }
  doc.createElement = tag => new Node(tag);
  const container = doc.createElement('div');
  const outfit = id => ({ id, front: `./assets/${id}-front.png`, back: `./assets/${id}-back.png`, frontBounds: [300, 150, 1100, 2480], backBounds: [310, 140, 1110, 2460] });
  const a = outfit('a'), b = outfit('b'), c = outfit('c');
  const notes = createOutfitPhotoNotes({ container, initialOutfit: a, active, reducedMotion: () => reduced });
  const images = () => container.children.map(card => card.children[0].children[0].src);
  return { doc, win, container, notes, a, b, c, animations, decodes, images, set reduced(value) { reduced = value; }, decode(url) { const item = decodes.find(item => item.node.src === url); assert.ok(item, url); item.resolve(); }, finishAnimations() { animations.filter(item => !item.done).forEach(item => item.finish()); } };
}
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('the initial noninteractive prints match the selected outfit without replaying an entrance', t => {
  const f = fixture(); t.after(() => f.notes.destroy());
  assert.equal(f.notes.state, 'ready'); assert.equal(f.notes.outfitId, 'a');
  assert.deepEqual(f.images(), [f.a.front, f.a.back]);
  assert.equal(f.container.getAttribute('aria-hidden'), 'true');
  assert.equal(f.animations.length, 0); assert.equal(f.decodes.length, 0);
  assert.ok(f.container.children.every(node => node.tagName === 'figure' && node.children[0].tagName === 'span'));
  assert.ok(f.container.children.every(node => node.children[0].children[0].alt === ''));
});

test('a new outfit decodes before the old prints peel, then new prints settle from their tape edge', async t => {
  const f = fixture(); t.after(() => f.notes.destroy());
  const update = f.notes.setOutfit(f.b);
  assert.equal(f.notes.state, 'loading'); assert.deepEqual(f.images(), [f.a.front, f.a.back]); assert.equal(f.animations.length, 0);
  f.decode(f.b.front); await tick(); assert.equal(f.animations.length, 0, 'the back image must also be ready');
  f.decode(f.b.back); await tick(); assert.equal(f.notes.state, 'peeling');
  assert.equal(f.animations.length, 2); assert.equal(f.animations[0].options.duration, OUTFIT_NOTE_TIMING.peel);
  assert.equal(f.animations[1].options.delay, OUTFIT_NOTE_TIMING.stagger);
  assert.match(f.animations[0].frames.at(-1).transform, /rotateX\(58deg\)/);
  f.finishAnimations(); await tick();
  assert.equal(f.notes.state, 'sticking'); assert.deepEqual(f.images(), [f.b.front, f.b.back]);
  assert.equal(f.animations.at(-1).options.duration, OUTFIT_NOTE_TIMING.stick);
  f.finishAnimations(); assert.equal(await update, true);
  assert.equal(f.notes.state, 'ready'); assert.equal(f.notes.outfitId, 'b');
  assert.ok(f.animations.every(item => item.cancelled), 'temporary fill styles must be released');
  assert.ok(f.container.children.every(node => !node.classList.contains('is-note-sticking')));
});

test('a late decode from a skipped outfit cannot replace the latest selection', async t => {
  const f = fixture(); t.after(() => f.notes.destroy());
  const b = f.notes.setOutfit(f.b), c = f.notes.setOutfit(f.c);
  assert.equal(await b, false); assert.equal(f.notes.pendingId, 'c');
  f.decode(f.c.front); f.decode(f.c.back); await tick(); assert.equal(f.notes.state, 'peeling');
  f.decode(f.b.front); f.decode(f.b.back); await tick(); assert.equal(f.notes.pendingId, 'c');
  f.finishAnimations(); await tick(); f.finishAnimations(); assert.equal(await c, true);
  assert.deepEqual(f.images(), [f.c.front, f.c.back]); assert.equal(f.notes.outfitId, 'c');
});

test('leaving the introduction settles the latest outfit and ignores subsequent decode completion', async t => {
  const f = fixture(); t.after(() => f.notes.destroy());
  const b = f.notes.setOutfit(f.b); f.notes.setActive(false);
  assert.equal(await b, true); assert.deepEqual(f.images(), [f.b.front, f.b.back]);
  f.decode(f.b.front); f.decode(f.b.back); await tick(); assert.equal(f.animations.length, 0);
  await f.notes.setOutfit(f.c); assert.deepEqual(f.images(), [f.c.front, f.c.back]); assert.equal(f.decodes.length, 2);
});

test('reduced motion or a hidden page removes active peel styles and keeps the latest content', async t => {
  const f = fixture(); t.after(() => f.notes.destroy());
  const update = f.notes.setOutfit(f.b); f.decode(f.b.front); f.decode(f.b.back); await tick();
  assert.equal(f.notes.state, 'peeling'); f.reduced = true; f.notes.refresh();
  assert.equal(await update, true); assert.equal(f.notes.outfitId, 'b'); assert.equal(f.notes.state, 'ready');
  assert.ok(f.animations.every(item => item.cancelled));
  f.reduced = false; const next = f.notes.setOutfit(f.c); f.doc.hidden = true; f.doc.emit('visibilitychange');
  assert.equal(await next, true); assert.deepEqual(f.images(), [f.c.front, f.c.back]);
});

test('failed latest images hide mismatched prints and the same selection can be retried', async t => {
  const f = fixture(); t.after(() => f.notes.destroy());
  const first = f.notes.setOutfit(f.b); f.decodes.find(item => item.node.src === f.b.front).reject(new Error('unavailable')); f.decode(f.b.back);
  assert.equal(await first, false); assert.equal(f.notes.state, 'error'); assert.equal(f.container.children.length, 0);
  await f.notes.setOutfit(f.b); assert.equal(f.notes.outfitId, 'b'); assert.deepEqual(f.images(), [f.b.front, f.b.back]);
});

test('repeat notifications are idle, missing backs use one print and invalid data clears the decoration', async t => {
  const f = fixture(); t.after(() => f.notes.destroy());
  assert.equal(await f.notes.setOutfit({ ...f.a, label: 'Renamed' }), true); assert.equal(f.animations.length, 0);
  f.notes.setActive(false); await f.notes.setOutfit({ id: 'single', front: './assets/single.png' });
  assert.deepEqual(f.images(), ['./assets/single.png']);
  await f.notes.setOutfit({ id: 'unsafe', front: 'javascript:alert(1)' });
  assert.equal(f.notes.state, 'empty'); assert.equal(f.container.children.length, 0);
  await f.notes.setOutfit(null); assert.equal(f.container.children.length, 0);
});

test('destroy aborts an outstanding update and releases DOM and event handlers', async () => {
  const f = fixture(); const update = f.notes.setOutfit(f.b); f.notes.destroy();
  assert.equal(await update, false); assert.equal(f.notes.state, 'destroyed'); assert.equal(f.container.children.length, 0);
  f.decode(f.b.front); f.decode(f.b.back); await tick(); assert.equal(f.animations.length, 0);
  assert.equal(f.doc.listeners.get('visibilitychange').size, 0); assert.equal(f.win.listeners.get('pagehide').size, 0);
  assert.equal(await f.notes.setOutfit(f.c), false);
});

test('source-pixel closeups preserve aspect ratio and frame the head and neckline within valid image bounds', () => {
  const crop = outfitNoteCrop({ imageWidth: 1440, imageHeight: 2560, frontBounds: [300, 150, 1100, 2480] });
  assert.equal(crop.width, 1440); assert.equal(crop.height, 2560);
  assert.ok(crop.top >= 0 && crop.top < 150); assert.ok(crop.left >= 0);
  assert.ok(crop.top + crop.cropHeight <= crop.height); assert.ok(crop.left + crop.cropWidth <= crop.width);
  assert.ok(Math.abs(crop.cropWidth / crop.cropHeight - 1.35) < .0001);
  const back = outfitNoteCrop({ backSize: [500, 900], backBounds: [10, 80, 480, 890] }, 'back');
  assert.equal(back.width, 500); assert.equal(back.height, 900);
  const frames = outfitNoteStickFrames(1); assert.equal(frames.at(-1).transform, 'rotate(8deg)');
  assert.match(outfitNotePeelFrames(0).at(-1).transform, /translate\(-25px,-72px\)/);
});
