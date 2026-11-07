import test from 'node:test';
import assert from 'node:assert/strict';
import { getSidebarLayout, getTransformPose, createSidebar } from '../src/sidebar.js';

class FakeNode {
  constructor() {
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.queries = new Map();
    this.dataset = {};
    this.parentElement = null;
    this.style = {
      properties: new Map(),
      setProperty(name, value) { this.properties.set(name, value); },
      getPropertyValue(name) { return this.properties.get(name) || ''; },
    };
    const classes = new Set();
    this.classList = {
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); },
    };
    this.maxChildren = 0;
  }
  get textContent() { return this.text ?? this.children.map((node) => node.textContent).join(''); }
  set textContent(value) { this.text = value; }
  get childElementCount() { return this.children.length; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  querySelector(selector) { return this.queries.get(selector) || null; }
  addEventListener(type, handler, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push({ handler, once: options?.once });
  }
  removeEventListener(type, handler) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry.handler !== handler));
  }
  emit(type, fields = {}) {
    const event = { target: this, pointerType: 'mouse', relatedTarget: null, ...fields };
    for (const { handler, once } of [...(this.listeners.get(type) || [])]) {
      handler(event);
      if (once) this.removeEventListener(type, handler);
    }
    return event;
  }
  append(node) {
    node.parentElement = this;
    this.children.push(node);
    this.maxChildren = Math.max(this.maxChildren, this.children.length);
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((node) => node !== this);
    this.parentElement = null;
  }
  contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 160, height: 280 }; }
}

function sidebarFixture(t, { motionReduced = false } = {}) {
  const root = new FakeNode();
  const list = new FakeNode();
  const highlight = new FakeNode();
  const shape = new FakeNode();
  const bubbles = new FakeNode();
  const mobile = new FakeNode();
  const doc = new FakeNode();
  const win = new FakeNode();
  const animations = [];
  const timers = new Map();
  let clock = 0;
  let nextTimer = 0;
  root.ownerDocument = doc;
  doc.defaultView = win;
  doc.hidden = false;
  doc.createElement = () => new FakeNode();
  win.matchMedia = () => ({ matches: true });
  win.getComputedStyle = (node) => ({
    fontSize: node.parentElement?.style.getPropertyValue('--nav-font-size') || '27px',
    transform: node.visibleTransform || node.style.transform || 'matrix(1,0,0,1,0,0)',
  });
  win.setTimeout = (callback, delay) => {
    const timer = ++nextTimer;
    timers.set(timer, { at: clock + delay, callback });
    return timer;
  };
  win.clearTimeout = (timer) => timers.delete(timer);
  shape.animate = (frames, options) => {
    let resolve;
    let reject;
    const animation = {
      frames, options, cancelled: false,
      finished: new Promise((yes, no) => { resolve = yes; reject = no; }),
      cancel() { this.cancelled = true; reject(new Error('cancelled')); },
      finish() { resolve(); },
    };
    animations.push(animation);
    return animation;
  };
  root.append(list);
  list.append(highlight);
  highlight.append(shape);
  highlight.queries.set('.side-highlight-spin', shape);
  root.queries.set('#mobile-current', mobile);
  const links = Array.from({ length: 4 }, (_, index) => {
    const row = new FakeNode();
    const label = new FakeNode();
    label.textContent = ['庭院入口', '认识一下', '可爱瞬间', '日常收藏'][index];
    label.getBoundingClientRect = () => ({
      left: 16, top: 0,
      width: label.textContent.length * parseFloat(row.style.getPropertyValue('--nav-font-size') || '27'),
      height: 32,
    });
    row.queries.set('span', label);
    row.append(label);
    list.append(row);
    return row;
  });
  list.append(bubbles);
  const selected = [];
  const sidebar = createSidebar({
    root, links, highlight, bubbles, reducedMotion: () => motionReduced,
    onSelect: (index, details) => selected.push([index, details.source]),
  });
  function tick(milliseconds) {
    const target = clock + milliseconds;
    let iterations = 0;
    while (true) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      assert.ok(++iterations < 1000, 'timer scheduling must remain bounded');
      const [id, timer] = next;
      clock = timer.at;
      timers.delete(id);
      timer.callback();
    }
    clock = target;
  }
  t.after(() => sidebar.destroy());
  return { sidebar, root, list, highlight, shape, bubbles, links, selected, animations, timers, tick, doc, win, mobile };
}

test('sidebar hierarchy has a pronounced size falloff and tighter distant spacing', () => {
  const items = getSidebarLayout(7, 3);
  assert.equal(items[3].fontSize, 27);
  assert.equal(items[2].fontSize, 15.5);
  assert.equal(items[1].fontSize, 10.5);
  assert.equal(items[0].fontSize, 9.5);
  assert.equal(items[3].y - items[2].y, 62);
  assert.equal(items[4].y - items[3].y, 68);
  assert.equal(items[1].y - items[0].y, 24);
  assert.equal(items[6].y - items[5].y, 26);
  assert.ok(items.every((item) => item.hitHeight >= 24));
  assert.ok(items[0].opacity < items[1].opacity && items[1].opacity < items[2].opacity);
  assert.deepEqual(items.slice(0, 4).map((item) => item.opacity), [0.55, 0.68, 0.85, 1]);
});

test('hover presentation never moves hit positions, and the current page is distinct from hover', (t) => {
  const f = sidebarFixture(t);
  f.sidebar.setCurrent(1);
  const positions = f.links.map((row) => row.style.getPropertyValue('--nav-y'));
  f.links[3].emit('pointerenter');
  assert.deepEqual(f.links.map((row) => row.style.getPropertyValue('--nav-y')), positions);
  assert.equal(f.links[3].classList.contains('is-highlighted'), true);
  assert.equal(f.links[3].style.getPropertyValue('--nav-font-size'), '27px');
  assert.equal(f.links[1].getAttribute('aria-current'), 'page');
  assert.equal(f.links[3].getAttribute('aria-current'), null);
  f.list.emit('pointerleave');
  assert.equal(f.links[1].classList.contains('is-highlighted'), true);
  assert.equal(f.mobile.textContent, '认识一下');
});

test('bubble slots retain their coordinates after sibling removal and continuously refill', (t) => {
  const f = sidebarFixture(t);
  f.sidebar.setCurrent(1);
  f.links[2].emit('pointerenter');
  f.tick(499);
  assert.equal(f.bubbles.childElementCount, 0);
  f.tick(1);
  const first = f.bubbles.children[0];
  const firstPosition = [first.style.getPropertyValue('--bubble-x'), first.style.getPropertyValue('--bubble-y')];
  assert.equal(first.dataset.slot, '0');
  f.tick(900);
  assert.equal(f.bubbles.childElementCount, 2);
  const second = f.bubbles.children[1];
  const secondPosition = [second.style.getPropertyValue('--bubble-x'), second.style.getPropertyValue('--bubble-y')];
  assert.equal(second.dataset.slot, '1');
  f.tick(1700);
  assert.equal(f.bubbles.childElementCount, 2, 'the fallback must not truncate the 2.6-second decoration animation');
  first.emit('animationend');
  assert.equal(f.bubbles.childElementCount, 1);
  assert.deepEqual([second.style.getPropertyValue('--bubble-x'), second.style.getPropertyValue('--bubble-y')], secondPosition);
  f.tick(1199);
  assert.equal(f.bubbles.children.some((node) => node.dataset.slot === '0'), false,
    'each slot rests between decorations instead of immediately regenerating');
  f.tick(1);
  const replacement = f.bubbles.children.find((node) => node.dataset.slot === '0');
  assert.ok(replacement && replacement !== first);
  assert.deepEqual([replacement.style.getPropertyValue('--bubble-x'), replacement.style.getPropertyValue('--bubble-y')], firstPosition);
  f.tick(10000);
  assert.equal(f.bubbles.maxChildren, 2);
  assert.ok(f.bubbles.childElementCount <= 2);
  f.list.emit('pointerleave');
  assert.equal(f.bubbles.childElementCount, 0);
  assert.equal(f.timers.size, 0);
});

test('rotation resumes the visible interrupted pose and changes direction on exit', (t) => {
  const f = sidebarFixture(t);
  f.links[0].emit('pointerenter');
  assert.match(f.animations[0].frames.at(-1).transform, /rotate\(-360deg\)/);
  f.shape.visibleTransform = 'matrix(0,-1,1,0,0,0)';
  f.links[2].emit('pointerenter');
  assert.equal(f.animations[0].cancelled, true);
  assert.match(f.animations[1].frames[0].transform, /rotate\(-90deg\)/);
  assert.match(f.animations[1].frames.at(-1).transform, /rotate\(-450deg\)/);
  f.list.emit('pointerleave');
  assert.equal(f.animations[1].cancelled, true);
  assert.match(f.animations[2].frames.at(-1).transform, /rotate\(270deg\)/);
  assert.ok(f.animations.every((animation) => animation.options.duration === 450));
  assert.equal(f.animations.filter((animation) => !animation.cancelled).length, 1);
});

test('focus takes over visually while touch focus and reduced motion avoid decorative loops', (t) => {
  const f = sidebarFixture(t, { motionReduced: true });
  f.sidebar.setCurrent(1);
  f.links[3].emit('focus');
  assert.equal(f.links[3].classList.contains('is-highlighted'), true);
  assert.equal(f.animations.length, 0);
  f.tick(3000);
  assert.equal(f.bubbles.childElementCount, 0);
  f.list.emit('focusout');
  assert.equal(f.links[1].classList.contains('is-highlighted'), true);
  f.root.emit('pointerdown', { pointerType: 'touch' });
  f.links[2].emit('pointerenter', { pointerType: 'touch' });
  f.links[2].emit('focus');
  assert.equal(f.links[1].classList.contains('is-highlighted'), true);
});

test('refresh adapts the compact clover to translated label width and destruction clears all work', (t) => {
  const f = sidebarFixture(t);
  f.links[0].querySelector('span').textContent = '庭';
  f.sidebar.refresh();
  assert.equal(f.highlight.style.getPropertyValue('--highlight-size'), '105px');
  f.links[0].querySelector('span').textContent = '庭の入り口です';
  f.sidebar.refresh();
  assert.equal(f.highlight.style.getPropertyValue('--highlight-size'), '115px');
  assert.match(f.shape.innerHTML, /sidebar-clover-shadow/);
  f.links[2].emit('pointerenter');
  f.tick(500);
  f.doc.hidden = true;
  f.doc.emit('visibilitychange');
  assert.equal(f.timers.size, 0);
  assert.equal(f.bubbles.childElementCount, 0);
  f.doc.hidden = false;
  f.doc.emit('visibilitychange');
  assert.ok(f.timers.size > 0);
  f.sidebar.destroy();
  f.tick(5000);
  assert.equal(f.timers.size, 0);
  assert.equal(f.bubbles.childElementCount, 0);
  assert.ok([f.root, f.list, f.doc, f.win, ...f.links].every((node) => [...node.listeners.values()].every((entries) => entries.length === 0)));
});

test('transform decomposition accepts CSS matrices and safe defaults', () => {
  assert.deepEqual(getTransformPose('none'), { rotation: 0, scale: 1 });
  assert.deepEqual(getTransformPose('rotate(-12deg) scale(1.06)'), { rotation: -12, scale: 1.06 });
  assert.deepEqual(getTransformPose('matrix(0,2,-2,0,0,0)'), { rotation: 90, scale: 2 });
});
