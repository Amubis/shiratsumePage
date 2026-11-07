import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoReveal, inverseCircleMask, inverseCirclePath, videoCoverRadius, videoRevealFrame } from '../src/video-reveal.js';

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
class Element {
  constructor(name = 'div') { this.localName = name; this.style = new Style(); this.attributes = new Map(); this.children = []; this.parentElement = null; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...nodes) { nodes.forEach((node) => { node.remove(); node.parentElement = this; this.children.push(node); }); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((node) => node !== this); this.parentElement = null; }
}
const element = (rect) => Object.assign(new Element(), { getBoundingClientRect: () => rect });
const walk = (node) => [node, ...node.children.flatMap(walk)];
const clips = (env) => walk(env.body).filter((node) => node.localName === 'clipPath');
const clipFor = (env, url) => clips(env).find((node) => node.getAttribute('id') === url.match(/#([^"')]+)/)?.[1]);

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
  const body = Object.assign(new Element('body'), { classList: { contains: (name) => classes.has(name), add: (name) => classes.add(name), remove: (name) => classes.delete(name) } });
  const doc = Object.assign(new Events(), { defaultView: win, body, hidden: false, createElementNS: (namespace, name) => new Element(name) });
  const hero = Object.assign(element({ left: 0, top: 0, width: 1000, height: 800 }), { ownerDocument: doc });
  const disc = element({ left: 10, top: 734, width: 52, height: 52 });
  const button = Object.assign(element({ left: 10, top: 734, width: 52, height: 52 }), { querySelector: () => disc });
  const target = element({ left: 100, top: 90, width: 220, height: 120 });
  target.style.setProperty('mask-image', 'url(original.svg)', 'important');
  target.style.setProperty('mask-size', '40px');
  target.style.setProperty('clip-path', 'url("#original-clip")', 'important');
  target.style.setProperty('-webkit-clip-path', 'inset(2px)');
  target.style.setProperty('overflow', 'visible', 'important');
  target.style.setProperty('overflow-x', 'visible', 'important');
  target.style.setProperty('overflow-y', 'auto');
  hero.style.setProperty('--video-reveal-clip', 'url("#original-veil")', 'important');
  disc.style.setProperty('transform', 'rotate(2deg)', 'important');
  return {
    hero, button, disc, target, targets: [target], win, doc, body, reads, frames,
    step(timestamp) { time = timestamp; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((fn) => fn(timestamp)); },
  };
}

test('the evenodd path keeps a true circular hole in each target coordinate system', () => {
  const rect = { left: 100, top: 50, width: 200, height: 100 };
  const center = { x: 130, y: 90 };
  const path = inverseCirclePath(rect, center, 22);
  assert.equal(path, 'M0 0 H200 V100 H0 Z M52 40 a22 22 0 1 0 -44 0 a22 22 0 1 0 44 0 Z');
  assert.equal(inverseCirclePath(rect, center, 0), 'M0 0 H200 V100 H0 Z');
  const svg = inverseCircleMask(rect, center, 22);
  assert.ok(svg.includes('viewBox="0 0 200 100"'));
  assert.ok(svg.includes('fill="white" fill-rule="evenodd"'));
  assert.ok(svg.includes(path));
  const radius = videoCoverRadius({ x: 30, y: 760 }, { width: 1000, height: 800 });
  assert.equal(radius, Math.hypot(970, 760) + 32);
  assert.equal(videoRevealFrame(0, radius).radius, 22);
  assert.equal(videoRevealFrame(120, radius).radius, 7);
  assert.ok(videoRevealFrame(200, radius).radius < videoRevealFrame(450, radius).radius);
  assert.equal(videoRevealFrame(780, radius).radius, radius);
  assert.equal(videoRevealFrame(780, radius).discScale, 1, 'the solid disc never grows to cover the screen');
  assert.equal(videoRevealFrame(780, radius).complete, true);
});

test('stable document clips reuse paths and URLs while cancellation restores all original styles', async () => {
  const env = environment();
  let starts = 0;
  let completes = 0;
  const reveal = createVideoReveal({ ...env, onStart() { starts++; }, onComplete() { completes++; } });
  const promise = reveal.enter();
  assert.equal(starts, 1, 'onStart runs synchronously in the user gesture');
  assert.equal(reveal.enter(), promise);
  assert.equal(env.frames.size, 1);
  assert.equal(clips(env).length, 2, 'one target clip and one pseudo-element clip are created per session');
  const targetURL = env.target.style.getPropertyValue('clip-path');
  const heroURL = env.hero.style.getPropertyValue('--video-reveal-clip');
  const path = clipFor(env, targetURL).children[0];
  const firstGeometry = path.getAttribute('d');
  assert.match(targetURL, /^url\("#live-clip-/);
  assert.equal(env.target.style.getPropertyValue('-webkit-clip-path'), targetURL);
  assert.equal(path.getAttribute('clip-rule'), 'evenodd');
  assert.equal(path.getAttribute('fill-rule'), 'evenodd');
  assert.equal(env.target.style.getPropertyValue('overflow'), 'hidden', 'overflowing descendants stay within the old mask viewport');
  assert.equal(env.target.style.getPropertyPriority('overflow'), 'important');
  assert.equal(env.target.style.getPropertyValue('mask-image'), 'url(original.svg)', 'pre-existing masks are never overwritten');
  env.step(120);
  assert.equal(env.disc.style.getPropertyValue('transform'), 'scale(0.318)');
  assert.equal(env.target.style.getPropertyValue('clip-path'), targetURL);
  assert.equal(env.hero.style.getPropertyValue('--video-reveal-clip'), heroURL);
  assert.equal(clipFor(env, targetURL).children[0], path);
  assert.notEqual(path.getAttribute('d'), firstGeometry);
  assert.equal(clips(env).length, 2);
  assert.equal(env.body.classList.contains('watch-reveal-animating'), true);
  reveal.cancel();
  assert.equal(await promise, false);
  assert.equal(reveal.active, false);
  assert.equal(completes, 0);
  assert.equal(env.target.style.getPropertyValue('clip-path'), 'url("#original-clip")');
  assert.equal(env.target.style.getPropertyPriority('clip-path'), 'important');
  assert.equal(env.target.style.getPropertyValue('-webkit-clip-path'), 'inset(2px)');
  assert.equal(env.target.style.getPropertyValue('overflow'), 'visible');
  assert.equal(env.target.style.getPropertyPriority('overflow'), 'important');
  assert.equal(env.target.style.getPropertyValue('overflow-x'), 'visible');
  assert.equal(env.target.style.getPropertyPriority('overflow-x'), 'important');
  assert.equal(env.target.style.getPropertyValue('overflow-y'), 'auto');
  assert.equal(env.target.style.getPropertyPriority('overflow-y'), '');
  assert.equal(env.target.style.getPropertyValue('mask-image'), 'url(original.svg)');
  assert.equal(env.target.style.getPropertyPriority('mask-image'), 'important');
  assert.equal(env.target.style.getPropertyValue('mask-size'), '40px');
  assert.equal(env.hero.style.getPropertyValue('--video-reveal-clip'), 'url("#original-veil")');
  assert.equal(env.hero.style.getPropertyPriority('--video-reveal-clip'), 'important');
  assert.equal(env.disc.style.getPropertyValue('transform'), 'rotate(2deg)');
  assert.equal(env.disc.style.getPropertyPriority('transform'), 'important');
  assert.equal(env.frames.size + env.win.count() + env.doc.count(), 0);
  assert.equal(clips(env).length, 0);
  const next = reveal.enter();
  assert.notEqual(next, promise);
  assert.equal(starts, 2);
  assert.notEqual(env.target.style.getPropertyValue('clip-path'), targetURL);
  reveal.cancel();
  assert.equal(await next, false);
  assert.equal(clips(env).length, 0);
});

test('completion commits watch mode under the opening before removing clips and transition lock', async () => {
  const env = environment();
  const reveal = createVideoReveal({ ...env, onComplete() {
    assert.equal(env.body.classList.contains('watch-reveal-animating'), true);
    assert.equal(clips(env).length, 2);
    assert.ok(clipFor(env, env.target.style.getPropertyValue('clip-path')));
    assert.equal(env.target.style.getPropertyValue('overflow'), 'hidden');
    env.body.classList.add('watch-mode');
  } });
  const promise = reveal.enter();
  env.step(780);
  assert.equal(await promise, true);
  assert.equal(reveal.active, false);
  assert.ok(env.reads.length >= 2 && env.reads.every(({ committed }) => committed));
  assert.equal(env.body.classList.contains('watch-mode'), true, 'the owner keeps control of watch mode');
  assert.equal(env.body.classList.contains('watch-reveal-animating'), false);
  assert.equal(env.target.style.getPropertyValue('clip-path'), 'url("#original-clip")');
  assert.equal(env.target.style.getPropertyValue('overflow'), 'visible');
  assert.equal(env.frames.size + env.win.count() + env.doc.count(), 0);
  assert.equal(clips(env).length, 0);
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
    assert.equal(clips(env).length, 0, `${name} releases document-level clip definitions`);
    assert.equal(env.target.style.getPropertyValue('overflow'), 'visible', `${name} restores the target's normal overflow`);
    env.doc.hidden = false;
  }
});

test('reduced motion commits synchronously without clips, while destroy releases an active session', async () => {
  const env = environment();
  const calls = [];
  const reduced = createVideoReveal({ ...env, reducedMotion: true, onStart: () => calls.push('start'), onComplete: () => calls.push('complete') });
  const promise = reduced.enter();
  assert.deepEqual(calls, ['start', 'complete']);
  assert.equal(await promise, true);
  assert.equal(env.frames.size, 0);
  assert.equal(clips(env).length, 0);
  const reveal = createVideoReveal(env);
  const interrupted = reveal.enter();
  reveal.destroy();
  reveal.destroy();
  assert.equal(await interrupted, false);
  assert.equal(await reveal.enter(), false);
  assert.equal(env.frames.size + env.win.count() + env.doc.count(), 0);
  assert.equal(clips(env).length, 0);
});

test('partial setup failure cleans already-created clips and restores the previous presentation', async () => {
  const env = environment();
  const create = env.doc.createElementNS;
  let definitions = 0;
  env.doc.createElementNS = (namespace, name) => {
    if (name === 'clipPath' && ++definitions === 2) throw new Error('SVG setup interrupted');
    return create(namespace, name);
  };
  const reveal = createVideoReveal(env);
  assert.equal(await reveal.enter(), false);
  assert.equal(reveal.active, false);
  assert.equal(clips(env).length, 0);
  assert.equal(env.target.style.getPropertyValue('clip-path'), 'url("#original-clip")');
  assert.equal(env.target.style.getPropertyValue('overflow'), 'visible');
  assert.equal(env.body.classList.contains('watch-reveal-animating'), false);
});

test('an interrupted geometry update releases live definitions instead of leaving an active reveal', async () => {
  const env = environment();
  const reveal = createVideoReveal(env);
  const promise = reveal.enter();
  env.target.getBoundingClientRect = () => { throw new Error('target became unavailable'); };
  env.step(200);
  assert.equal(await promise, false);
  assert.equal(reveal.active, false);
  assert.equal(clips(env).length, 0);
  assert.equal(env.frames.size + env.win.count() + env.doc.count(), 0);
});
