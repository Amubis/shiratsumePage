import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceWaterPush, createHeroInteractions } from '../src/hero-interactions.js';

class Node {
  constructor() {
    this.events = new Map();
    this.values = new Map();
    this.classes = new Set();
    this.style = { setProperty: (key, value) => this.values.set(key, value), removeProperty: (key) => this.values.delete(key) };
    this.classList = { toggle: (key, value) => value ? this.classes.add(key) : this.classes.delete(key), contains: (key) => this.classes.has(key) };
    this.isConnected = true;
  }
  addEventListener(type, fn) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(fn); }
  removeEventListener(type, fn) { this.events.get(type)?.delete(fn); }
  emit(type, fields = {}) { const event = { pointerType: 'mouse', ...fields }; for (const fn of this.events.get(type) || []) fn(event); return event; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 300, bottom: 300, width: 300, height: 300 }; }
}

function fixture({ reduced = false, decorationOnly = false } = {}) {
  const win = new Node();
  const doc = new Node();
  const hero = new Node();
  const button = new Node();
  const wrap = new Node();
  const clover = new Node();
  const frames = new Map();
  let serial = 0;
  let time = 0;
  let active = true;
  win.performance = { now: () => time };
  win.requestAnimationFrame = (fn) => { frames.set(++serial, fn); return serial; };
  win.cancelAnimationFrame = (id) => frames.delete(id);
  doc.defaultView = win;
  hero.ownerDocument = doc;
  hero.querySelectorAll = () => [clover];
  const controller = createHeroInteractions({ hero, ...(decorationOnly ? {} : { exploreButton: button, exploreWrap: wrap }), reducedMotion: () => reduced, isActive: () => active });
  const tick = (milliseconds = 34) => {
    time += milliseconds;
    const callbacks = [...frames.values()]; frames.clear();
    callbacks.forEach((fn) => fn(time));
  };
  const move = (x, y) => hero.emit('pointermove', { clientX: x, clientY: y });
  return { win, doc, hero, button, wrap, clover, controller, frames, tick, move, setActive(value) { active = value; } };
}

test('water motion is bounded and returns to rest without a permanent animation loop', () => {
  let state = { x: 17, y: 17, vx: 200, vy: 200 };
  for (let frame = 0; frame < 360; frame++) {
    state = advanceWaterPush(state, 1 / 60);
    assert.ok(Math.hypot(state.x, state.y) <= 18 + 1e-9);
  }
  assert.deepEqual(state, { x: 0, y: 0, vx: 0, vy: 0, settled: true });
});

test('a pointer stroke pushes the real clover, then the spring clears its styles and frame', () => {
  const f = fixture();
  f.move(80, 100); f.tick(); f.move(150, 110); f.tick();
  assert.ok(parseFloat(f.clover.values.get('--pointer-push-x')) > 0);
  assert.ok(f.frames.size > 0);
  for (let index = 0; index < 160; index++) f.tick();
  assert.equal(f.clover.values.size, 0);
  assert.equal(f.frames.size, 0);
  f.controller.destroy();
});

test('a decoration-only chapter shares the same water push without an exploration button', () => {
  const f = fixture({ decorationOnly: true });
  f.move(70, 110); f.tick(); f.move(140, 120); f.tick();
  assert.ok(parseFloat(f.clover.values.get('--pointer-push-x')) > 0);
  f.controller.refresh();
  assert.equal(f.frames.size, 0);
  assert.equal(f.clover.values.size, 0);
  f.controller.destroy();
  for (const node of [f.hero, f.doc, f.win]) assert.ok([...node.events.values()].every(set => set.size === 0));
});

test('touch, reduced motion and non-home states do not leave pointer displacement behind', () => {
  for (const kind of ['touch', 'reduced', 'inactive']) {
    const f = fixture({ reduced: kind === 'reduced' });
    f.move(80, 100); f.tick(); f.move(150, 110); f.tick();
    if (kind === 'touch') f.hero.emit('pointermove', { pointerType: 'touch', clientX: 150, clientY: 130 });
    if (kind === 'inactive') { f.setActive(false); f.tick(); }
    assert.equal(f.clover.values.size, 0, kind);
    assert.equal(f.frames.size, 0, kind);
    f.controller.destroy();
  }
});

test('hover and keyboard focus share one CTA state without forwarding a native click', () => {
  const f = fixture();
  f.button.emit('pointerenter');
  assert.equal(f.wrap.classes.has('is-explore-hovered'), true);
  f.button.emit('focus'); f.button.emit('pointerleave');
  assert.equal(f.wrap.classes.has('is-explore-hovered'), true);
  f.button.emit('blur');
  assert.equal(f.wrap.classes.has('is-explore-hovered'), false);
  let received;
  f.button.addEventListener('click', (event) => { received = event; });
  const click = f.button.emit('click', { clientX: 42, clientY: 73 });
  assert.equal(received, click);
  assert.equal(f.button.events.get('click').size, 1);
  f.controller.destroy();
});

test('visibility, resize, refresh and destruction cancel pending movement and detach handlers', () => {
  const f = fixture();
  const push = () => { f.move(80, 100); f.tick(); f.move(150, 110); f.tick(); };
  for (const [target, type] of [[f.doc, 'visibilitychange'], [f.win, 'resize'], [f.win, 'scroll'], [f.win, 'pagehide']]) {
    push(); target.emit(type);
    assert.equal(f.frames.size, 0);
    assert.equal(f.clover.values.size, 0);
  }
  push(); f.controller.refresh();
  assert.equal(f.frames.size, 0);
  f.button.emit('pointerenter'); push(); f.controller.destroy(); f.controller.destroy();
  assert.equal(f.frames.size, 0);
  assert.equal(f.clover.values.size, 0);
  assert.equal(f.wrap.classes.has('is-explore-hovered'), false);
  for (const node of [f.hero, f.doc, f.win, f.button]) assert.ok([...node.events.values()].every((set) => set.size === 0));
});
