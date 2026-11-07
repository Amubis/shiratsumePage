import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoReveal, inverseCircleMask, videoCoverRadius, videoRevealFrame } from '../src/video-reveal.js';

class Style {
  values = new Map();
  getPropertyValue(name) { return this.values.get(name)?.value || ''; }
  getPropertyPriority(name) { return this.values.get(name)?.priority || ''; }
  setProperty(name, value, priority = '') { this.values.set(name, { value, priority }); }
  removeProperty(name) { this.values.delete(name); }
}
class Events {
  listeners = new Map();
  addEventListener(name, listener, options) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push({ listener, options }); }
  removeEventListener(name, listener) { this.listeners.set(name, (this.listeners.get(name) || []).filter((item) => item.listener !== listener)); }
  emit(name, event = {}) { for (const { listener } of [...(this.listeners.get(name) || [])]) listener(event); }
  count() { return [...this.listeners.values()].reduce((sum, list) => sum + list.length, 0); }
}
const element = (rect) => ({ style: new Style(), getBoundingClientRect: () => rect });

function environment() {
  let time = 0;
  let serial = 0;
  const frames = new Map();
  const reads = [];
  const classes = new Set();
  const win = Object.assign(new Events(), {
    innerWidth: 1000, innerHeight: 800,
    performance: { now: () => time },
    requestAnimationFrame(fn) { frames.set(++serial, fn); return serial; },
    cancelAnimationFrame(id) { frames.delete(id); },
    getComputedStyle(target, pseudo) { reads.push({ target, pseudo, committed: classes.has('watch-mode') }); return { opacity: classes.has('watch-mode') ? '0' : '1' }; },
  });
  const body = { classList: { contains: (name) => classes.has(name), add: (name) => classes.add(name), remove: (name) => classes.delete(name) } };
  const doc = Object.assign(new Events(), { defaultView: win, body, hidden: false });
  const hero = Object.assign(element({ left: 0, top: 0, width: 1000, height: 800 }), { ownerDocument: doc });
  const disc = element({ left: 10, top: 734, width: 52, height: 52 });
  const button = Object.assign(element({ left: 10, top: 734, width: 52, height: 52 }), { querySelector: () => disc });
  const target = element({ left: 100, top: 90, width: 220, height: 120 });
  target.style.setProperty('mask-image', 'url(original.svg)', 'important');
  target.style.setProperty('mask-size', '40px');
  hero.style.setProperty('--video-reveal-mask', 'url(original-veil.svg)');
  disc.style.setProperty('transform', 'rotate(2deg)', 'important');
  return {
    hero, button, disc, target, targets: [target], win, doc, body, reads, frames,
    step(timestamp) { time = timestamp; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((fn) => fn(timestamp)); },
  };
}

test('the inverse alpha mask keeps a true circular hole in each target coordinate system', () => {
  const svg = inverseCircleMask({ left: 100, top: 50, width: 200, height: 100 }, { x: 130, y: 90 }, 22);
  assert.ok(svg.includes('viewBox="0 0 200 100"'));
  assert.ok(svg.includes('fill="white" fill-rule="evenodd"'));
  assert.ok(svg.includes('M0 0 H200 V100 H0 Z M52 40 a22 22 0 1 0 -44 0 a22 22 0 1 0 44 0 Z'));
  assert.ok(!svg.includes('<circle'));
  const radius = videoCoverRadius({ x: 30, y: 760 }, { width: 1000, height: 800 });
  assert.equal(radius, Math.hypot(970, 760) + 32);
  assert.equal(videoRevealFrame(0, radius).radius, 22);
  assert.equal(videoRevealFrame(120, radius).radius, 7);
  assert.ok(videoRevealFrame(200, radius).radius < videoRevealFrame(450, radius).radius);
  assert.equal(videoRevealFrame(780, radius).radius, radius);
  assert.equal(videoRevealFrame(780, radius).discScale, 1, 'the solid disc never grows to cover the screen');
  assert.equal(videoRevealFrame(780, radius).complete, true);
});

test('cancel restores masks, priorities, pseudo-element variable and disc; reentry shares one animation', async () => {
  const env = environment();
  let starts = 0;
  let completes = 0;
  const reveal = createVideoReveal({ ...env, onStart() { starts++; }, onComplete() { completes++; } });
  const promise = reveal.enter();
  assert.equal(starts, 1, 'onStart runs synchronously in the user gesture');
  assert.equal(reveal.enter(), promise);
  assert.equal(env.frames.size, 1);
  env.step(120);
  assert.equal(env.disc.style.getPropertyValue('transform'), 'scale(0.318)');
  assert.ok(env.target.style.getPropertyValue('mask-image').includes('data:image/svg+xml,'));
  assert.equal(env.body.classList.contains('watch-reveal-animating'), true);
  reveal.cancel();
  assert.equal(await promise, false);
  assert.equal(reveal.active, false);
  assert.equal(completes, 0);
  assert.equal(env.target.style.getPropertyValue('mask-image'), 'url(original.svg)');
  assert.equal(env.target.style.getPropertyPriority('mask-image'), 'important');
  assert.equal(env.target.style.getPropertyValue('mask-size'), '40px');
  assert.equal(env.target.style.getPropertyValue('mask-repeat'), '');
  assert.equal(env.hero.style.getPropertyValue('--video-reveal-mask'), 'url(original-veil.svg)');
  assert.equal(env.disc.style.getPropertyValue('transform'), 'rotate(2deg)');
  assert.equal(env.disc.style.getPropertyPriority('transform'), 'important');
  assert.equal(env.frames.size + env.win.count() + env.doc.count(), 0);
  const next = reveal.enter();
  assert.notEqual(next, promise);
  assert.equal(starts, 2);
  reveal.cancel();
  assert.equal(await next, false);
});

test('completion commits watch mode under the full opening before removing masks and transition lock', async () => {
  const env = environment();
  const reveal = createVideoReveal({ ...env, onComplete() {
    assert.equal(env.body.classList.contains('watch-reveal-animating'), true);
    assert.ok(env.target.style.getPropertyValue('mask-image').includes('data:image/svg+xml,'));
    env.body.classList.add('watch-mode');
  } });
  const promise = reveal.enter();
  env.step(780);
  assert.equal(await promise, true);
  assert.equal(reveal.active, false);
  assert.ok(env.reads.length >= 2 && env.reads.every(({ committed }) => committed));
  assert.equal(env.body.classList.contains('watch-mode'), true, 'the owner keeps control of watch mode');
  assert.equal(env.body.classList.contains('watch-reveal-animating'), false);
  assert.equal(env.target.style.getPropertyValue('mask-image'), 'url(original.svg)');
  assert.equal(env.frames.size + env.win.count() + env.doc.count(), 0);
});

test('wheel/touch, resize, Escape and hidden-page cancellation leave browser input untouched', async () => {
  const env = environment();
  const reveal = createVideoReveal(env);
  for (const [target, name, event] of [
    [env.win, 'wheel', { preventDefault() { assert.fail('wheel must remain available'); } }],
    [env.win, 'touchmove', {}],
    [env.win, 'resize', {}],
    [env.doc, 'keydown', { key: 'Escape' }],
    [env.doc, 'visibilitychange', {}],
  ]) {
    const promise = reveal.enter();
    if (name === 'visibilitychange') env.doc.hidden = true;
    target.emit(name, event);
    assert.equal(await promise, false, name);
    assert.equal(reveal.active, false);
    assert.equal(env.frames.size + env.win.count() + env.doc.count(), 0);
    env.doc.hidden = false;
  }
});

test('reduced motion commits synchronously, while destroy cancels and permanently releases resources', async () => {
  const env = environment();
  const calls = [];
  const reduced = createVideoReveal({ ...env, reducedMotion: true, onStart: () => calls.push('start'), onComplete: () => calls.push('complete') });
  const promise = reduced.enter();
  assert.deepEqual(calls, ['start', 'complete']);
  assert.equal(await promise, true);
  assert.equal(env.frames.size, 0);
  const reveal = createVideoReveal(env);
  const interrupted = reveal.enter();
  reveal.destroy();
  reveal.destroy();
  assert.equal(await interrupted, false);
  assert.equal(await reveal.enter(), false);
  assert.equal(env.frames.size + env.win.count() + env.doc.count(), 0);
});
