import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutfitRailFeedback, outfitRailFeedbackPose, outfitRailRipplePose, OUTFIT_RAIL_FEEDBACK_TIMING } from '../src/outfit-rail-feedback.js';

class Target {
  constructor() {
    this.listeners = new Map();
    this.style = { setProperty(name, value) { this[name] = String(value); } };
  }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, fields = {}) { const event = { type, target: this, ...fields }; this.listeners.get(type)?.forEach(fn => fn(event)); return event; }
  listenerCount() { return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0); }
}

function fixture(t) {
  const doc = new Target(), win = new Target(), media = new Target(), root = new Target();
  const buttons = Array.from({ length: 4 }, () => new Target());
  const circles = buttons.map(() => new Target()), clover = new Target();
  const frames = new Map();
  let clock = 0, serial = 0, reduced = false, enabled = true;
  doc.defaultView = win; root.ownerDocument = doc;
  win.requestAnimationFrame = callback => { const id = ++serial; frames.set(id, callback); return id; };
  win.cancelAnimationFrame = id => frames.delete(id);
  win.matchMedia = () => media;
  buttons.forEach((button, index) => { button.style.left = `${44 * index}px`; });
  clover.style.transform = 'rotate(37deg)';
  const api = createOutfitRailFeedback({ root, buttons, circles, clover, pickIndex: x => Math.max(0, Math.min(3, Math.round(x / 44))), reducedMotion: () => reduced, isEnabled: () => enabled });
  t.after(() => api.destroy());
  function tick(duration) {
    const end = clock + duration;
    while (clock < end) {
      clock += 10;
      const batch = [...frames]; batch.forEach(([id]) => frames.delete(id)); batch.forEach(([, callback]) => callback(clock));
    }
  }
  const scale = (node = clover) => Number(node.style['--outfit-feedback-scale']);
  const offset = index => parseFloat(circles[index].style['--outfit-feedback-x']);
  return { root, doc, win, media, buttons, circles, clover, frames, api, tick, scale, offset,
    reduce() { reduced = true; media.matches = true; media.emit('change'); }, disable() { enabled = false; api.cancel(); },
  };
}

test('water ripple changes visual ink with a bounded, distance-decaying influence', () => {
  const press = outfitRailRipplePose(1, 5, -1);
  assert.ok(Math.abs(press.dots[1].scale - .82) < 1e-10);
  assert.equal(press.dots[1].x, 0);
  assert.ok(press.dots[0].x > 0 && press.dots[2].x < 0, 'neighbors converge toward the pressed option');
  assert.ok(Math.abs(press.dots[3].x) < Math.abs(press.dots[2].x));
  assert.ok(press.dots[4].scale > press.dots[3].scale && press.dots[3].scale > press.dots[2].scale);
  assert.ok(press.dots.every(dot => Math.abs(dot.x) < 5 && dot.scale >= .82));
  const release = outfitRailFeedbackPose(.35, { from: press, center: 1, count: 5 });
  assert.ok(release.clover > 1.18 && release.dots[0].x < 0, 'rebound briefly expands scale and spacing');
  assert.deepEqual(outfitRailFeedbackPose(1, { from: press, center: 1, count: 5 }), outfitRailRipplePose(1, 5));
  assert.ok(OUTFIT_RAIL_FEEDBACK_TIMING.release >= 420 && OUTFIT_RAIL_FEEDBACK_TIMING.release <= 620);
});

test('a pointer press stays small until release and settles without moving hit targets or rolling rotation', t => {
  const f = fixture(t);
  f.buttons[1].emit('pointerdown', { pointerId: 4, button: 0, clientX: 44 });
  f.tick(1000);
  assert.equal(f.scale(), .82);
  assert.equal(f.frames.size, 0, 'a held pose does not keep scheduling frames');
  assert.ok(f.offset(0) > 0 && f.offset(2) < 0);
  assert.deepEqual(f.buttons.map(button => button.style.left), ['0px', '44px', '88px', '132px']);
  assert.equal(f.clover.style.transform, 'rotate(37deg)');
  f.buttons[1].emit('pointerup', { pointerId: 99 });
  assert.equal(f.frames.size, 0, 'an unrelated pointer cannot release a held press');
  f.win.emit('pointerup', { pointerId: 4 });
  f.tick(200);
  assert.ok(f.scale() > 1.17);
  const visible = f.scale();
  f.buttons[1].emit('click', { detail: 1, clientX: 44 });
  assert.equal(f.scale(), visible, 'the native click does not restart the pointer rebound');
  f.tick(400);
  assert.equal(f.scale(), 1);
  assert.equal(f.frames.size, 0);
  assert.ok(f.circles.every(circle => Number(circle.style['--outfit-feedback-scale']) === 1));
  assert.ok(f.circles.every(circle => parseFloat(circle.style['--outfit-feedback-x']) === 0));
});

test('a new gesture restarts from the visible pose without cumulative position offsets', t => {
  const f = fixture(t);
  f.buttons[0].emit('pointerdown', { pointerId: 1, clientX: 0 }); f.tick(150);
  f.buttons[0].emit('pointerup', { pointerId: 1 }); f.tick(200);
  const before = f.circles.map(circle => ({ ...circle.style })), beforeScale = f.scale();
  f.buttons[3].emit('pointerdown', { pointerId: 2, clientX: 132 });
  assert.equal(f.scale(), beforeScale);
  assert.ok(f.circles.every((circle, index) => circle.style['--outfit-feedback-x'] === before[index]['--outfit-feedback-x']));
  f.tick(200);
  assert.equal(f.scale(f.circles[3]), .82);
  f.buttons[3].emit('pointerup', { pointerId: 2 }); f.tick(600);
  assert.equal(f.scale(), 1);
  assert.ok(f.circles.every(circle => parseFloat(circle.style['--outfit-feedback-x']) === 0));
});

test('pointer feedback uses the rail picker including the outermost snap zones', t => {
  const f = fixture(t);
  f.buttons[1].emit('pointerdown', { pointerId: 1, clientX: 1000 }); f.tick(150);
  assert.equal(f.scale(f.circles[3]), .82, 'the visible edge option controls feedback even over another fixed hit element');
  assert.ok(f.scale(f.circles[0]) > .98);
  f.root.emit('pointercancel');
  f.root.emit('pointerdown', { pointerId: 2, clientX: -1000 }); f.tick(150);
  assert.equal(f.scale(f.circles[0]), .82);
});

test('keyboard activation and direct clicks get press/rebound feedback without changing selection events', t => {
  const f = fixture(t);
  const event = f.buttons[2].emit('keydown', { key: 'Enter' }); f.tick(150);
  assert.equal(event.prevented, undefined);
  assert.equal(f.scale(f.circles[2]), .82);
  f.buttons[2].emit('click', { detail: 0 }); f.tick(200);
  assert.equal(f.scale(), .82, 'Enter stays pressed through a native keydown click');
  f.buttons[2].emit('keyup', { key: 'Enter' }); f.tick(600);
  assert.equal(f.scale(), 1);
  f.buttons[0].emit('click', { detail: 0 });
  f.tick(130);
  assert.ok(f.scale() < .9);
  f.tick(600);
  assert.equal(f.scale(), 1);
});

test('cancellation, hidden pages, reduced motion, disabling, and destroy restore the neutral pose', t => {
  const f = fixture(t);
  const hold = () => { f.buttons[1].emit('pointerdown', { pointerId: 1, clientX: 44 }); f.tick(160); assert.equal(f.scale(), .82); };
  const neutral = () => { assert.equal(f.scale(), 1); assert.equal(f.frames.size, 0); };
  hold(); f.buttons[1].emit('pointercancel'); neutral();
  hold(); f.win.emit('blur'); neutral();
  hold(); f.doc.hidden = true; f.doc.emit('visibilitychange'); neutral(); f.doc.hidden = false;
  hold(); f.reduce(); neutral();
  f.buttons[1].emit('pointerdown', { pointerId: 2, clientX: 44 }); f.tick(200); neutral();
  f.disable(); neutral();
  f.api.destroy(); neutral();
  assert.equal([f.root, f.doc, f.win, f.media, ...f.buttons].reduce((sum, node) => sum + node.listenerCount(), 0), 0);
  f.buttons[1].emit('click', { detail: 0 }); f.tick(800); neutral();
});
