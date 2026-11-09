import test from 'node:test';
import assert from 'node:assert/strict';
import { ALBUM_SCROLL_INPUT, createAlbumScroll } from '../src/album-scroll.js';

function fixture(t, options = {}) {
  let clock = 0, id = 0;
  const frames = new Map();
  const paints = [], jumps = [], handoffs = [];
  let cancels = 0, holds = 0;
  const win = {
    performance: { now: () => clock },
    requestAnimationFrame(callback) { frames.set(++id, callback); return id; },
    cancelAnimationFrame(frame) { frames.delete(frame); },
  };
  const transition = { seekEnter(p) { paints.push(['enter', p]); }, seekExit(p) { paints.push(['exit', p]); }, holdCover() { holds++; }, cancel() { cancels++; } };
  const api = createAlbumScroll({ transition, window: win, navigate(index) { jumps.push(index); return true; }, onHandoff(event) { handoffs.push(event); }, ...options });
  t.after(() => api.destroy());
  async function step(time = 100) {
    clock += time;
    const pending = [...frames]; frames.clear();
    for (const [, callback] of pending) callback(clock);
    await Promise.resolve(); await Promise.resolve();
  }
  async function send(delta, from = 1, destination = 2, time = 100) { const handled = api.wheel({ delta, from, destination }); await step(time); return handled; }
  return { api, paints, jumps, handoffs, frames, step, send, get cancels() { return cancels; }, get holds() { return holds; } };
}

test('only downward album boundaries start a wheel timeline; tall reading and unrelated chapters pass through', async (t) => {
  const f = fixture(t);
  for (const fields of [{ delta: 100, from: 0, destination: 1 }, { delta: 100, from: 1, destination: null }, { delta: -100, from: 1, destination: 0 }, { delta: 100, from: 3, destination: null }, { delta: 0, from: 1, destination: 2 }]) assert.equal(f.api.wheel(fields), false);
  assert.equal(f.api.busy, false);
  assert.equal(await f.send(100), true);
  assert.equal(f.api.kind, 'enter');
  assert.equal(f.api.busy, true);
});

test('wheel follows input over ninety milliseconds and never auto-completes an unfinished turn', async (t) => {
  const f = fixture(t);
  assert.equal(f.api.wheel({ delta: 110, from: 1, destination: 2 }), true);
  assert.equal(f.api.progress, 0);
  await f.step(30);
  assert.ok(f.api.progress > 0 && f.api.progress < .1);
  await f.step(60);
  assert.ok(Math.abs(f.api.progress - .1) < 1e-12);
  assert.equal(f.frames.size, 0);
  await f.step(3000);
  assert.ok(Math.abs(f.api.progress - .1) < 1e-12);
  assert.deepEqual(f.jumps, []);
  assert.equal(f.api.busy, true);
});

test('a huge wheel event is clamped and cannot skip the album choreography', async (t) => {
  const f = fixture(t);
  await f.send(4000);
  assert.equal(f.api.progress, ALBUM_SCROLL_INPUT.maxDelta / ALBUM_SCROLL_INPUT.distance);
  assert.equal(f.api.busy, true);
  assert.deepEqual(f.jumps, []);
});

test('forward and reverse scrubbing jump beneath one held cover and follow the input chapter', async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 3; i++) await f.send(150);
  assert.ok(f.api.progress > .36);
  assert.deepEqual(f.jumps, [2]);
  assert.equal(f.holds, 1);
  assert.equal(f.api.isHandoff, false);
  // After handoff the navigator can report a nullable destination; the active
  // scrub still owns all vertical input, including an upward reversal.
  assert.equal(await f.send(-150, 2, null), true);
  assert.ok(f.api.progress < .36);
  assert.deepEqual(f.jumps, [2, 1]);
  assert.equal(f.holds, 2);
  assert.ok(f.paints.at(-1)[1] < .36);
  assert.deepEqual(f.handoffs.map(({ from, to }) => [from, to]), [[1, 2], [2, 1]]);
});

test('a reversal during an asynchronous handoff queues a covered return and never paints the wrong chapter', async (t) => {
  const pending = [];
  const f = fixture(t, { navigate(index) { return new Promise((resolve) => pending.push({ index, resolve })); } });
  for (let i = 0; i < 3; i++) await f.send(150);
  assert.equal(f.api.isHandoff, true);
  assert.equal(pending[0].index, 2);
  const painted = f.paints.length;
  await f.send(-150, 2, null);
  assert.equal(f.paints.length, painted, 'the cover remains held while input reverses');
  pending[0].resolve(true); await f.step(0);
  assert.equal(pending[1].index, 1);
  assert.equal(f.api.isHandoff, true);
  assert.equal(f.paints.length, painted);
  pending[1].resolve(true); await f.step(0);
  assert.equal(f.api.isHandoff, false);
  assert.ok(f.paints.at(-1)[1] < .36);
});

test('both timeline endpoints release control, while momentum is consumed until a real gesture gap', async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 8; i++) await f.send(150);
  assert.equal(f.api.busy, false);
  assert.deepEqual(f.paints.at(-1), ['enter', 1]);
  assert.equal(await f.send(100, 2, 3, 30), true);
  assert.equal(f.api.busy, false);
  assert.equal(await f.send(100, 2, 3, 30), true);
  await f.step(250);
  assert.equal(await f.send(100, 2, 3), true);
  assert.equal(f.api.kind, 'exit');
  await f.send(-150, 2, 3);
  assert.equal(f.api.busy, false);
  assert.deepEqual(f.paints.at(-1), ['exit', 0]);
});

test('exit stays on the album until its own handoff and can reveal the following chapter progressively', async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 4; i++) await f.send(150, 2, 3);
  assert.equal(f.api.kind, 'exit');
  assert.deepEqual(f.jumps, []);
  await f.send(150, 2, 3);
  assert.deepEqual(f.jumps, [3]);
  await f.send(-150, 3, null);
  assert.deepEqual(f.jumps, [3, 2]);
  for (let i = 0; i < 4; i++) await f.send(150, 2, 3);
  assert.equal(f.api.busy, false);
  assert.deepEqual(f.paints.at(-1), ['exit', 1]);
});

test('cancel and destruction release frames and ignore late handoff results', async (t) => {
  let resolve;
  const f = fixture(t, { navigate() { return new Promise((done) => { resolve = done; }); } });
  for (let i = 0; i < 3; i++) await f.send(150);
  const painted = f.paints.length;
  f.api.cancel();
  assert.equal(f.api.busy, false);
  assert.equal(f.api.isHandoff, false);
  assert.equal(f.frames.size, 0);
  resolve(true); await f.step(100);
  assert.equal(f.paints.length, painted);
  assert.equal(f.cancels, 1);
  f.api.wheel({ delta: 30, from: 1, destination: 2 });
  f.api.destroy(); await f.step(100);
  assert.equal(f.api.wheel({ delta: 100, from: 1, destination: 2 }), false);
  assert.equal(f.frames.size, 0);
});

test('failed navigation settles without an overlay trap and reduced motion yields normal page navigation', async (t) => {
  let reduced = false;
  const f = fixture(t, { navigate: () => false, reducedMotion: () => reduced });
  for (let i = 0; i < 3; i++) await f.send(150);
  assert.equal(f.api.busy, false);
  assert.equal(f.cancels, 1);
  await f.send(110);
  reduced = true;
  assert.equal(f.api.wheel({ delta: 100, from: 1, destination: 2 }), false);
  assert.equal(f.api.busy, false);
  assert.equal(f.frames.size, 0);
});
