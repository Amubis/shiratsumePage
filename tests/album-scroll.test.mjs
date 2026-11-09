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
    for (let notch = 0; notch < 2; notch++) { send(Math.sign(destination - from) * 120, from, destination); await step(70); }
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
  assert.ok(f.api.progress > first && f.api.progress < .1);
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
  assert.equal(f.api.progress, ALBUM_SCROLL_INPUT.singlePreviewLimit);
  await f.drain();
  assert.equal(f.api.busy, false);
  assert.deepEqual(f.jumps, []);
  assert.deepEqual(f.completions, []);
  assert.equal(f.paints.at(-1).p, 0);
});

test('two deliberate mouse notches infer a chapter turn without a long scroll-distance barrier', async (t) => {
  const f = fixture(t);
  f.send(120); await f.step(150);
  assert.ok(f.api.progress > .1 && f.api.progress < .5);
  assert.deepEqual(f.jumps, []);
  f.send(120); await f.step(100); await f.drain();
  assert.deepEqual(f.jumps, [2]);
  assert.equal(f.holds, 1);
  assert.equal(f.paints.at(-1).p, 1);
  assert.deepEqual(f.completions, [{ kind: 'enter', direction: 1, from: 1, to: 2 }]);
});

test('rendering delays do not split a continuous gesture recorded by native event timestamps', async (t) => {
  const f = fixture(t);
  await f.step(200);
  f.api.wheel({ delta: 120, from: 1, destination: 2, timeStamp: 0 });
  await f.step(300); await f.step(130);
  f.api.wheel({ delta: 120, from: 1, destination: 2, timeStamp: 250 });
  await f.drain();
  assert.deepEqual(f.jumps, [2], 'the actual 250ms input gap must survive a 430ms handler gap');
});

test('unusable event timestamps retain normal wheel behavior', async (t) => {
  for (const timeStamp of [undefined, Number.NaN, -40, 1700000000000]) {
    const f = fixture(t);
    f.api.wheel({ delta: 120, from: 1, destination: 2, timeStamp });
    await f.step(90);
    f.api.wheel({ delta: 120, from: 1, destination: 2, timeStamp });
    await f.drain();
    assert.deepEqual(f.jumps, [2]);
  }
});

test('a stable trackpad flow is enough while tiny alternating direction noise is not', async (t) => {
  const noise = fixture(t);
  for (let sample = 0; sample < 12; sample++) { noise.send(sample % 2 ? -4 : 4); await noise.step(20); }
  await noise.drain();
  assert.deepEqual(noise.jumps, []);
  const flow = fixture(t);
  for (let sample = 0; sample < 6; sample++) { flow.send(18); await flow.step(20); }
  await flow.drain();
  assert.deepEqual(flow.jumps, [2]);
});

test('intent recognition cannot skip the committed wave even after a delayed frame or oversized packet', async (t) => {
  const f = fixture(t);
  f.send(4000); await f.step(60);
  assert.deepEqual(f.jumps, []);
  f.send(4000); await f.step(40);
  assert.ok(f.api.progress <= ALBUM_SCROLL_INPUT.previewLimit);
  f.send(4000); await f.step(1000);
  assert.ok(f.api.progress < .5, 'a late frame is capped instead of skipping the wave');
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

test('a deliberate opposite notch cancels an uncommitted entrance instead of paying back its old distance', async (t) => {
  const f = fixture(t);
  f.send(120); await f.step(120);
  assert.ok(f.api.progress > 0);
  assert.equal(f.send(-120, 1, 0), false, 'the normal previous chapter can handle the reversed input');
  await f.drain();
  assert.deepEqual(f.jumps, []);
  assert.deepEqual(f.completions, []);
  assert.equal(f.api.busy, false);
});

test('an uncommitted album exit changes direction directly with no accumulated scroll debt', async (t) => {
  const f = fixture(t);
  f.send(120, 2, 3); await f.step(120);
  f.send(-120, 2, 1); await f.step(100);
  assert.deepEqual(f.jumps, []);
  f.send(-120, 2, 1); await f.step(100); await f.drain();
  assert.deepEqual(f.jumps, [1]);
  assert.deepEqual(f.completions, [{ kind: 'exit', direction: -1, from: 2, to: 1 }]);
});

test('a renewed gesture continues a returning preview from its visible position', async (t) => {
  const f = fixture(t);
  f.send(120); await f.step(ALBUM_SCROLL_INPUT.settleDelay); await f.step(50);
  const before = f.api.progress;
  assert.ok(before > 0 && before < ALBUM_SCROLL_INPUT.singlePreviewLimit);
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

test('continuous same-direction inertia stays in the entry gesture, but a short fresh gesture can leave', async (t) => {
  const f = fixture(t);
  await f.commit(); await f.drain();
  for (let i = 0; i < 8; i++) { await f.step(100); f.send(120, 2, 3); }
  assert.deepEqual(f.jumps, [2]);
  await f.step(ALBUM_SCROLL_INPUT.gestureGap + 1);
  await f.commit(2, 3); await f.drain();
  assert.deepEqual(f.jumps, [2, 3]);
});

test('a clear reverse gesture bypasses same-direction cooling immediately after arrival', async (t) => {
  const f = fixture(t);
  await f.commit(); await f.drain();
  await f.commit(2, 1); await f.drain();
  assert.deepEqual(f.jumps, [2, 1]);
});

test('native final-page reading remains available during album gesture cooling', async (t) => {
  const f = fixture(t);
  await f.commit(2, 3); await f.drain();
  assert.equal(f.send(120, 3, null), false);
  assert.equal(f.send(-120, 3, null), false);
});

test('paper arrival stays independent while a confirmed upward intent waits without a new dead zone', async (t) => {
  let resolve;
  const arrivals = [];
  const f = fixture(t, { onComplete(event) { arrivals.push(event); return arrivals.length === 1 ? new Promise(done => { resolve = done; }) : undefined; } });
  await f.commit(); await f.drain();
  assert.equal(f.api.isArriving, true);
  await f.commit(2, 1);
  assert.deepEqual(f.jumps, [2], 'the entry paper performance finishes before exit begins');
  resolve(true); await f.step(0); await f.drain();
  assert.equal(f.api.isArriving, false);
  assert.deepEqual(f.jumps, [2, 1], 'the visitor does not have to repeat the confirmed upward gesture');
});

test('small reverse noise during paper arrival does not schedule an unwanted exit', async (t) => {
  let resolve;
  const f = fixture(t, { onComplete() { return new Promise(done => { resolve = done; }); } });
  await f.commit(); await f.drain();
  f.send(-4, 2, 1); await f.step(20);
  f.send(20, 2, 3); await f.step(20);
  resolve(true); await f.step(0); await f.drain();
  assert.deepEqual(f.jumps, [2]);
  assert.equal(f.api.busy, false);
});

test('a reversal confirmed during arrival starts withdrawal as soon as the paper promise resolves', async (t) => {
  let resolveArrival, withdrawals = 0;
  const f = fixture(t, {
    onComplete(event) { return event.kind === 'enter' ? new Promise(done => { resolveArrival = done; }) : undefined; },
    transitionHooks: { beforeExit() { withdrawals++; return true; } },
  });
  await f.commit(); await f.drain();
  await f.commit(2, 1);
  assert.equal(withdrawals, 0);
  resolveArrival(true);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(withdrawals, 1, 'confirmed intent must not wait for another preview frame or minimum-buffer interval');
  await f.drain();
  assert.deepEqual(f.jumps, [2, 1]);
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
    await f.step(ALBUM_SCROLL_INPUT.gestureGap + 1);
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

test('small exit input only previews resistance and never withdraws paper or draws dots', async (t) => {
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
