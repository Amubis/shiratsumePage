import test from 'node:test';
import assert from 'node:assert/strict';
import { getTopbarDockState, createTopbarDock } from '../src/topbar-dock.js';

test('the bar occupies the video edge and scrolls away without covering it', () => {
  for (const height of [64, 88]) for (const scroll of [0, 8, height / 2, height, height * 1.5, height * 2, 800]) {
    const state = getTopbarDockState({ height, scroll });
    assert.equal(state.offset, -Math.min(scroll, height));
    assert.ok(state.space >= 0);
    if (!state.collapsed) assert.equal(state.space - scroll, height + state.offset, 'video starts at the visible bar edge');
    else assert.ok(state.space - scroll <= 0);
  }
  assert.equal(getTopbarDockState({ active: false }).space, 0);
});

test('keyboard focus reveals the dock with its own viewport space', () => {
  const state = getTopbarDockState({ height: 64, scroll: 45, focused: true });
  assert.equal(state.offset, 0);
  assert.equal(state.space - 45, 64);
  assert.equal(state.collapsed, false);
});

class Node {
  constructor() {
    this.handlers = new Map(); this.dataset = {}; this.children = [];
    const classes = new Set();
    this.classList = {
      contains: name => classes.has(name), add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle(name, active) { if (active) classes.add(name); else classes.delete(name); },
    };
    const values = new Map();
    this.style = { getPropertyValue: name => values.get(name) || '', setProperty: (name, value) => values.set(name, value), removeProperty: name => values.delete(name) };
    this.rect = { top: 0, height: 64 };
  }
  getBoundingClientRect() { return this.rect; }
  querySelector() { return this.media; }
  contains(node) { return this.children.includes(node); }
  addEventListener(name, fn) { if (!this.handlers.has(name)) this.handlers.set(name, new Set()); this.handlers.get(name).add(fn); }
  removeEventListener(name, fn) { this.handlers.get(name)?.delete(fn); }
  emit(name) { this.handlers.get(name)?.forEach(fn => fn()); }
}

function fixture(t) {
  const root = new Node(), body = new Node(), topbar = new Node(), hero = new Node(), media = new Node(), win = new Node();
  const frames = new Map(); let id = 0, disconnected = false;
  win.requestAnimationFrame = fn => { frames.set(++id, fn); return id; };
  win.cancelAnimationFrame = key => frames.delete(key);
  win.MutationObserver = class { constructor(callback) { this.callback = callback; } observe() {} disconnect() { disconnected = true; } };
  const doc = { documentElement: root, body, defaultView: win, activeElement: null };
  topbar.ownerDocument = doc; hero.media = media; body.classList.add('on-home'); root.dataset.phase = 'video';
  const api = createTopbarDock({ topbar, hero });
  t.after(() => api.destroy());
  const value = name => parseFloat(root.style.getPropertyValue(`--topbar-${name}`));
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); };
  return { root, body, topbar, hero, media, win, doc, api, value, frames, flush, get disconnected() { return disconnected; } };
}

test('video-only introduction stays full-screen and controls make room for the dock', t => {
  const f = fixture(t);
  assert.equal(f.value('space'), 0);
  assert.equal(f.value('offset'), -64);
  f.root.dataset.phase = 'text'; f.api.refresh(); assert.equal(f.value('space'), 0);
  f.root.dataset.phase = 'controls'; f.api.refresh(); assert.equal(f.value('space'), 64);
  f.root.dataset.phase = 'ready'; f.hero.rect.top = -32; f.win.emit('scroll'); f.flush();
  assert.equal(f.value('offset'), -32); assert.equal(f.value('space'), 64);
  assert.equal(f.root.classList.contains('is-topbar-dock-tracking'), true);
  f.hero.rect.top = -160; f.api.refresh(); assert.equal(f.value('space'), 0);
});

test('circular watch erase locks actual in-flight geometry and cancellation or completion releases it', t => {
  const f = fixture(t);
  f.root.dataset.phase = 'ready'; f.api.refresh();
  f.topbar.rect.top = -14; f.media.rect.top = 50;
  f.body.classList.add('watch-reveal-animating'); f.api.refresh();
  assert.equal(f.value('offset'), -14); assert.equal(f.value('space'), 50);
  f.topbar.rect.top = 0; f.media.rect.top = 64; f.api.refresh();
  assert.equal(f.value('space'), 50, 'erase geometry cannot drift to its transition endpoint');
  f.body.classList.remove('watch-reveal-animating'); f.api.refresh();
  assert.equal(f.value('space'), 64);
  assert.equal(f.root.classList.contains('is-topbar-dock-locked'), false);
  f.body.classList.add('watch-mode'); f.api.refresh(); assert.equal(f.value('space'), 0);
  f.body.classList.remove('watch-mode'); f.api.refresh(); assert.equal(f.value('space'), 64);
  f.body.classList.remove('on-home'); f.api.refresh(); assert.equal(f.value('space'), 0);
});

test('focus is keyboard reachable and input is left with the chapter navigator', t => {
  const f = fixture(t);
  f.root.dataset.phase = 'ready'; f.hero.rect.top = -90;
  const control = {}; f.topbar.children.push(control); f.doc.activeElement = control; f.topbar.emit('focusin');
  assert.equal(f.value('offset'), 0); assert.equal(f.value('space'), 154);
  f.doc.activeElement = null; f.topbar.emit('focusout'); f.flush(); assert.equal(f.value('offset'), -64);
  const mouseFocused = { matches: () => false }; f.topbar.children.push(mouseFocused); f.doc.activeElement = mouseFocused; f.topbar.emit('focusin');
  assert.equal(f.value('offset'), -64, 'mouse focus cannot pin the dock while scrolling');
  assert.equal(f.win.handlers.has('wheel'), false); assert.equal(f.win.handlers.has('touchmove'), false);
});

test('destroy releases pending frames, listeners, classes and existing custom properties', t => {
  const f = fixture(t);
  f.win.emit('scroll'); assert.equal(f.frames.size, 1);
  f.api.destroy(); assert.equal(f.frames.size, 0); assert.equal(f.disconnected, true);
  assert.equal(f.root.classList.contains('has-topbar-dock'), false);
  assert.equal(f.root.style.getPropertyValue('--topbar-space'), '');
  assert.ok([...f.win.handlers.values()].every(set => set.size === 0));
  f.api.refresh(); assert.equal(f.root.style.getPropertyValue('--topbar-offset'), '');
});
