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

test('chapter wheel hooks own progress without cancelling their covered navigation handoff', async (t) => {
  const samples=[];
  let resolveCover;
  const f=browserFixture(t,{
    onChapterWheel(details){samples.push(details);return true;},
    onBeforeNavigate(){return new Promise(resolve=>{resolveCover=resolve;});},
  },{initialY:800});
  await f.step();
  assert.equal(f.fire('wheel',{deltaY:120}).defaultPrevented,true);
  assert.deepEqual(samples.at(-1),{delta:120,from:1,destination:2});
  assert.equal(f.writes.length,0);
  const handoff=f.nav.goTo(2,{source:'album-scroll',animate:false});
  assert.equal(f.fire('wheel',{deltaY:80}).defaultPrevented,true);
  assert.equal(f.nav.transitioning,true,'ongoing progress input must not abort its own handoff');
  resolveCover({animate:false});
  assert.equal(await handoff,true);
  assert.equal(f.win.scrollY,1600);
  const count=samples.length;
  assert.equal(f.fire('wheel',{deltaY:50,ctrlKey:true}).defaultPrevented,false);
  assert.equal(f.fire('wheel',{deltaY:20,deltaX:80}).defaultPrevented,false);
  assert.equal(samples.length,count,'zoom and horizontal input stay outside the hook');
});

test('chapter intent receives the original native event time rather than the delayed handler time', async (t) => {
  const samples = [];
  const f = browserFixture(t, { onChapterWheel(details) { samples.push(details); return true; } }, { initialY: 800 });
  await f.step(300);
  f.fire('wheel', { deltaY: 120, timeStamp: 42 });
  assert.equal(samples.at(-1).timeStamp, 42);
  assert.equal(samples.at(-1).from, 1);
  assert.equal(samples.at(-1).destination, 2);
});

test('reading stays native before a tall chapter reaches the next boundary', async(t)=>{
  const samples=[];
  let interrupted=0;
  const f=browserFixture(t,{onChapterWheel(details){samples.push(details);return false;},onInterrupt(){interrupted++;}},{tops:[0,800,2000,2800],initialY:800});
  await f.step();
  assert.equal(f.fire('wheel',{deltaY:60}).defaultPrevented,false);
  assert.equal(samples.at(-1).destination,null);
  f.fire('pointerdown');
  assert.equal(interrupted,1);
});

test('a previous chapter gesture cannot start the album hook with its remaining inertia', async(t)=>{
  const arrivals=[];
  const f=browserFixture(t,{
    onChapterWheel({from},{allowStart}){
      if(from===1){arrivals.push(allowStart);return allowStart;}
      return false;
    },
  });
  f.fire('wheel',{deltaY:120});
  for(let i=0;i<12;i++){
    await f.step(70);
    f.fire('wheel',{deltaY:20});
  }
  assert.equal(f.nav.activeIndex,1);
  assert.ok(arrivals.length>0);
  assert.ok(arrivals.every(allowed=>!allowed),'the inherited gesture remains locked');
  await f.step(240);
  f.fire('wheel',{deltaY:100});
  assert.equal(arrivals.at(-1),true,'a fresh gesture can start the album buffer');
});

test('wheel shows short resistance, then advances exactly one chapter per gesture', async (t) => {
  const f = browserFixture(t);
  assert.equal(f.fire('wheel', { deltaY: 24 }).defaultPrevented, true);
  assert.equal(f.writes.length, 0);
  assert.equal(f.progress.at(-1), 24 / 64);
  await f.step(40);
  assert.equal(f.fire('wheel', { deltaY: 44 }).defaultPrevented, true);
  assert.equal(f.progress.at(-1), 1);
  assert.equal(f.writes.length, 0, 'resistance has a visible preview before moving');
  await f.step(40);
  assert.equal(f.nav.transitioning, true);
  for (let i = 0; i < 10; i += 1) {
    await f.step(90);
    assert.equal(f.fire('wheel', { deltaY: 20 }).defaultPrevented, true);
  }
  await f.drain();
  assert.equal(f.nav.activeIndex, 1);
  assert.equal(f.win.scrollY, 800);
  assert.deepEqual(f.settled, [[1, 'wheel']], 'inertial wheel tail cannot start another turn');
  await f.step(240);
  f.fire('wheel', { deltaY: 120 });
  await f.drain();
  assert.equal(f.win.scrollY, 1600, 'a fresh gesture starts the next chapter');
});

test('incomplete resistance releases without moving and reverses direction cleanly', async (t) => {
  const f = browserFixture(t, {}, { initialY: 800 });
  f.fire('wheel', { deltaY: 20 });
  await f.step(30);
  f.fire('wheel', { deltaY: -20 });
  assert.equal(f.progress.at(-1), -20 / 64);
  await f.drain();
  assert.equal(f.win.scrollY, 800);
  assert.equal(f.progress.at(-1), 0);
  assert.equal(f.settled.length, 0);
});

test('keyboard chapter controls ignore repeats and preserve interactive controls', async (t) => {
  const f = browserFixture(t);
  const input = { closest: () => ({}) };
  for (const key of ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'Home', 'End']) {
    assert.equal(f.fire('keydown', { key, target: input }).defaultPrevented, false);
  }
  assert.equal(f.fire('keydown', { key: 'PageDown' }).defaultPrevented, true);
  for (let i = 0; i < 6; i += 1) f.fire('keydown', { key: 'PageDown', repeat: true });
  await f.drain();
  assert.equal(f.win.scrollY, 800);
  f.fire('keydown', { key: 'End' });
  await f.drain();
  assert.equal(f.nav.activeIndex, 3);
  assert.equal(f.fire('keydown', { key: 'End' }).defaultPrevented, false, 'End can reach the actual document bottom from the final chapter');
  f.fire('keydown', { key: 'Home' });
  await f.drain();
  assert.equal(f.win.scrollY, 0);
  f.fire('keydown', { key: ' ', shiftKey: false });
  await f.drain();
  f.fire('keydown', { key: ' ', shiftKey: true });
  await f.drain();
  assert.equal(f.win.scrollY, 0);
});

test('coarse pointers, forms and nested scrollers retain native wheel movement', async (t) => {
  const f = browserFixture(t);
  f.win.matchMedia = () => ({ matches: false });
  assert.equal(f.fire('wheel', { deltaY: 120 }).defaultPrevented, false);
  f.win.matchMedia = () => ({ matches: true });
  assert.equal(f.fire('wheel', { deltaY: 120, cancelable: false }).defaultPrevented, false);
  const input = { closest: () => ({}) };
  assert.equal(f.fire('wheel', { deltaY: 120, target: input }).defaultPrevented, false);
  f.win.getComputedStyle = () => ({ overflowY: 'auto' });
  const nested = { closest: () => null, scrollHeight: 800, clientHeight: 200, parentElement: f.body };
  assert.equal(f.fire('wheel', { deltaY: 120, target: nested }).defaultPrevented, false);
  await f.drain();
  assert.equal(f.writes.length, 0);
});

test('tall and final chapters stay readable before an upward chapter turn', async (t) => {
  const f = browserFixture(t, {}, { tops: [0, 1200, 2000, 2800], documentHeight: 4600 });
  assert.equal(f.fire('wheel', { deltaY: 120 }).defaultPrevented, false, 'tall first chapter reads naturally');
  f.win.scrollTo({ top: 320 });
  assert.equal(f.fire('wheel', { deltaY: -120 }).defaultPrevented, false, 'tall first chapter can scroll back to its top');
  f.win.scrollTo({ top: 400 });
  assert.equal(f.fire('wheel', { deltaY: 120 }).defaultPrevented, true, 'after tall content, the next chapter has a clear turn');
  await f.drain();
  assert.equal(f.win.scrollY, 1200);
  f.win.scrollTo({ top: 3500 });
  assert.equal(f.fire('wheel', { deltaY: 120 }).defaultPrevented, false);
  assert.equal(f.fire('wheel', { deltaY: -120 }).defaultPrevented, false, 'final content reads upward too');
  f.win.scrollTo({ top: 2800 });
  assert.equal(f.fire('wheel', { deltaY: -120 }).defaultPrevented, true);
  await f.drain();
  assert.equal(f.win.scrollY, 2000);
});

test('an oversized upward wheel from final content stops at its own chapter start', async (t) => {
  const f = browserFixture(t, {}, { initialY: 3000 });
  assert.equal(f.fire('wheel', { deltaY: -1800 }).defaultPrevented, true);
  assert.equal(f.win.scrollY, 2400);
  for (let i = 0; i < 5; i += 1) {
    await f.step(70);
    assert.equal(f.fire('wheel', { deltaY: -100 }).defaultPrevented, true);
  }
  assert.equal(f.win.scrollY, 2400, 'inertia cannot escape the boundary clamp');
  await f.step(240);
  f.fire('wheel', { deltaY: -120 });
  await f.drain();
  assert.equal(f.win.scrollY, 1600, 'a fresh gesture turns to the previous chapter');
  f.win.scrollTo({ top: 3000 });
  await f.step(240);
  assert.equal(f.fire('wheel', { deltaY: 5000 }).defaultPrevented, false, 'final downward scrolling remains native to the document end');
});

test('oversized reading input stops at both edges of a tall intermediate chapter', async (t) => {
  const f = browserFixture(t, {}, { tops: [0, 800, 2200, 3000], documentHeight: 4800, initialY: 950 });
  assert.equal(f.fire('wheel', { deltaY: 200 }).defaultPrevented, false, 'interior reading stays native');
  assert.equal(f.fire('wheel', { deltaY: 2000 }).defaultPrevented, true);
  assert.equal(f.win.scrollY, 1400, 'the last viewport of the same chapter is fully visible');
  await f.step(80);
  f.fire('wheel', { deltaY: 300 });
  assert.equal(f.win.scrollY, 1400);
  await f.step(240);
  f.fire('wheel', { deltaY: -2000 });
  assert.equal(f.win.scrollY, 800, 'oversized reverse reading stops at the chapter start');
  await f.step(240);
  f.fire('wheel', { deltaY: -120 });
  await f.drain();
  assert.equal(f.win.scrollY, 0);
  f.win.scrollTo({ top: 950 });
  await f.step(240);
  f.fire('wheel', { deltaY: 2000 });
  await f.step(240);
  f.fire('wheel', { deltaY: 120 });
  await f.drain();
  assert.equal(f.win.scrollY, 2200, 'after the bottom edge, a fresh gesture turns forward');
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

test('Escape cancels navigation even while a button is focused', async (t) => {
  const f = browserFixture(t);
  const button = { closest: () => ({}) };
  const pending = f.nav.goTo(3);
  await f.step(100);
  assert.equal(f.fire('keydown', { key: 'Escape', target: button }).defaultPrevented, false);
  assert.equal(await pending, false);
  assert.equal(programmatic(f), false);
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

test('a completed covering transition skips scrolling even when the caller requests animation', async (t) => {
  let release;
  let preparationDetails;
  const f = browserFixture(t, {
    onBeforeNavigate: (_, details) => {
      preparationDetails = details;
      return new Promise((resolve) => { release = resolve; });
    },
  });
  const pending = f.nav.goTo(2, { animate: true, source: 'album-cover' });
  assert.equal(programmatic(f), true);
  assert.deepEqual(f.writes, [], 'the current page stays in place while the cover is preparing');
  assert.equal(preparationDetails.from, 0);
  assert.equal(preparationDetails.signal.aborted, false);

  release({ animate: false });
  await Promise.resolve();
  assert.deepEqual(f.writes, [1600], 'the covered page jumps to its destination without an animation frame');
  assert.equal(await pending, true);
  assert.equal(f.nav.activeIndex, 2);
  assert.equal(f.nav.transitioning, false);
  assert.equal(programmatic(f), false);
  assert.deepEqual(f.settled, [[2, 'album-cover']]);
  await f.drain();
  assert.deepEqual(f.writes, [1600], 'no delayed scroll animation may run after the cover hands off');
});

test('an aborted covering transition cannot jump when its hook later returns animate:false', async (t) => {
  let release;
  let signal;
  const f = browserFixture(t, {
    onBeforeNavigate: (_, details) => {
      signal = details.signal;
      return new Promise((resolve) => { release = resolve; });
    },
  });
  const pending = f.nav.goTo(2, { animate: true });
  assert.equal(f.fire('wheel', { deltaY: 45 }).defaultPrevented, false);
  assert.equal(await pending, false);
  assert.equal(signal.aborted, true);
  assert.equal(programmatic(f), false);
  assert.equal(f.nav.transitioning, false);

  release({ animate: false });
  await f.drain();
  assert.deepEqual(f.writes, [], 'the obsolete cover result must not write a destination or consume native input');
  assert.equal(f.nav.activeIndex, 0);
  assert.deepEqual(f.settled, []);
});

test('a deep-link handoff still initializes the view when the browser already restored that chapter', async (t) => {
  const f = browserFixture(t, {}, { initialY: 2400 });
  const navigation = f.nav.goTo(3, { source: 'history', animate: false });
  assert.equal(await navigation, true);
  assert.deepEqual(f.active, [[3, 'history']], 'the initial queued spy must not leave the view uninitialized');
  assert.equal(f.win.scrollY, 2400);
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

test('a cold-load layout contraction cannot turn a restored last chapter into the home chapter', async (t) => {
  const f = browserFixture(t, {}, { tops: [0, 10000, 20000, 30000], documentHeight: 30800, initialY: 30000 });
  await f.drain();
  assert.equal(f.nav.activeIndex, 3);
  f.tops.splice(0, 4, 0, 1000, 2000, 3000);
  f.root.scrollHeight = f.body.scrollHeight = 3800;
  f.win.scrollTo({ top: 30000 });
  await f.drain();
  assert.equal(f.win.scrollY, 3000);
  assert.equal(f.nav.activeIndex, 3);
  assert.deepEqual(f.active, [[3, 'init']], 'scroll spying must not publish an incorrect home selection before load');
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
