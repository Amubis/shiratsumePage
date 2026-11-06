import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeWheel, accumulateProgress, determineActiveIndex, createSectionNavigator,
} from '../src/navigation.js';

function browserFixture(t, callbacks = {}, { tops = [0, 800, 1600, 2400], documentHeight = 4200 } = {}) {
  const previousWindow = globalThis.window;
  const listeners = new Map();
  const frames = new Map();
  let clock = 0;
  let frameId = 0;
  const body = { nodeType: 1, scrollHeight: documentHeight, parentElement: null, closest: () => null };
  const root = { scrollHeight: documentHeight, clientHeight: 800, scrollTop: 0 };
  const win = {
    innerHeight: 800, scrollY: 0,
    document: { documentElement: root, body, querySelector: () => win.openModal || null },
    performance: { now: () => clock },
    console: { error: (error) => { throw error; } },
    getComputedStyle: (element) => ({ overflowY: element.overflowY || 'visible' }),
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    scrollTo({ top }) {
      win.scrollY = Math.max(0, Math.min(root.scrollHeight - win.innerHeight, top));
      root.scrollTop = win.scrollY;
      fire('scroll');
    },
  };
  const sections = tops.map((top) => ({
    getBoundingClientRect: () => ({ top: top - win.scrollY }),
  }));
  function fire(type, fields = {}) {
    const event = {
      target: body, defaultPrevented: false, deltaY: 0, deltaMode: 0,
      preventDefault() { this.defaultPrevented = true; }, ...fields,
    };
    for (const listener of [...(listeners.get(type) || [])]) listener(event);
    return event;
  }
  async function step(milliseconds = 16) {
    await Promise.resolve();
    clock += milliseconds;
    const queued = [...frames.values()];
    frames.clear();
    for (const callback of queued) callback(clock);
    await Promise.resolve();
  }
  async function drain() {
    await Promise.resolve();
    for (let count = 0; count < 100 && frames.size; count += 1) await step(32);
    assert.equal(frames.size, 0, 'animation must finish instead of leaking a frame loop');
  }
  globalThis.window = win;
  const active = [];
  const progress = [];
  const settled = [];
  const nav = createSectionNavigator({
    sections,
    onActive: (index, details) => active.push([index, details.source]),
    onProgress: (amount) => progress.push(amount),
    onSettled: (index, details) => settled.push([index, details.source]),
    ...callbacks,
  });
  t.after(() => { nav.destroy(); globalThis.window = previousWindow; });
  return { nav, win, fire, step, drain, active, progress, settled, body, listeners };
}

test('wheel normalization preserves pixel intent for line and page devices', () => {
  assert.equal(normalizeWheel({ deltaY: 70, deltaMode: 0 }, 900), 70);
  assert.equal(normalizeWheel({ deltaY: -3, deltaMode: 1 }, 900, 20), -60);
  assert.equal(normalizeWheel({ deltaY: 1, deltaMode: 2 }, 900), 900);
  assert.equal(normalizeWheel({ deltaY: Number.NaN }), 0);
});

test('resistance accumulation cancels opposite input and caps large bursts', () => {
  assert.equal(accumulateProgress(500, -200, 800), 300);
  assert.equal(accumulateProgress(300, -500, 800), -200);
  assert.equal(accumulateProgress(0, 5000, 800), 800);
  assert.equal(accumulateProgress(0, -5000, 800), -800);
  assert.equal(accumulateProgress(10, 20, 0), 0);
});

test('scroll spy follows the upper-third threshold and keeps a tall last screen active', () => {
  const tops = [0, 800, 1600, 2400];
  assert.equal(determineActiveIndex(0, tops, 800), 0);
  assert.equal(determineActiveIndex(500, tops, 800), 0);
  assert.equal(determineActiveIndex(600, tops, 800), 1);
  assert.equal(determineActiveIndex(3400, tops, 800), 3);
  assert.equal(determineActiveIndex(0, [], 800), -1);
});

test('wheel resistance needs a full viewport and does not chain through inertia', async (t) => {
  const f = browserFixture(t, { reducedMotion: () => true });
  assert.equal(f.fire('wheel', { deltaY: 400 }).defaultPrevented, true);
  assert.equal(f.nav.activeIndex, 0);
  assert.equal(f.progress.at(-1), 0.5);
  f.fire('wheel', { deltaY: -200 });
  assert.equal(f.progress.at(-1), 0.25);
  f.fire('wheel', { deltaY: 600 });
  await f.drain();
  assert.equal(f.nav.activeIndex, 1);
  assert.equal(f.win.scrollY, 800);
  assert.equal(f.progress.at(-1), 0);
  f.fire('wheel', { deltaY: 2000 });
  await f.drain();
  assert.equal(f.nav.activeIndex, 1, 'same-gesture residual delta cannot skip a screen');
  await f.step(200);
  f.fire('wheel', { deltaY: 800 });
  await f.drain();
  assert.equal(f.nav.activeIndex, 2);
});

test('last screen scrolls natively and clamps at its top before reverse navigation', async (t) => {
  const f = browserFixture(t, { reducedMotion: () => true });
  await f.nav.goTo(3);
  assert.equal(f.fire('wheel', { deltaY: 300 }).defaultPrevented, false);
  f.win.scrollTo({ top: 2600 });
  await f.drain();
  assert.equal(f.fire('wheel', { deltaY: -500 }).defaultPrevented, true);
  assert.equal(f.win.scrollY, 2400);
  assert.equal(f.nav.activeIndex, 3);
  f.fire('wheel', { deltaY: -800 });
  await f.drain();
  assert.equal(f.nav.activeIndex, 2);
  assert.equal(f.win.scrollY, 1600);
});

test('scrollable children keep their wheel input until reaching the boundary', async (t) => {
  const f = browserFixture(t, { reducedMotion: () => true });
  const child = {
    nodeType: 1, overflowY: 'auto', scrollHeight: 1000, clientHeight: 200,
    scrollTop: 100, closest: () => null, parentElement: f.body,
  };
  assert.equal(f.fire('wheel', { target: child, deltaY: 800 }).defaultPrevented, false);
  assert.equal(f.nav.activeIndex, 0);
  child.scrollTop = 800;
  assert.equal(f.fire('wheel', { target: child, deltaY: 800 }).defaultPrevented, true);
  await f.drain();
  assert.equal(f.nav.activeIndex, 1);
});

test('a newer navigation aborts an asynchronous pre-transition hook safely', async (t) => {
  const waiting = [];
  const f = browserFixture(t, {
    reducedMotion: () => true,
    onBeforeNavigate: (index, details) => new Promise((release) => waiting.push({ index, details, release })),
  });
  const first = f.nav.goTo(1, { source: 'explore' });
  const second = f.nav.goTo(2);
  assert.equal(await first, false);
  assert.equal(waiting[0].details.signal.aborted, true);
  waiting[0].release();
  await Promise.resolve();
  assert.equal(f.win.scrollY, 0);
  waiting[1].release();
  assert.equal(await second, true);
  assert.equal(f.win.scrollY, 1600);
  assert.equal(f.nav.transitioning, false);
});

test('keyboard navigation replaces an animation and never steals form or button keys', async (t) => {
  const f = browserFixture(t);
  const first = f.nav.goTo(3);
  await f.step(100);
  assert.equal(f.nav.transitioning, true);
  const input = { closest: (selector) => selector.includes('input') ? {} : null };
  const button = { closest: (selector) => selector.includes('button') ? {} : null };
  assert.equal(f.fire('keydown', { key: 'ArrowDown', target: input }).defaultPrevented, false);
  assert.equal(f.fire('keydown', { key: ' ', target: button }).defaultPrevented, false);
  assert.equal(f.fire('keydown', { key: 'Home' }).defaultPrevented, true);
  assert.equal(await first, false);
  await f.drain();
  assert.equal(f.win.scrollY, 0);
  assert.equal(f.nav.activeIndex, 0);
  assert.equal(f.nav.transitioning, false);
  f.fire('keydown', { key: 'End' });
  await f.drain();
  assert.equal(f.win.scrollY, 3400, 'End includes the bottom of the tall final section');
  assert.equal(f.nav.activeIndex, 3);
});

test('scrollbar/native scrolling updates current section and pointer input releases an animation', async (t) => {
  const f = browserFixture(t);
  const navigation = f.nav.goTo(2);
  await f.step(100);
  f.fire('pointerdown');
  assert.equal(await navigation, false);
  f.win.scrollTo({ top: 2500 });
  await f.drain();
  assert.equal(f.nav.activeIndex, 3);
  assert.equal(f.nav.transitioning, false);
});

test('a natural vertical touch gesture snaps one adjacent screen, while horizontal/control gestures do not', async (t) => {
  const f = browserFixture(t, { reducedMotion: () => true });
  f.fire('touchstart', { touches: [{ clientX: 100, clientY: 500 }] });
  f.win.scrollTo({ top: 300 });
  f.fire('touchend', { changedTouches: [{ clientX: 105, clientY: 300 }] });
  await f.drain();
  assert.equal(f.nav.activeIndex, 1);
  assert.equal(f.win.scrollY, 800);
  f.fire('touchstart', { touches: [{ clientX: 100, clientY: 500 }] });
  f.fire('touchend', { changedTouches: [{ clientX: 350, clientY: 450 }] });
  await f.drain();
  assert.equal(f.nav.activeIndex, 1);
  const control = { closest: () => ({}) };
  f.fire('touchstart', { target: control, touches: [{ clientX: 100, clientY: 500 }] });
  f.fire('touchend', { changedTouches: [{ clientX: 100, clientY: 100 }] });
  await f.drain();
  assert.equal(f.nav.activeIndex, 1);
});

test('failed hooks and destruction do not leave pending promises or navigation locks', async (t) => {
  let shouldFail = true;
  const f = browserFixture(t, {
    onBeforeNavigate: () => { if (shouldFail) throw new Error('wipe failed'); },
  });
  await assert.rejects(f.nav.goTo(1), /wipe failed/);
  assert.equal(f.nav.transitioning, false);
  shouldFail = false;
  const pending = f.nav.goTo(2);
  await f.step(80);
  f.nav.destroy();
  assert.equal(await pending, false);
  assert.equal(f.nav.transitioning, false);
  assert.equal(await f.nav.goTo(1), false);
  assert.equal([...f.listeners.values()].every((set) => set.size === 0), true);
  await f.drain();
});

test('open modals own wheel, key and touch input and cancel any underlying transition', async (t) => {
  const f = browserFixture(t, { reducedMotion: () => true });
  f.fire('wheel', { deltaY: 400 });
  assert.equal(f.progress.at(-1), 0.5);
  f.win.openModal = {};
  assert.equal(f.fire('wheel', { deltaY: 1600 }).defaultPrevented, false);
  assert.equal(f.progress.at(-1), 0);
  assert.equal(f.fire('keydown', { key: 'End' }).defaultPrevented, false);
  f.fire('touchstart', { touches: [{ clientX: 100, clientY: 500 }] });
  f.fire('touchend', { changedTouches: [{ clientX: 100, clientY: 100 }] });
  await f.drain();
  assert.equal(f.nav.activeIndex, 0);
  assert.equal(f.win.scrollY, 0);
  f.win.openModal = null;
  f.fire('touchstart', { touches: [{ clientX: 100, clientY: 500 }] });
  f.win.openModal = {};
  f.fire('touchend', { changedTouches: [{ clientX: 100, clientY: 100 }] });
  await f.drain();
  assert.equal(f.nav.activeIndex, 0, 'a modal opened during a gesture owns the gesture end as well');
});

test('modal Escape cancels a pending transition without consuming native dialog dismissal', async (t) => {
  let release;
  const f = browserFixture(t, {
    onBeforeNavigate: () => new Promise((resolve) => { release = resolve; }),
  });
  const pending = f.nav.goTo(2);
  assert.equal(f.nav.transitioning, true);
  f.win.openModal = {};
  const escape = f.fire('keydown', { key: 'Escape' });
  assert.equal(escape.defaultPrevented, false, 'modal Escape remains available to native dialog behavior');
  assert.equal(await pending, false);
  assert.equal(f.nav.transitioning, false);
  release();
  await f.drain();
  assert.equal(f.win.scrollY, 0);
});

test('Escape interrupts navigation even while a button keeps focus', async (t) => {
  const f = browserFixture(t);
  const pending = f.nav.goTo(3);
  await f.step(100);
  assert.equal(f.nav.transitioning, true);
  const button = { closest: (selector) => selector.includes('button') ? {} : null };
  const event = f.fire('keydown', { key: 'Escape', target: button });
  assert.equal(event.defaultPrevented, false);
  assert.equal(await pending, false);
  assert.equal(f.nav.transitioning, false);
  const stoppedAt = f.win.scrollY;
  await f.drain();
  assert.equal(f.win.scrollY, stoppedAt);
});

test('a tall middle section permits interior wheel scrolling before either page boundary', async (t) => {
  const f = browserFixture(t, { reducedMotion: () => true }, {
    tops: [0, 800, 2000, 2800], documentHeight: 4600,
  });
  await f.nav.goTo(1);
  assert.equal(f.fire('wheel', { deltaY: 200 }).defaultPrevented, false);
  f.win.scrollTo({ top: 1000 });
  await f.drain();
  assert.equal(f.fire('wheel', { deltaY: 500 }).defaultPrevented, true);
  assert.equal(f.win.scrollY, 1200, 'large deltas stop at the interior bottom before accumulating page intent');
  f.fire('wheel', { deltaY: 400 });
  assert.equal(f.nav.activeIndex, 1);
  assert.equal(f.progress.at(-1), 0.5);
  f.fire('wheel', { deltaY: -200 });
  assert.equal(f.progress.at(-1), 0.25);
  assert.equal(f.win.scrollY, 1200, 'opposite input cancels edge resistance before scrolling interior content');
  f.fire('wheel', { deltaY: 600 });
  await f.drain();
  assert.equal(f.nav.activeIndex, 2);
  assert.equal(f.win.scrollY, 2000);

  await f.nav.goTo(1);
  f.win.scrollTo({ top: 1000 });
  await f.drain();
  assert.equal(f.fire('wheel', { deltaY: -500 }).defaultPrevented, true);
  assert.equal(f.win.scrollY, 800);
  f.fire('wheel', { deltaY: -800 });
  await f.drain();
  assert.equal(f.nav.activeIndex, 0);
});

test('tall section content remains readable through touch and keyboard navigation', async (t) => {
  const f = browserFixture(t, { reducedMotion: () => true }, {
    tops: [0, 1200, 2000, 2800], documentHeight: 4600,
  });
  f.fire('touchstart', { touches: [{ clientX: 100, clientY: 500 }] });
  f.win.scrollTo({ top: 200 });
  f.fire('touchend', { changedTouches: [{ clientX: 100, clientY: 300 }] });
  await f.drain();
  assert.equal(f.win.scrollY, 200, 'an interior swipe does not jump past unread content');
  assert.equal(f.nav.activeIndex, 0);
  f.fire('keydown', { key: 'PageDown' });
  await f.drain();
  assert.equal(f.win.scrollY, 400, 'PageDown first reaches the tall section interior bottom');
  assert.equal(f.nav.activeIndex, 0);
  f.fire('keydown', { key: 'PageDown' });
  await f.drain();
  assert.equal(f.win.scrollY, 1200);
  assert.equal(f.nav.activeIndex, 1);
});
