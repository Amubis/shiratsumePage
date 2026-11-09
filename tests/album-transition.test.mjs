import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlbumCircleGrid, albumRowProgress, albumCircleScale, createAlbumEnterPlan, createAlbumExitPlan, createAlbumTransition, ALBUM_STATIC_RADIUS_RATIO } from '../src/album-transition.js';

test('large circles retain fixed square-grid centers and fully cover desktop/mobile corners', () => {
  for (const [width, height] of [[1899, 973], [1440, 900], [390, 844], [320, 568]]) {
    const grid = createAlbumCircleGrid({ width, height });
    assert.ok(grid.pitch >= 96 && grid.pitch <= 220);
    assert.ok(grid.circles.length < 150);
    assert.equal(grid.circles[1].x - grid.circles[0].x, grid.pitch);
    assert.equal(grid.circles[grid.columns].y - grid.circles[0].y, grid.pitch);
    const covered = (x, y) => grid.circles.some((circle) => Math.hypot(circle.x - x, circle.y - y) <= circle.maxRadius);
    for (let x = 0; x <= width; x += 4) { assert.ok(covered(x, 0)); assert.ok(covered(x, height)); }
    for (let y = 0; y <= height; y += 4) { assert.ok(covered(0, y)); assert.ok(covered(width, y)); }
    assert.ok(covered(width, height));
  }
});

test('each row grows from its own center bottom-to-top, crests, then settles without gaps', () => {
  const rows = 7;
  const duration = 1 / (1 + (rows - 1) * .65);
  const firstNext = duration * .65;
  assert.equal(albumRowProgress(0, rows - 1, rows), 0);
  assert.equal(albumRowProgress(firstNext, rows - 2, rows), 0);
  assert.ok(albumCircleScale(firstNext, rows - 1, rows) > 1);
  assert.equal(albumCircleScale(firstNext, 0, rows), 0);
  for (let row = 0; row < rows; row++) {
    assert.equal(albumCircleScale(0, row, rows), 0);
    assert.equal(albumCircleScale(1, row, rows), 1);
    assert.equal(albumCircleScale(0, row, rows, 'shrink'), 1);
    assert.equal(albumCircleScale(1, row, rows, 'shrink'), 0);
  }
  assert.ok(albumCircleScale(.4, rows - 1, rows, 'shrink') < albumCircleScale(.4, 0, rows, 'shrink'));
});

test('papers stop back-to-front before the cover, with row-major photos and reversed exit', () => {
  const enter = createAlbumEnterPlan(8);
  const papers = enter.filter((part) => part.kind.startsWith('paper'));
  assert.deepEqual(papers.map((part) => part.kind), ['paper-back', 'paper-middle', 'paper-front']);
  assert.ok(papers[0].delay + papers[0].duration < papers[1].delay + papers[1].duration);
  assert.ok(papers[1].delay + papers[1].duration < papers[2].delay + papers[2].duration);
  assert.ok(enter.find((part) => part.kind === 'cover').delay > papers[2].delay + papers[2].duration);
  const photos = enter.filter((part) => part.kind === 'photo');
  assert.deepEqual(photos.map((part) => part.index), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.ok(photos.every((part, index) => !index || part.delay > photos[index - 1].delay));
  const exit = createAlbumExitPlan(8);
  assert.deepEqual(exit.filter((part) => part.kind === 'photo').map((part) => part.index), [7, 6, 5, 4, 3, 2, 1, 0]);
  assert.deepEqual(exit.filter((part) => part.kind.startsWith('paper')).map((part) => part.kind), ['paper-front', 'paper-middle', 'paper-back']);
});

class Node {
  constructor(name = 'div') {
    this.localName = name;
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.handlers = new Map();
    this.style = { opacity: '', transform: '' };
    this.hidden = false;
    const classes = new Set();
    this.classList = {
      add(...names) { names.forEach((name) => classes.add(name)); },
      remove(...names) { names.forEach((name) => classes.delete(name)); },
      contains(name) { return classes.has(name); },
      toggle(name, value = !classes.has(name)) { if (value) classes.add(name); else classes.delete(name); return value; },
    };
    this.queries = new Map();
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
  prepend(node) { node.remove(); node.parentElement = this; this.children.unshift(node); }
  replaceChildren(...nodes) { for (const child of this.children) child.parentElement = null; this.children = []; this.append(...nodes); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((node) => node !== this); this.parentElement = null; }
  querySelector(selector) { return this.queries.get(selector)?.[0] || null; }
  querySelectorAll(selector) {
    if (this.queries.has(selector)) return this.queries.get(selector);
    return [...new Set(selector.split(',').flatMap((part) => this.queries.get(part.trim()) || []))];
  }
  addEventListener(type, handler) { if (!this.handlers.has(type)) this.handlers.set(type, new Set()); this.handlers.get(type).add(handler); }
  removeEventListener(type, handler) { this.handlers.get(type)?.delete(handler); }
  emit(type, event = {}) { this.handlers.get(type)?.forEach((handler) => handler(event)); }
}

function fixture(t, { reduced = false } = {}) {
  let clock = 0;
  let frameId = 0;
  const frames = new Map();
  const animations = [];
  const win = new Node('window');
  win.innerWidth = 1440; win.innerHeight = 900;
  win.performance = { now: () => clock };
  win.requestAnimationFrame = (callback) => { frames.set(++frameId, callback); return frameId; };
  win.cancelAnimationFrame = (id) => frames.delete(id);
  win.getComputedStyle = (node) => ({ transform: node.restTransform || 'none' });
  const doc = new Node('document');
  doc.defaultView = win; doc.hidden = false;
  doc.body = new Node('body'); doc.documentElement = new Node('html');
  doc.createElement = (name) => new Node(name);
  doc.createElementNS = (_, name) => new Node(name);
  const section = new Node('section'); section.ownerDocument = doc;
  const desk = new Node(); desk.inert = false; section.queries.set('.album-desk', [desk]);
  const previous = new Node('section'); const content = new Node();
  previous.queries.set('.primary-intro', [content]);
  const make = () => {
    const node = new Node();
    node.animate = (keyframes, options) => {
      let resolve, reject;
      const animation = { node, keyframes, options, at: clock, cancelled: false, finished: new Promise((yes, no) => { resolve = yes; reject = no; }),
        cancel() { if (this.cancelled) return; this.cancelled = true; reject(new Error('cancelled')); },
        finish() { resolve(); },
        pause() { this.paused = true; },currentTime:0,
      };
      animations.push(animation); return animation;
    };
    return node;
  };
  for (const selector of ['.album-paper.layer-back', '.album-paper.layer-middle', '.album-paper.layer-front', '.album-cover', '.album-heading', '.album-tabs', '.album-filter-tab', '.album-group-heading', '.album-page-status', '.album-source-note']) {
    const node = make(); section.queries.set(selector, [node]);
    if (selector.startsWith('.album-paper.')) section.queries.set('.album-paper', [...(section.queries.get('.album-paper') || []), node]);
  }
  section.queries.set('.album-photo', Array.from({ length: 4 }, make));
  const controller = createAlbumTransition({ section, previous, reducedMotion: () => reduced });
  const overlay = doc.body.children[0];
  const field = section.children[0];
  function step(time) {
    clock = time;
    const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(time));
    for (const animation of animations) if (!animation.cancelled && !animation.paused && time >= animation.at + animation.options.delay + animation.options.duration) animation.finish();
  }
  t.after(() => controller.destroy());
  return { controller, section, desk, previous, content, win, doc, overlay, field, animations, frames, step };
}

test('resistance preview is preserved across goTo zero reset and cover continues to a complete field', async (t) => {
  const f = fixture(t);
  assert.ok(f.section.classList.contains('album-entry-prepared'));
  assert.equal(f.desk.inert, true);
  f.controller.setProgress(.3);
  assert.equal(f.overlay.hidden, false);
  assert.ok(Number(f.content.style.opacity) < 1);
  assert.equal(f.controller.progress, .3);
  f.controller.setProgress(0);
  const cover = f.controller.cover();
  assert.equal(f.controller.progress, .3);
  f.step(1000);
  assert.equal(await cover, true);
  assert.equal(f.controller.phase, 'covered');
  assert.equal(f.content.style.opacity, '0');
  assert.ok(f.overlay.children[0].children.every((circle) => Number(circle.getAttribute('r')) > 0));
});

test('paper entrance hands off the cover and leave/reveal release all hidden actors and overlay', async (t) => {
  const f = fixture(t);
  await f.controller.cover({ animate: false });
  const enter = f.controller.enter();
  assert.equal(f.overlay.hidden, true);
  assert.equal(f.content.style.opacity, '');
  assert.equal(f.controller.phase, 'entering');
  assert.equal(f.animations.length, createAlbumEnterPlan(4).length);
  assert.equal(f.animations[0].options.duration, 380);
  assert.match(f.animations[0].keyframes[0].transform, /translateX\(1152px\)/);
  f.step(2000); await Promise.resolve();
  assert.equal(await enter, true);
  assert.equal(f.controller.phase, 'active');
  assert.equal(f.section.classList.contains('album-entry-prepared'), false);
  assert.equal(f.desk.inert, false);
  const leave = f.controller.leave(); f.step(4000); await Promise.resolve();
  assert.equal(await leave, true);
  assert.equal(f.overlay.hidden, false);
  assert.equal(f.controller.phase, 'covered');
  const reveal = f.controller.reveal(); f.step(5000);
  assert.equal(await reveal, true);
  assert.equal(f.overlay.hidden, true);
  assert.equal(f.controller.phase, 'idle');
});

test('aborting a pending or held cover restores reading and prevents a stranded fullscreen plane', async (t) => {
  const f = fixture(t);
  const first = new AbortController();
  const covering = f.controller.cover({ signal: first.signal });
  f.step(150);
  first.abort();
  assert.equal(await covering, false);
  assert.equal(f.overlay.hidden, true);
  assert.equal(f.content.style.opacity, '');
  assert.equal(f.frames.size, 0);
  const held = new AbortController();
  assert.equal(await f.controller.cover({ signal: held.signal, animate: false }), true);
  held.abort();
  assert.equal(f.overlay.hidden, true);
  assert.equal(f.controller.phase, 'idle');
});

test('incomplete gestures clear on the next frame, while disabled/preview mode cannot paint', (t) => {
  const f = fixture(t);
  f.controller.setProgress(.2); f.controller.setProgress(0); f.step(16);
  assert.equal(f.overlay.hidden, true);
  f.controller.setEnabled(false); f.controller.setProgress(.8);
  assert.equal(f.overlay.hidden, true);
  assert.equal(f.field.hidden, true);
  assert.equal(f.section.classList.contains('has-album-transition'), false);
});

test('reduced motion and hidden tabs settle immediately, resize cleans animations and destroy releases resources', async (t) => {
  const f = fixture(t, { reduced: true });
  assert.equal(await f.controller.cover(), true);
  assert.equal(await f.controller.enter(), true);
  assert.equal(f.animations.length, 0);
  assert.equal(await f.controller.leave(), true);
  assert.equal(await f.controller.reveal(), true);
  f.controller.destroy();
  assert.equal(f.doc.body.children.length, 0);
  assert.equal(f.section.children.length, 0);
  assert.equal(f.frames.size, 0);
  assert.equal(await f.controller.cover(), false);
});

test('resize and visibility complete an in-flight operation without freezing a navigation promise', async (t) => {
  const f = fixture(t);
  const cover = f.controller.cover();
  f.win.innerWidth = 390; f.win.innerHeight = 844; f.win.emit('resize');
  assert.equal(await cover, true);
  assert.equal(f.overlay.children[0].getAttribute('viewBox'), '0 0 390 844');
  assert.equal(f.controller.phase, 'covered');
  const entrance = f.controller.enter();
  f.doc.hidden = true; f.doc.emit('visibilitychange');
  assert.equal(await entrance, true);
  assert.equal(f.overlay.hidden, true);
  assert.equal(f.frames.size, 0);
});

test('resting dots slightly overlap along rows while preserving openings at square centers', (t)=>{
  const f=fixture(t);
  assert.equal(ALBUM_STATIC_RADIUS_RATIO,.54);
  const circles=f.field.children[0].children;
  const pitch=Number(circles[1].getAttribute('cx'))-Number(circles[0].getAttribute('cx'));
  const radius=Number(circles[0].getAttribute('r'));
  assert.ok(pitch<createAlbumCircleGrid().pitch,'resting dots use a smaller scale than the covering transition');
  assert.ok(radius*2>pitch,'the diameter exceeds the center distance');
  assert.ok(radius*2/pitch<1.1,'the overlap stays slight');
  assert.ok(radius<pitch/Math.SQRT2,'four-corner openings remain between circles');
});

test('scroll entrance pauses exactly at input and rewinds the same actor timelines', (t)=>{
  const f=fixture(t);
  f.controller.seekEnter(.2);
  assert.equal(f.controller.phase,'cover-seek');
  assert.equal(f.overlay.hidden,false);
  assert.ok(f.animations.every(a=>a.paused));
  f.controller.seekEnter(.7);
  const animations=f.animations.slice();const times=animations.map(a=>a.currentTime);
  assert.equal(f.overlay.hidden,true);
  f.step(4000);
  assert.deepEqual(animations.map(a=>a.currentTime),times,'time cannot advance without wheel input');
  f.controller.seekEnter(.5);
  assert.equal(f.animations.length,animations.length,'reverse input reuses the paused animations');
  assert.ok(animations.every((a,i)=>a.currentTime<times[i]));
  f.controller.seekEnter(1);
  assert.equal(f.desk.inert,false);assert.equal(f.controller.busy,false);
  assert.ok(animations.every(a=>a.cancelled));
});

test('scroll exit can reverse across a held cover and cancellation restores readable controls', (t)=>{
  const f=fixture(t);
  f.controller.seekExit(.8);assert.equal(f.controller.phase,'reveal-seek');
  assert.equal(f.overlay.hidden,false);
  f.controller.holdCover();assert.ok(f.overlay.children[0].children.every(c=>Number(c.getAttribute('r'))>0));
  f.controller.seekExit(.4);assert.equal(f.controller.phase,'leave-seek');assert.equal(f.overlay.hidden,true);
  f.controller.cancel();assert.equal(f.desk.inert,false);assert.equal(f.overlay.hidden,true);assert.equal(f.controller.busy,false);
  assert.equal(f.section.classList.contains('album-exit-playing'),false);
});
