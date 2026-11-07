import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWheel, determineActiveIndex, createSectionNavigator } from '../src/navigation.js';

function browserFixture(t, callbacks = {}, { tops = [0, 800, 1600, 2400], documentHeight = 4200, initialY = 0 } = {}) {
  const previousWindow = globalThis.window;
  const listeners = new Map();
  const frames = new Map();
  const classes = new Set();
  const writes = [];
  let clock = 0;
  let frameId = 0;
  const body = { nodeType: 1, scrollHeight: documentHeight, closest: () => null };
  const root = {
    scrollHeight: documentHeight, clientHeight: 800, scrollTop: initialY,
    classList: {
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
      contains: (name) => classes.has(name),
    },
  };
  const win = {
    innerHeight: 800, scrollY: initialY,
    document: { documentElement: root, body, querySelector: () => win.openModal || null },
    performance: { now: () => clock },
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
      writes.push(win.scrollY);
      fire('scroll');
    },
  };
  const sections = tops.map((_, index) => ({
    getBoundingClientRect: () => ({ top: tops[index] - win.scrollY }),
  }));
  function fire(type, fields = {}) {
    const event = {
      target: body, defaultPrevented: false, deltaX: 0, deltaY: 0, deltaMode: 0,
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
    assert.equal(frames.size, 0, 'no animation or scroll-spy loop may leak');
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
  return { nav, win, root, fire, step, drain, active, progress, settled, body, listeners, writes, tops };
}

const programmatic = (fixture) => fixture.root.classList.contains('is-programmatic-scroll');

test('wheel unit conversion remains independent of browser globals', () => {
  assert.equal(normalizeWheel({ deltaY: 70, deltaMode: 0 }, 900), 70);
  assert.equal(normalizeWheel({ deltaY: -3, deltaMode: 1 }, 900, 20), -60);
  assert.equal(normalizeWheel({ deltaY: 1, deltaMode: 2 }, 900), 900);
  assert.equal(normalizeWheel({ deltaY: Number.NaN }), 0);
});

test('scroll spy uses a stable upper-third boundary and handles tall final content', () => {
  const tops = [0, 800, 1600, 2400];
  assert.equal(determineActiveIndex(0, tops, 800), 0);
  assert.equal(determineActiveIndex(500, tops, 800), 0);
  assert.equal(determineActiveIndex(600, tops, 800), 1);
  assert.equal(determineActiveIndex(3400, tops, 800), 3);
  assert.equal(determineActiveIndex(0, [], 800), -1);
});

test('wheel input and inertia remain native without accumulating progress or starting navigation', async (t) => {
  const f = browserFixture(t);
  for (const deltaY of [1, 10, 60, 400, 800, 2000, -300]) {
    assert.equal(f.fire('wheel', { deltaY }).defaultPrevented, false);
    await f.step(30);
  }
  assert.equal(f.writes.length, 0, 'wheel events never create a programmatic scroll');
  assert.equal(f.nav.transitioning, false);
  assert.equal(f.settled.length, 0);
  assert.ok(f.progress.every((amount) => amount === 0));
  f.win.scrollTo({ top: 1234 }); // Emulate the browser's native scroll effect.
  await f.drain();
  assert.equal(f.nav.activeIndex, 1);
  assert.equal(f.win.scrollY, 1234, 'scroll spy must not snap or pull back a native position');
});

test('Arrow, Page, Space, Home, End and repeats are left to the browser', async (t) => {
  const f = browserFixture(t);
  const input = { closest: () => ({}) };
  for (const key of ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'Home', 'End']) {
    assert.equal(f.fire('keydown', { key }).defaultPrevented, false);
    assert.equal(f.fire('keydown', { key, repeat: true }).defaultPrevented, false);
    assert.equal(f.fire('keydown', { key, target: input }).defaultPrevented, false);
  }
  await f.drain();
  assert.equal(f.writes.length, 0);
  assert.equal(f.nav.transitioning, false);
  f.win.scrollTo({ top: 3400 });
  await f.drain();
  assert.equal(f.nav.activeIndex, 3);
});

test('touch movement stays exactly where the browser puts it, including tall content', async (t) => {
  const f = browserFixture(t, {}, { tops: [0, 1200, 2000, 2800], documentHeight: 4600 });
  assert.equal(f.fire('touchstart', { touches: [{ clientX: 100, clientY: 500 }] }).defaultPrevented, false);
  f.win.scrollTo({ top: 350 });
  f.fire('touchend', { changedTouches: [{ clientX: 100, clientY: 100 }] });
  await f.drain();
  assert.equal(f.win.scrollY, 350, 'touchend must not force a whole-screen move');
  assert.equal(f.nav.activeIndex, 0);
  f.win.scrollTo({ top: 1100 });
  f.fire('touchend', { changedTouches: [{ clientX: 400, clientY: 100 }] });
  await f.drain();
  assert.equal(f.win.scrollY, 1100);
  assert.equal(f.nav.activeIndex, 1);
  assert.equal(f.settled.length, 0);
});

test('explicit navigation animates for 520ms, follows the visible section, and restores snap', async (t) => {
  const f = browserFixture(t);
  const pending = f.nav.goTo(2, { source: 'nav' });
  assert.equal(programmatic(f), true);
  assert.equal(f.nav.activeIndex, 0, 'starting a click does not select an off-screen section');
  await f.step(260);
  assert.ok(f.win.scrollY > 700 && f.win.scrollY < 900);
  await f.step(16);
  assert.equal(f.nav.activeIndex, 1, 'scroll spy tracks the section actually passing through the viewport');
  await f.drain();
  assert.equal(await pending, true);
  assert.equal(f.win.scrollY, 1600);
  assert.equal(f.nav.activeIndex, 2);
  assert.equal(f.nav.transitioning, false);
  assert.equal(programmatic(f), false);
  assert.deepEqual(f.settled, [[2, 'nav']]);
  assert.ok(f.progress.length && f.progress.every((amount) => amount === 0));
});

test('new vertical wheel input cancels a click animation immediately and is not consumed', async (t) => {
  let signal;
  const f = browserFixture(t, { onBeforeNavigate: (_, details) => { signal = details.signal; } });
  const pending = f.nav.goTo(3);
  await f.step(150);
  const event = f.fire('wheel', { deltaY: 30 });
  assert.equal(event.defaultPrevented, false);
  assert.equal(await pending, false);
  assert.equal(signal.aborted, true);
  assert.equal(programmatic(f), false);
  assert.equal(f.nav.transitioning, false);
  f.win.scrollTo({ top: 950 });
  await f.drain();
  assert.equal(f.win.scrollY, 950);
  assert.equal(f.nav.activeIndex, 1);
  assert.equal(f.settled.length, 0);
});

test('horizontal wheel gestures and modifier zoom are untouched', async (t) => {
  const f = browserFixture(t);
  const pending = f.nav.goTo(1);
  await f.step(100);
  for (const fields of [
    { deltaX: 100, deltaY: 10 }, { deltaY: 100, ctrlKey: true },
    { deltaY: 100, metaKey: true }, { deltaY: 0 },
  ]) assert.equal(f.fire('wheel', fields).defaultPrevented, false);
  assert.equal(f.nav.transitioning, true);
  await f.drain();
  assert.equal(await pending, true);
});

test('touchstart and scrollbar pointer input cancel programmatic movement without a later touch snap', async (t) => {
  const f = browserFixture(t);
  const first = f.nav.goTo(2);
  await f.step(100);
  assert.equal(f.fire('touchstart', { touches: [{ clientX: 100, clientY: 500 }] }).defaultPrevented, false);
  assert.equal(await first, false);
  assert.equal(programmatic(f), false);
  f.win.scrollTo({ top: 420 });
  f.fire('touchend', { changedTouches: [{ clientX: 100, clientY: 100 }] });
  await f.drain();
  assert.equal(f.win.scrollY, 420);
  const second = f.nav.goTo(3);
  await f.step(100);
  f.fire('pointerdown');
  assert.equal(await second, false);
  f.win.scrollTo({ top: 2500 });
  await f.drain();
  assert.equal(f.nav.activeIndex, 3);
  assert.equal(programmatic(f), false);
});

test('Escape works from focused buttons while ordinary scroll keys keep their native defaults', async (t) => {
  const f = browserFixture(t);
  const button = { closest: () => ({}) };
  const pending = f.nav.goTo(3);
  await f.step(100);
  assert.equal(f.fire('keydown', { key: 'Escape', target: button }).defaultPrevented, false);
  assert.equal(await pending, false);
  assert.equal(programmatic(f), false);
  const next = f.nav.goTo(2);
  await f.step(100);
  assert.equal(f.fire('keydown', { key: 'PageDown' }).defaultPrevented, false);
  assert.equal(await next, false);
  const stopped = f.win.scrollY;
  await f.drain();
  assert.equal(f.win.scrollY, stopped);
});

test('new navigation aborts a pending asynchronous hook, retaining only the latest target', async (t) => {
  const waiting = [];
  const f = browserFixture(t, {
    reducedMotion: () => true,
    onBeforeNavigate: (index, details) => new Promise((release) => waiting.push({ index, details, release })),
  });
  const first = f.nav.goTo(1, { source: 'explore' });
  assert.equal(programmatic(f), true, 'snap is disabled during the before hook too');
  const second = f.nav.goTo(2);
  assert.equal(await first, false);
  assert.equal(waiting[0].details.signal.aborted, true);
  assert.equal(programmatic(f), true, 'old cleanup must not clear the new navigation state');
  waiting[0].release();
  await Promise.resolve();
  assert.equal(f.writes.length, 0);
  waiting[1].release();
  assert.equal(await second, true);
  assert.equal(f.win.scrollY, 1600);
  assert.equal(programmatic(f), false);
});

test('modal input cancels pending navigation but remains available to the modal itself', async (t) => {
  let release;
  const f = browserFixture(t, {
    onBeforeNavigate: () => new Promise((resolve) => { release = resolve; }),
  });
  const pending = f.nav.goTo(2);
  f.win.openModal = {};
  assert.equal(f.fire('wheel', { deltaY: 1200 }).defaultPrevented, false);
  assert.equal(await pending, false);
  assert.equal(programmatic(f), false);
  assert.equal(f.fire('keydown', { key: 'Escape' }).defaultPrevented, false);
  assert.equal(f.fire('touchstart', { touches: [] }).defaultPrevented, false);
  release();
  await f.drain();
  assert.equal(f.win.scrollY, 0);
  assert.equal(f.settled.length, 0);
});

test('reduced motion and animate:false locate immediately after the hook', async (t) => {
  const f = browserFixture(t, { reducedMotion: () => true });
  assert.equal(await f.nav.goTo(3), true);
  assert.equal(f.win.scrollY, 2400);
  assert.equal(programmatic(f), false);
  assert.equal(await f.nav.goTo(0, { animate: false }), true);
  assert.equal(f.win.scrollY, 0);
  assert.equal(f.nav.transitioning, false);
});

test('refresh and initial restored positions update selection without forcing scroll offsets', async (t) => {
  const f = browserFixture(t, {}, { initialY: 1700 });
  await f.drain();
  assert.equal(f.nav.activeIndex, 2);
  assert.equal(f.writes.length, 0);
  f.tops[1] = 1000;
  f.tops[2] = 2200;
  f.tops[3] = 3000;
  f.nav.refresh();
  assert.equal(f.nav.activeIndex, 1);
  assert.equal(f.win.scrollY, 1700);
  assert.equal(f.writes.length, 0);
  assert.equal(f.fire('wheel', { deltaY: -20 }).defaultPrevented, false);
});

test('failed hooks and destruction release promises, CSS state and all event listeners', async (t) => {
  let shouldFail = true;
  const f = browserFixture(t, {
    onBeforeNavigate: () => { if (shouldFail) throw new Error('wipe failed'); },
  });
  await assert.rejects(f.nav.goTo(1), /wipe failed/);
  assert.equal(f.nav.transitioning, false);
  assert.equal(programmatic(f), false);
  shouldFail = false;
  const pending = f.nav.goTo(2);
  await f.step(80);
  f.nav.destroy();
  assert.equal(await pending, false);
  assert.equal(f.nav.transitioning, false);
  assert.equal(programmatic(f), false);
  assert.equal(await f.nav.goTo(1), false);
  assert.equal([...f.listeners.values()].every((set) => set.size === 0), true);
  await f.drain();
});
