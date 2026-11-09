import test from 'node:test';
import assert from 'node:assert/strict';
import { ALBUM_SCROLL_INPUT, createAlbumScroll } from '../src/album-scroll.js';

function fixture(t, options = {}) {
  let clock = 0, id = 0;
  const frames = new Map();
  const paints = [], jumps = [], handoffs = [], completions = [];
  let cancels = 0, holds = 0;
  const win = {
    performance: { now: () => clock },
    requestAnimationFrame(callback) { frames.set(++id, callback); return id; },
    cancelAnimationFrame(frame) { frames.delete(frame); },
  };
  const transition = { seekBoundary(p, event) { paints.push({ p, ...event }); }, holdCover() { holds++; }, cancel() { cancels++; } };
  const api = createAlbumScroll({ transition, window: win, navigate(index) { jumps.push(index); return true; }, onHandoff(event) { handoffs.push(event); }, onComplete(event) { completions.push(event); }, ...options });
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
  return { api, paints, jumps, handoffs, completions, frames, step, drain, send, get cancels() { return cancels; }, get holds() { return holds; } };
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
  assert.ok(f.api.progress > 0 && f.api.progress < 30 / ALBUM_SCROLL_INPUT.distance);
  await f.step(ALBUM_SCROLL_INPUT.followDuration-30);
  assert.equal(f.api.progress, 30 / ALBUM_SCROLL_INPUT.distance);
  assert.equal(f.api.busy, true);
  assert.deepEqual(f.jumps, []);
  await f.drain();
  assert.equal(f.api.busy, false);
  assert.equal(f.paints.at(-1).p, 0);
  assert.deepEqual(f.completions, []);
  assert.equal(f.cancels, 1);
});

test('large input is clamped, shows a buffer, then snaps once without further wheel input', async (t) => {
  const f = fixture(t);
  f.send(4000);
  await f.step(ALBUM_SCROLL_INPUT.followDuration);
  assert.equal(f.api.progress, ALBUM_SCROLL_INPUT.previewLimit);
  assert.ok(f.api.progress < .5);
  assert.deepEqual(f.jumps, [], 'the preview cannot jump before the minimum buffer');
  await f.step(30);
  assert.deepEqual(f.jumps, []);
  await f.drain();
  assert.equal(f.api.busy, false);
  assert.deepEqual(f.jumps, [2]);
  assert.equal(f.holds, 1);
  assert.equal(f.paints.at(-1).p, 1);
  assert.deepEqual(f.completions, [{ kind: 'enter', direction: 1, from: 1, to: 2 }]);
});

test('mouse wheel notches cannot skip the buffered wave or accelerate its committed clock', async(t)=>{
  const f=fixture(t);
  f.send(120);await f.step(ALBUM_SCROLL_INPUT.minBuffer);
  assert.equal(f.api.progress,ALBUM_SCROLL_INPUT.previewLimit);
  f.send(4000);await f.step(200);
  assert.equal(f.api.busy,true);
  assert.ok(f.api.progress<.5,'the first half of the long wave remains visible');
  assert.deepEqual(f.jumps,[]);
  await f.step(ALBUM_SCROLL_INPUT.snapDuration-200);
  await f.drain();
  assert.equal(f.api.busy,false);
  assert.deepEqual(f.jumps,[2]);
});

test('a delayed compositor frame cannot skip the wave or incoming reveal', async (t) => {
  const f = fixture(t);
  f.send(120); await f.step(ALBUM_SCROLL_INPUT.minBuffer);
  await f.step(1000);
  assert.ok(f.api.progress < .5);
  assert.deepEqual(f.jumps, []);
  await f.drain();
  assert.deepEqual(f.jumps, [2]);
  assert.equal(f.paints.at(-1).p, 1);
});

test('all four adjacent routes carry the correct direction for the wave and fade', async (t) => {
  const f = fixture(t);
  for (const [from, to, kind] of [[1, 2, 'enter'], [3, 2, 'enter'], [2, 1, 'exit'], [2, 3, 'exit']]) {
    f.api.cancel();
    const direction = Math.sign(to - from);
    assert.equal(f.send(direction * 120, from, to), true);
    assert.deepEqual(f.paints.at(-1), { p: 0, kind, direction, from, to });
    await f.drain();
    assert.equal(f.jumps.at(-1), to);
    assert.deepEqual(f.completions.at(-1), { kind, direction, from, to });
    assert.equal(f.api.busy, false);
  }
});

test('reversing during the initial buffer reduces progress and cancels before commitment', async (t) => {
  const f = fixture(t);
  f.send(100); await f.step(60);
  const before = f.api.progress;
  assert.ok(before > 0);
  f.send(-120, 1, 0); await f.step(60);
  assert.ok(f.api.progress < before);
  await f.drain();
  assert.deepEqual(f.jumps, []);
  assert.deepEqual(f.completions, []);
  assert.equal(f.paints.at(-1).p, 0);
});

test('a renewed small gesture can continue a returning preview without restarting its position', async (t) => {
  const f = fixture(t);
  f.send(30); await f.step(ALBUM_SCROLL_INPUT.followDuration); await f.step(ALBUM_SCROLL_INPUT.minBuffer-ALBUM_SCROLL_INPUT.followDuration); await f.step(50);
  const before = f.api.progress;
  assert.ok(before > 0 && before < 30 / ALBUM_SCROLL_INPUT.distance);
  f.send(120);
  assert.equal(f.api.progress, before);
  await f.drain();
  assert.deepEqual(f.jumps, [2]);
  assert.equal(f.completions.length, 1);
});

test('a committed turn keeps its cover during an asynchronous handoff and cannot reverse from inertia', async (t) => {
  let resolve;
  const f = fixture(t, { navigate() { return new Promise((done) => { resolve = done; }); } });
  f.send(120);
  for(let i=0;i<100&&!f.api.isHandoff;i++)await f.step(16);
  assert.equal(f.api.isHandoff, true);
  const painted = f.paints.length;
  assert.equal(f.send(-120, 2, 1), true);
  await f.drain();
  assert.equal(f.paints.length, painted, 'only the held full cover may be shown before the real page arrives');
  assert.equal(f.api.busy, true);
  resolve(true); await f.step(0);
  assert.equal(f.api.busy, true, 'navigation latency cannot consume the incoming reveal');
  assert.equal(f.api.progress, .5);
  await f.step(100);
  assert.ok(f.api.progress > .5 && f.api.progress < 1);
  await f.drain();
  assert.equal(f.api.busy, false);
  assert.equal(f.paints.at(-1).p, 1);
  assert.equal(f.completions.length, 1);
});

test('one wheel gesture cannot cascade to another page until its inertia has stopped', async (t) => {
  const f = fixture(t);
  f.send(120); await f.drain();
  for (let i = 0; i < 3; i++) {
    await f.step(30); assert.equal(f.send(120, 2, 3), true); assert.equal(f.api.busy, false);
  }
  assert.deepEqual(f.jumps, [2]);
  await f.step(230); f.send(120, 2, 3); await f.drain();
  assert.deepEqual(f.jumps, [2, 3]);
});

test('cancellation releases buffered work and ignores a late covered navigation result', async (t) => {
  let resolve;
  const f = fixture(t, { navigate() { return new Promise((done) => { resolve = done; }); } });
  f.send(120);
  for(let i=0;i<100&&!f.api.isHandoff;i++)await f.step(16);
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
  f.send(120); await f.drain();
  assert.equal(f.api.busy, false);
  assert.equal(f.cancels, 1);
  f.send(30); reduced = true;
  assert.equal(f.send(120), false);
  assert.equal(f.api.busy, false);
  assert.equal(f.frames.size, 0);
});
