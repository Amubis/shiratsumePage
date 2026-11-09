import test from 'node:test';
import assert from 'node:assert/strict';
import { ALBUM_SCROLL_INPUT, createAlbumScroll } from '../src/album-scroll.js';

function fixture(t, options = {}) {
  const { transitionHooks = {}, ...controllerOptions } = options;
  let clock = 0, id = 0;
  const frames = new Map();
  const paints = [], jumps = [], handoffs = [], completions = [];
  let cancels = 0, holds = 0;
  const win = {
    performance: { now: () => clock },
    requestAnimationFrame(callback) { frames.set(++id, callback); return id; },
    cancelAnimationFrame(frame) { frames.delete(frame); },
  };
  const transition = { seekBoundary(p, event) { paints.push({ p, ...event }); }, holdCover() { holds++; }, cancel() { cancels++; }, ...transitionHooks };
  const api = createAlbumScroll({ transition, window: win, navigate(index) { jumps.push(index); return true; }, onHandoff(event) { handoffs.push(event); }, onComplete(event) { completions.push(event); }, ...controllerOptions });
  t.after(() => api.destroy());
  async function step(time = 16) {
    clock += time;
    const pending = [...frames]; frames.clear();
    for (const [, callback] of pending) callback(clock);
    await Promise.resolve(); await Promise.resolve();
  }
  async function drain() {
    for (let count = 0; frames.size && count < 200; count++) await step();
    assert.equal(frames.size, 0, 'settled gestures must not retain a frame loop');
  }
  const send = (delta, from = 1, destination = 2) => api.wheel({ delta, from, destination });
  async function commit(from = 1, destination = 2) {
    for (let notch = 0; notch < 6; notch++) { send(Math.sign(destination - from) * 120, from, destination); await step(40); }
  }
  return { api, paints, jumps, handoffs, completions, frames, step, drain, send, commit, get cancels() { return cancels; }, get holds() { return holds; } };
}

test('tall reading, unrelated chapters and input pointing away from the boundary pass through', (t) => {
  const f = fixture(t);
  for (const fields of [{ delta: 100, from: 0, destination: 1 }, { delta: 100, from: 1, destination: null }, { delta: -100, from: 1, destination: 0 }, { delta: 100, from: 3, destination: null }, { delta: 0, from: 1, destination: 2 }, { delta: 100, from: 3, destination: 2 }, { delta: 100, from: 0, destination: 2 }]) assert.equal(f.api.wheel(fields), false);
  assert.equal(f.api.busy, false);
});

test('small input previews dots smoothly and returns after the gesture ends without navigating', async (t) => {
  const f = fixture(t);
  assert.equal(f.send(30), true);
  await f.step(30);
  const first = f.api.progress;
  assert.ok(first > 0);
  await f.step(ALBUM_SCROLL_INPUT.followDuration - 30);
  assert.ok(f.api.progress > first && f.api.progress < .05);
  assert.equal(f.api.busy, true);
  assert.deepEqual(f.jumps, []);
  await f.drain();
  assert.equal(f.api.busy, false);
  assert.equal(f.paints.at(-1).p, 0);
  assert.deepEqual(f.completions, []);
  assert.equal(f.cancels, 1);
});

test('a single arbitrarily large wheel packet only previews and cannot commit a chapter', async (t) => {
  const f = fixture(t);
  f.send(4000);
  await f.step(ALBUM_SCROLL_INPUT.followDuration);
  assert.ok(f.api.progress > .05 && f.api.progress < .1);
  await f.drain();
  assert.equal(f.api.busy, false);
  assert.deepEqual(f.jumps, []);
  assert.deepEqual(f.completions, []);
  assert.equal(f.paints.at(-1).p, 0);
});

test('ordinary spaced mouse notches control a wider wave preview before the final snap', async (t) => {
  const f = fixture(t);
  const samples = [];
  for (let notch = 0; notch < 5; notch++) {
    f.send(120); await f.step(190);
    samples.push(f.api.progress);
    assert.deepEqual(f.jumps, [], 'the first five notches cannot navigate');
    assert.equal(f.api.busy, true);
  }
  assert.ok(samples.every((p, i) => i === 0 || p > samples[i - 1]));
  assert.ok(samples.at(-1) > .4 && samples.at(-1) < .5, 'several visible dot-growth stages remain under wheel control');
  f.send(120); await f.step(120); await f.drain();
  assert.deepEqual(f.jumps, [2]);
  assert.equal(f.holds, 1);
  assert.equal(f.paints.at(-1).p, 1);
  assert.deepEqual(f.completions, [{ kind: 'enter', direction: 1, from: 1, to: 2 }]);
});

test('input cannot advance across the midpoint or accelerate the clock before a committed snap', async (t) => {
  const f = fixture(t);
  for (let notch = 0; notch < 5; notch++) { f.send(4000); await f.step(30); }
  assert.ok(f.api.progress < .5);
  assert.deepEqual(f.jumps, []);
  f.send(4000); await f.step(40);
  assert.ok(f.api.progress <= ALBUM_SCROLL_INPUT.previewLimit);
  f.send(4000); await f.step(1000);
  assert.ok(f.api.progress < .5, 'a delayed frame is capped instead of skipping the wave');
  assert.deepEqual(f.jumps, []);
  await f.drain();
  assert.deepEqual(f.jumps, [2]);
});

test('all four adjacent routes carry the correct wave and fade direction', async (t) => {
  const f = fixture(t);
  for (const [from, to, kind] of [[1, 2, 'enter'], [3, 2, 'enter'], [2, 1, 'exit'], [2, 3, 'exit']]) {
    f.api.cancel();
    const before = f.paints.length;
    await f.commit(from, to); await f.drain();
    assert.deepEqual(f.paints[before], { p: 0, kind, direction: Math.sign(to - from), from, to });
    assert.equal(f.jumps.at(-1), to);
    assert.deepEqual(f.completions.at(-1), { kind, direction: Math.sign(to - from), from, to });
    assert.equal(f.api.busy, false);
  }
});

test('reversing a nearly committed preview cancels before any chapter handoff', async (t) => {
  const f = fixture(t);
  for (let notch = 0; notch < 5; notch++) { f.send(120); await f.step(120); }
  const before = f.api.progress;
  assert.ok(before > .4);
  f.send(-120, 1, 0); await f.step(120);
  assert.ok(f.api.progress < before);
  await f.drain();
  assert.deepEqual(f.jumps, []);
  assert.deepEqual(f.completions, []);
  assert.equal(f.paints.at(-1).p, 0);
});

test('a renewed gesture continues a returning preview from its visible position', async (t) => {
  const f = fixture(t);
  f.send(120); await f.step(ALBUM_SCROLL_INPUT.settleDelay); await f.step(50);
  const before = f.api.progress;
  assert.ok(before > 0 && before < .09);
  f.send(120);
  assert.equal(f.api.progress, before);
  await f.commit(); await f.drain();
  assert.deepEqual(f.jumps, [2]);
  assert.equal(f.completions.length, 1);
});

test('a committed turn holds its cover during an asynchronous handoff and cannot reverse from inertia', async (t) => {
  let resolve;
  const f = fixture(t, { navigate() { return new Promise((done) => { resolve = done; }); } });
  await f.commit();
  for (let i = 0; i < 100 && !f.api.isHandoff; i++) await f.step();
  assert.equal(f.api.isHandoff, true);
  const painted = f.paints.length;
  assert.equal(f.send(-120, 2, 1), true);
  await f.drain();
  assert.equal(f.paints.length, painted);
  assert.equal(f.api.busy, true);
  resolve(true); await f.step(0);
  assert.equal(f.api.busy, true);
  assert.equal(f.api.progress, .5);
  await f.step(100);
  assert.ok(f.api.progress > .5 && f.api.progress < 1);
  await f.drain();
  assert.equal(f.api.busy, false);
  assert.equal(f.paints.at(-1).p, 1);
  assert.equal(f.completions.length, 1);
});

test('arrival dwell and continuous inertia cannot immediately chain an exit after entering', async (t) => {
  const f = fixture(t);
  await f.commit(); await f.drain();
  await f.step(300);
  assert.equal(f.send(120, 2, 3), true);
  assert.equal(f.api.busy, false, 'a 300ms pause does not bypass the arrival dwell');
  for (let i = 0; i < 8; i++) { await f.step(100); f.send(120, 2, 3); }
  assert.deepEqual(f.jumps, [2], 'continuous tail packets stay in the arrival gesture');
  await f.step(ALBUM_SCROLL_INPUT.gestureGap + 1);
  await f.commit(2, 3); await f.drain();
  assert.deepEqual(f.jumps, [2, 3]);
});

test('paper entrance promise finishes before a fresh 700ms reading interval can unlock exit', async (t) => {
  let resolve;
  const f = fixture(t, { onComplete() { return new Promise(done => { resolve = done; }); } });
  await f.commit(); await f.drain();
  assert.equal(f.api.busy, true, 'autonomous paper arrival is part of the entry gate');
  assert.equal(f.api.isArriving, true);
  await f.step(3000); assert.equal(f.send(120, 2, 3), true);
  assert.deepEqual(f.jumps, [2]);
  resolve(true); await f.step(0);
  assert.equal(f.api.busy, false);
  await f.step(ALBUM_SCROLL_INPUT.arrivalDwell - 1); f.send(120, 2, 3);
  assert.equal(f.api.isArriving, false);
  assert.equal(f.api.busy, false, 'the final paper frame receives its own readable pause');
  await f.step(ALBUM_SCROLL_INPUT.gestureGap + 1);
  f.send(120, 2, 3);
  assert.equal(f.api.busy, true, 'a separate deliberate exit gesture is accepted');
  assert.deepEqual(f.jumps, [2]);
});

test('cancel during paper arrival ignores a late promise and does not leave input gated', async (t) => {
  let resolve;
  const f = fixture(t, { onComplete() { return new Promise(done => { resolve = done; }); } });
  await f.commit(); await f.drain();
  assert.equal(f.api.busy, true);
  f.api.cancel();
  resolve(true); await f.step(0);
  assert.equal(f.api.busy, false);
  f.send(30, 2, 3);
  assert.equal(f.api.busy, true);
  await f.drain();
  assert.equal(f.api.busy, false);
});

test('rejected and thrown arrival callbacks release their gates without an unhandled rejection', async (t) => {
  for (const fail of ['reject', 'throw']) {
    const f = fixture(t, { onComplete() { if (fail === 'throw') throw new Error('arrival failed'); return Promise.reject(new Error('arrival failed')); } });
    await f.commit(); await f.drain(); await f.step(0);
    assert.equal(f.api.busy, false);
    await f.step(ALBUM_SCROLL_INPUT.arrivalDwell + 1);
    f.send(30, 2, 3);
    assert.equal(f.api.busy, true);
    await f.drain();
    assert.equal(f.api.busy, false);
  }
});

test('cancellation releases buffered work and ignores a late covered navigation result', async (t) => {
  let resolve;
  const f = fixture(t, { navigate() { return new Promise(done => { resolve = done; }); } });
  await f.commit();
  for (let i = 0; i < 100 && !f.api.isHandoff; i++) await f.step();
  const painted = f.paints.length;
  f.api.cancel();
  assert.equal(f.api.busy, false);
  assert.equal(f.api.isHandoff, false);
  assert.equal(f.frames.size, 0);
  resolve(true); await f.step(100);
  assert.equal(f.paints.length, painted);
  assert.deepEqual(f.completions, []);
  f.send(30); f.api.destroy(); await f.step(100);
  assert.equal(f.send(120), false);
  assert.equal(f.frames.size, 0);
});

test('failed navigation and reduced motion leave no frozen transition or frame', async (t) => {
  let reduced = false;
  const f = fixture(t, { navigate: () => false, reducedMotion: () => reduced });
  await f.commit(); await f.drain();
  assert.equal(f.api.busy, false);
  assert.equal(f.cancels, 1);
  f.send(30); reduced = true;
  assert.equal(f.send(120), false);
  assert.equal(f.api.busy, false);
  assert.equal(f.frames.size, 0);
});

test('small and reversed exit input only previews resistance, never withdrawing paper or drawing dots', async (t) => {
  const previews = [];
  let exits = 0;
  const f = fixture(t, { transitionHooks: {
    previewExit(value, event) { previews.push({ value, ...event }); },
    beforeExit() { exits++; return true; },
  } });
  f.send(4000, 2, 3); await f.drain();
  assert.equal(exits, 0);
  assert.deepEqual(f.paints, []);
  assert.ok(previews.some(event => event.value > 0));
  assert.equal(previews.at(-1).value, 0);
  await f.step(ALBUM_SCROLL_INPUT.gestureGap + 1);
  for (let notch = 0; notch < 5; notch++) { f.send(-120, 2, 1); await f.step(120); }
  f.send(120, 2, 3); await f.drain();
  assert.equal(exits, 0);
  assert.deepEqual(f.paints, []);
  assert.deepEqual(f.jumps, []);
  assert.equal(f.api.busy, false);
});

test('committed exit waits for paper withdrawal before the first dot frame and keeps its fresh wave clock', async (t) => {
  let resolve;
  const stages = [];
  const f = fixture(t, { transitionHooks: { beforeExit(event, { signal }) {
    stages.push({ event, signal });
    return new Promise(done => { resolve = done; });
  } } });
  await f.commit(2, 1);
  assert.deepEqual(stages.map(stage => stage.event), [{ kind: 'exit', direction: -1, from: 2, to: 1 }]);
  assert.equal(f.api.busy, true);
  assert.deepEqual(f.paints, []);
  assert.equal(f.frames.size, 0);
  for (const delta of [-4000, 4000, -4000]) { await f.step(500); assert.equal(f.send(delta, 2, 1), true); }
  assert.equal(stages.length, 1);
  assert.deepEqual(f.jumps, []);
  resolve(true); await f.step(0);
  assert.deepEqual(f.paints, [{ p: 0, kind: 'exit', direction: -1, from: 2, to: 1 }]);
  await f.step(0); await f.step(0);
  assert.equal(f.api.progress, 0);
  assert.equal(f.cancels, 0);
  await f.step(200);
  assert.ok(f.api.progress > 0 && f.api.progress < .5);
  assert.equal(stages[0].signal.aborted, false);
  await f.drain();
  assert.deepEqual(f.jumps, [1]);
  assert.equal(f.paints.at(-1).p, 1);
  assert.equal(f.completions.length, 1);
});

test('cancelling a pending withdrawal aborts its signal and ignores late completion', async (t) => {
  let resolve, signal;
  const f = fixture(t, { transitionHooks: { beforeExit(_, options) {
    signal = options.signal;
    return new Promise(done => { resolve = done; });
  } } });
  await f.commit(2, 3);
  f.api.cancel();
  assert.equal(signal.aborted, true);
  assert.equal(f.api.busy, false);
  assert.equal(f.frames.size, 0);
  resolve(true); await f.step(1000);
  assert.deepEqual(f.paints, []);
  assert.deepEqual(f.jumps, []);
  assert.deepEqual(f.completions, []);
});

test('failed, rejected and reduced-motion withdrawal paths release input without starting a wave', async (t) => {
  for (const failure of ['false', 'throw', 'reject', 'reduced']) {
    let reduced = false, resolve;
    const f = fixture(t, { reducedMotion: () => reduced, transitionHooks: { beforeExit() {
      if (failure === 'throw') throw new Error('exit failed');
      if (failure === 'reject') return Promise.reject(new Error('exit failed'));
      if (failure === 'false') return false;
      return new Promise(done => { resolve = done; });
    } } });
    await f.commit(2, 3);
    if (failure === 'reduced') {
      reduced = true;
      assert.equal(f.send(120, 2, 3), false);
      resolve(true); await f.step(0);
    }
    assert.equal(f.api.busy, false, failure);
    assert.equal(f.frames.size, 0, failure);
    assert.deepEqual(f.paints, [], failure);
    assert.deepEqual(f.jumps, [], failure);
    assert.equal(f.cancels, 1, failure);
  }
});

test('enabling reduced motion during pending paper arrival releases the input gate', async (t) => {
  let reduced = false, resolve;
  const f = fixture(t, { reducedMotion: () => reduced, onComplete() { return new Promise(done => { resolve = done; }); } });
  await f.commit(); await f.drain();
  assert.equal(f.api.busy, true);
  reduced = true;
  assert.equal(f.send(120, 2, 3), false);
  assert.equal(f.api.busy, false);
  resolve(true); await f.step(0);
  assert.equal(f.api.busy, false);
  assert.equal(f.frames.size, 0);
});
