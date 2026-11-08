import test from 'node:test';
import assert from 'node:assert/strict';
import { INTRO_ENTRANCE_TIMING, introPopScale, introActorPose, createIntroEntrance } from '../src/intro-entrance.js';

class Node {
  constructor(name = 'div', attributes = {}) {
    this.localName = name;
    this.attributes = new Map(Object.entries(attributes));
    this.values = new Map();
    this.classes = new Set();
    this.events = new Map();
    this.one = new Map();
    this.many = new Map();
    this.inert = false;
    this.isConnected = true;
    this.style = { setProperty: (key, value) => this.values.set(key, value), removeProperty: (key) => this.values.delete(key) };
    this.classList = { toggle: (key, value) => value ? this.classes.add(key) : this.classes.delete(key), contains: (key) => this.classes.has(key) };
  }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  querySelector(key) { return this.one.get(key) || null; }
  querySelectorAll(key) { return this.many.get(key) || []; }
  addEventListener(key, fn) { if (!this.events.has(key)) this.events.set(key, new Set()); this.events.get(key).add(fn); }
  removeEventListener(key, fn) { this.events.get(key)?.delete(fn); }
  emit(key, event = {}) { for (const fn of this.events.get(key) || []) fn(event); }
}

function sectionFixture(doc, { blank = false, noBandData = false } = {}) {
  const section = new Node('section'); section.ownerDocument = doc;
  const stage = new Node('button'), footer = new Node(), cue = new Node(), meta = new Node();
  const texts = [new Node('p'), new Node('h2'), new Node('span'), new Node('p'), new Node('p'), new Node('button')];
  const decorations = [new Node('span'), new Node('span'), new Node('span')];
  const svg = new Node('svg', { viewBox: '0 0 1440 900', 'data-dot-spacing': '18' });
  const top = new Node('g', noBandData ? {} : { 'data-band': 'top', mask: 'url(#top-mask)' });
  const bottom = new Node('g', noBandData ? {} : { 'data-band': 'bottom', mask: 'url(#bottom-mask)' });
  const circles = [[top, 720, 0, 10], [top, 720, 54, 4], [bottom, 720, 846, 4], [bottom, 720, 900, 10]].map(([parent, x, y, radius]) => {
    const node = new Node('circle', { cx: String(x), cy: String(y), r: String(blank ? 0 : radius) });
    node.parentElement = parent;
    return node;
  });
  section.one.set('.outfit-stage', stage); section.one.set('.outfit-footer', footer);
  section.one.set('.outfit-cue', cue); section.one.set('.primary-intro > .section-footer', meta);
  section.one.set('.intro-halftone-seam svg', svg);
  const selectors = ['.model-intro-copy > .section-number', '.model-intro-title h2', '.model-intro-reading', '.model-intro-lead', '.model-intro-description', '.model-intro-copy > .text-link'];
  selectors.forEach((selector, index) => section.one.set(selector, texts[index]));
  section.many.set('.intro-halftone-seam circle', circles);
  section.many.set('.model-intro-title > span:first-child, .intro-quote-mark', decorations);
  return { section, stage, footer, cue, meta, texts, decorations, circles, groups: [top, bottom] };
}

function fixture({ reduced = false, enabled = true } = {}) {
  const win = new Node(), doc = new Node(); doc.defaultView = win; doc.hidden = false;
  const frames = new Map(); let serial = 0, time = 0;
  win.performance = { now: () => time };
  win.requestAnimationFrame = (fn) => { frames.set(++serial, fn); return serial; };
  win.cancelAnimationFrame = (id) => frames.delete(id);
  const dom = sectionFixture(doc);
  const controller = createIntroEntrance({ section: dom.section, reducedMotion: () => reduced, isEnabled: () => enabled });
  const at = (milliseconds) => { time = milliseconds; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((fn) => fn(time)); };
  return { ...dom, doc, win, frames, controller, at, setReduced(value) { reduced = value; }, setEnabled(value) { enabled = value; } };
}
const value = (node, key) => Number(node.values.get(key));
const radius = (circle) => Number(circle.getAttribute('r'));

test('water poses emerge from below, travel above the surface, then settle without vertical snapping', () => {
  const start = introActorPose(0), peak = introActorPose(.44), landing = introActorPose(.74), rest = introActorPose(1);
  assert.ok(start.y > 60 && start.opacity === 0 && start.scale < 1);
  assert.ok(peak.y < -15 && peak.scale > 1 && peak.opacity === 1);
  assert.ok(landing.y > 0 && landing.scale < 1);
  assert.deepEqual(rest, { y: 0, scale: 1, rotation: 0, opacity: 1 });
  assert.equal(introPopScale(0), 0); assert.equal(introPopScale(1), 1);
  assert.ok(introPopScale(.54) > 1.1);
});

test('outer rows pop first while opaque circles keep the original shared alpha masks', async () => {
  const f = fixture();
  assert.equal(f.controller.prepare(), true);
  assert.ok(f.circles.every((circle) => radius(circle) === 0));
  const done = f.controller.enter();
  f.at(240);
  assert.ok(radius(f.circles[0]) > 10, 'outer upper row has overshot its full radius');
  assert.ok(radius(f.circles[3]) > 10, 'outer lower row rises at the same wave rank');
  assert.equal(radius(f.circles[1]), 0); assert.equal(radius(f.circles[2]), 0);
  assert.equal(f.groups[0].getAttribute('mask'), 'url(#top-mask)');
  assert.ok(f.circles.every((circle) => circle.getAttribute('opacity') === null));
  f.at(INTRO_ENTRANCE_TIMING.total);
  assert.equal(await done, true);
  assert.deepEqual(f.circles.map(radius), [10, 4, 4, 10]);
  assert.equal(f.frames.size, 0);
  f.controller.destroy();
});

test('portrait settles before controls, text appears top-to-bottom and decorative supports arrive last', async () => {
  const f = fixture(); f.controller.prepare(); const done = f.controller.enter();
  f.at(900);
  assert.ok(value(f.section, '--intro-actor-alpha') > .99);
  assert.equal(value(f.section, '--intro-controls-alpha'), 0);
  assert.ok(f.texts.every((node) => value(node, '--intro-text-alpha') === 0));
  assert.equal(value(f.section, '--intro-decor-alpha'), 0);
  assert.equal(f.stage.inert, true);
  f.at(1100);
  assert.equal(f.stage.inert, false);
  assert.equal(value(f.section, '--intro-controls-alpha'), 0);
  f.at(1280);
  assert.ok(value(f.section, '--intro-controls-alpha') > 0);
  assert.ok(value(f.texts[0], '--intro-text-alpha') > 0);
  assert.equal(value(f.texts[1], '--intro-text-alpha'), 0);
  assert.equal(value(f.section, '--intro-decor-alpha'), 0);
  f.at(2050);
  assert.ok(f.texts.every((node) => value(node, '--intro-text-alpha') > .98));
  assert.equal(value(f.section, '--intro-decor-alpha'), 0);
  f.at(2350);
  assert.ok(value(f.section, '--intro-decor-alpha') > .9);
  f.at(INTRO_ENTRANCE_TIMING.total);
  assert.equal(await done, true);
  assert.equal(f.footer.inert, false); assert.equal(f.texts.at(-1).inert, false);
  f.controller.destroy();
});

test('a sanitized wipe snapshot shares the same time and source radii without replaying on handoff', async () => {
  const f = fixture(); f.controller.prepare();
  const snapshot = sectionFixture(f.doc, { blank: true, noBandData: true });
  const detach = f.controller.attach(snapshot.section);
  const done = f.controller.enter(); f.at(700);
  assert.deepEqual(snapshot.circles.map(radius), f.circles.map(radius));
  assert.equal(snapshot.section.values.get('--intro-actor-y'), f.section.values.get('--intro-actor-y'));
  assert.equal(f.controller.elapsed, 700);
  detach();
  const frozen = snapshot.section.values.get('--intro-actor-y');
  f.at(1200);
  assert.equal(snapshot.section.values.get('--intro-actor-y'), frozen);
  f.at(INTRO_ENTRANCE_TIMING.total); assert.equal(await done, true);
  f.controller.destroy();
});

test('replay restores full target radii instead of treating an interrupted small dot as its new size', async () => {
  const f = fixture(); f.controller.prepare(); const first = f.controller.enter(); f.at(90);
  assert.ok(radius(f.circles[0]) < 10);
  f.controller.prepare(); assert.equal(await first, false);
  const second = f.controller.enter(); f.at(90 + INTRO_ENTRANCE_TIMING.total);
  assert.equal(await second, true);
  assert.deepEqual(f.circles.map(radius), [10, 4, 4, 10]);
  const replacement = new Node('circle', { cx: '720', cy: '0', r: '12' });
  replacement.parentElement = f.groups[0];
  f.section.many.set('.intro-halftone-seam circle', [replacement]); f.controller.refresh();
  assert.equal(radius(replacement), 12);
  f.controller.destroy();
});

test('reduced motion, disabled model, interruption and keyboard escape leave readable content', async () => {
  for (const kind of ['reduced', 'disabled', 'resize', 'hidden', 'keyboard', 'motion-change']) {
    const f = fixture({ reduced: kind === 'reduced', enabled: kind !== 'disabled' });
    f.controller.prepare(); const done = f.controller.enter();
    if (kind === 'resize') f.win.emit('resize');
    if (kind === 'hidden') { f.doc.hidden = true; f.doc.emit('visibilitychange'); }
    if (kind === 'keyboard') f.doc.emit('keydown', { key: 'Tab' });
    if (kind === 'motion-change') { f.setReduced(true); f.at(100); }
    await done;
    assert.deepEqual(f.circles.map(radius), [10, 4, 4, 10], kind);
    assert.equal(value(f.section, '--intro-actor-alpha'), 1, kind);
    assert.equal(f.stage.inert, false, kind); assert.equal(f.footer.inert, false, kind);
    assert.equal(f.frames.size, 0, kind);
    f.controller.destroy();
  }
});

test('destruction resolves active work, stops floating and detaches all lifecycle handlers', async () => {
  const f = fixture(); f.controller.prepare(); const done = f.controller.enter(); f.at(250);
  f.controller.destroy(); f.controller.destroy();
  assert.equal(await done, false);
  assert.equal(f.controller.state, 'destroyed');
  assert.equal(f.section.classes.has('intro-float-ready'), false);
  assert.equal(f.section.classes.has('intro-enter-managed'), false);
  assert.equal(f.frames.size, 0);
  assert.equal(await f.controller.enter(), false);
  for (const node of [f.doc, f.win]) assert.ok([...node.events.values()].every((listeners) => listeners.size === 0));
});
