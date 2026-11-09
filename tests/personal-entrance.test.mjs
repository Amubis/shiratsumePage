import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonalEntrance, generatePersonalSceneLayout, personalAvatarPose, PERSONAL_ENTRANCE_TIMING } from '../src/personal-entrance.js';

class Node {
  constructor() {
    this.events = new Map(); this.one = new Map(); this.values = new Map(); this.classes = new Set(); this.inert = false;
    this.style = { setProperty: (key, value) => this.values.set(key, value) };
    this.classList = { toggle: (key, value) => value ? this.classes.add(key) : this.classes.delete(key), contains: key => this.classes.has(key) };
  }
  querySelector(key) { return this.one.get(key) || null; }
  addEventListener(key, callback) { if (!this.events.has(key)) this.events.set(key, new Set()); this.events.get(key).add(callback); }
  removeEventListener(key, callback) { this.events.get(key)?.delete(callback); }
  emit(key) { for (const callback of this.events.get(key) || []) callback(); }
}
function fixture(t, { reduced = false, enabled = true } = {}) {
  const win = new Node(), doc = new Node(), section = new Node(), content = new Node(), page = new Node();
  doc.defaultView = win; doc.hidden = false; section.ownerDocument = doc;
  section.one.set('.personal-inner', content); section.one.set('#personal-page', page);
  const texts = ['.personal-eyebrow', '.personal-name', '.personal-bio', '.personal-socials', '.personal-journal', '.personal-return'].map(selector => { const node = new Node(); section.one.set(selector, node); return node; });
  let time = 0, id = 0, observerCallback;
  const frames = new Map();
  win.performance = { now: () => time };
  win.requestAnimationFrame = callback => { frames.set(++id, callback); return id; };
  win.cancelAnimationFrame = key => frames.delete(key);
  win.MutationObserver = class { constructor(callback) { observerCallback = callback; } observe() {} disconnect() { observerCallback = null; } };
  const controller = createPersonalEntrance({ section, reducedMotion: () => reduced, isEnabled: () => enabled });
  t.after(() => controller.destroy());
  const at = milliseconds => { time = milliseconds; const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(time)); };
  return { win, doc, section, content, texts, controller, frames, at, updateDOM() { observerCallback?.(); }, setReduced(value) { reduced = value; }, setEnabled(value) { enabled = value; } };
}
const value = (node, key) => Number(node.values.get(key));

test('bubble portrait rises from below, overshoots, stretches and returns to its original circle', () => {
  const start = personalAvatarPose(0), peak = personalAvatarPose(.42), rebound = personalAvatarPose(.7), end = personalAvatarPose(1);
  assert.ok(start.y > 50 && start.scaleX < .5 && start.opacity === 0);
  assert.ok(peak.y < -10 && peak.scaleX > 1 && peak.scaleY < 1 && peak.opacity === 1);
  assert.ok(rebound.y > 0 && rebound.scaleY > 1);
  assert.deepEqual(end, { y: 0, scaleX: 1, scaleY: 1, opacity: 1 });
});

test('personal clovers stay smaller than the home scene and leave the central reading column open', () => {
  for (let seed = 0; seed < 100; seed++) {
    const layout = generatePersonalSceneLayout(seed);
    assert.equal(layout.length, 4);
    assert.ok(layout.every(shape => shape.size >= 9 && shape.size <= 18 && (shape.x <= 25 || shape.x >= 76)));
    assert.ok(layout.every(shape => shape.alpha <= .23));
    assert.deepEqual(layout, generatePersonalSceneLayout(seed));
  }
  assert.notDeepEqual(generatePersonalSceneLayout('a'), generatePersonalSceneLayout('b'));
});

test('preparing the chapter cannot spend its arrival before the explicit post-wave enter call', async t => {
  const f = fixture(t);
  f.at(5000);
  assert.equal(f.controller.state, 'prepared');
  assert.equal(value(f.section, '--personal-avatar-alpha'), 0);
  assert.ok(f.texts.every(node => value(node, '--personal-item-alpha') === 0));
  assert.equal(f.frames.size, 0);
  assert.equal(f.content.inert, true);
  const done = f.controller.enter();
  assert.equal(f.controller.enter(), done);
  f.at(5450);
  assert.ok(value(f.section, '--personal-avatar-alpha') > .9);
  assert.ok(f.texts.every(node => value(node, '--personal-item-alpha') === 0));
  f.at(5000 + PERSONAL_ENTRANCE_TIMING.total);
  assert.equal(await done, true);
  assert.equal(f.controller.state, 'ready');
  assert.equal(f.content.inert, false);
  assert.equal(f.frames.size, 0);
  assert.equal(await f.controller.enter(), true);
  assert.equal(f.frames.size, 0, 'a repeated arrival callback does not replay the scene');
});

test('copy and footer float up in sequence after the avatar begins, without replaying on profile rebuild', async t => {
  const f = fixture(t); const done = f.controller.enter();
  f.at(900);
  assert.ok(value(f.texts[0], '--personal-item-alpha') > value(f.texts[1], '--personal-item-alpha'));
  assert.ok(value(f.texts[1], '--personal-item-alpha') > value(f.texts[2], '--personal-item-alpha'));
  assert.equal(value(f.texts[3], '--personal-item-alpha'), 0);
  assert.equal(value(f.texts[5], '--personal-item-alpha'), 0);
  const replaced = new Node(); f.section.one.set('.personal-name', replaced); f.updateDOM();
  assert.equal(value(replaced, '--personal-item-alpha'), value(f.texts[1], '--personal-item-alpha'));
  assert.equal(f.controller.state, 'playing');
  f.controller.finish(); assert.equal(await done, true);
  const replacement = new Node(); f.section.one.set('.personal-name', replacement); f.updateDOM();
  assert.equal(value(replacement, '--personal-item-alpha'), 1);
  assert.equal(f.frames.size, 0);
});

test('interruption, disabling, hidden pages and reduced motion leave readable content and release promises', async t => {
  const f = fixture(t); const first = f.controller.enter(); f.at(300);
  f.controller.prepare(); assert.equal(await first, false);
  const next = f.controller.enter(); f.controller.setEnabled(false);
  assert.equal(await next, false); assert.equal(f.content.inert, false); assert.equal(f.frames.size, 0);
  f.controller.setEnabled(true); f.controller.prepare(); const hidden = f.controller.enter(); f.doc.hidden = true; f.doc.emit('visibilitychange');
  assert.equal(await hidden, true); assert.equal(f.content.inert, false);
  f.doc.hidden = false; f.controller.prepare(); const motion = f.controller.enter(); f.setReduced(true); f.at(1000);
  assert.equal(await motion, true); assert.equal(value(f.section, '--personal-avatar-alpha'), 1);
  f.controller.destroy(); assert.equal(f.frames.size, 0);
  for (const node of [f.doc, f.win]) assert.ok([...node.events.values()].every(set => set.size === 0));
});
