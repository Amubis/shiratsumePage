import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTransform, shapeMatrix, projectShape, maskSvg, syncCloneAnimations, isShapeVisible, createContrastLayer } from '../src/contrast.js';
import { CLOVER_PATH, SMALL_CLOVER_PATH } from '../src/scene.js';

const close = (actual, expected) => actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-8, `component ${index}: ${value} ≠ ${expected[index]}`));
const point = ([a, b, c, d, e, f], x, y) => [a * x + c * y + e, b * x + d * y + f];

test('a translated, nonsquare clover keeps its actual path aspect ratio inside the text mask', () => {
  const shape = { width: 200, height: 100, rect: { left: 320, top: 180, width: 200, height: 100 }, transform: 'matrix(1, 0, 0, 1, -100, -50)', transformOrigin: '50% 50%', variant: 'small' };
  close(shapeMatrix(shape), [1, 0, 0, 1, 320, 180]);
  const projected = projectShape(shape, { left: 350, top: 200, width: 80, height: 40 });
  assert.equal(projected.path, SMALL_CLOVER_PATH);
  close(point(projected.matrix, 50, 50), [70, 30]);
  close(point(projected.matrix, 100, 100), [170, 80]);
});

test('a quarter-turn mask follows the rotated artwork, including its off-center transform origin', () => {
  const shape = { width: 200, height: 100, rect: { left: 310, top: 80, width: 100, height: 200 }, transform: 'matrix(0, 1, -1, 0, -100, -50)', transformOrigin: '20px 35px', variant: 'large' };
  const projection = projectShape(shape, { left: 350, top: 150, width: 80, height: 60 });
  assert.equal(projection.path, CLOVER_PATH);
  close(shapeMatrix(shape), [0, 1, -1, 0, 410, 80]);
  // The upper-right point is now below the center, rather than at the box edge.
  close(point(projection.matrix, 100, 0), [60, 130]);
  close(point(projection.matrix, 50, 50), [10, 30]);
});

test('a 45-degree rotation does not stretch the clover into its axis-aligned bounding box', () => {
  const root = Math.SQRT1_2;
  const shape = { width: 100, height: 100, rect: { left: 300, top: 200, width: 100 * Math.SQRT2, height: 100 * Math.SQRT2 }, transform: [root, root, -root, root, 0, 0], transformOrigin: '50% 50%' };
  const projection = projectShape(shape, { left: 320, top: 230, width: 100, height: 60 });
  close(point(projection.matrix, 0, 0), [50 * Math.SQRT2 - 20, -30]);
  close(point(projection.matrix, 100, 0), [100 * Math.SQRT2 - 20, 50 * Math.SQRT2 - 30]);
  close(point(projection.matrix, 0, 100), [-20, 50 * Math.SQRT2 - 30]);
});

test('nonuniform scale, skew, and a translated ancestor all remain in the projection', () => {
  const shape = { width: 160, height: 80, rect: { left: 70, top: 110, width: 260, height: 140 }, transform: 'matrix(1.5, 0.5, -0.25, 0.75, 36, -19)', transformOrigin: '25% 80%' };
  const projection = projectShape(shape, { left: 100, top: 120, width: 180, height: 100 });
  close(projection.matrix, [2.4, 0.8, -0.2, 0.6, -10, -10]);
  close(point(projection.matrix, 100, 0), [230, 70]);
  close(point(projection.matrix, 0, 100), [-30, 50]);
});

test('touching edges and zero-area targets need no white overlay; overlapping paths do', () => {
  const shape = { width: 100, height: 100, rect: { left: 100, top: 100, width: 100, height: 100 } };
  assert.equal(projectShape(shape, { left: 200, top: 120, width: 20, height: 20 }), null);
  assert.equal(projectShape(shape, { left: 110, top: 110, width: 0, height: 20 }), null);
  assert.equal(projectShape(shape, { left: 0, top: 0, width: 50, height: 50 }), null);
  assert.ok(projectShape(shape, { left: 199, top: 120, width: 20, height: 20 }));
});

test('CSS matrix3d uses the same 2D coefficients and alpha masks have a transparent background', () => {
  close(parseTransform('matrix3d(0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 80, 90, 0, 1)'), [0, 1, -1, 0, 80, 90]);
  const svg = maskSvg(80, 40, [{ path: SMALL_CLOVER_PATH, matrix: [1, 0, 0, 1, -10, 5] }]);
  assert.ok(svg.includes('viewBox="0 0 80 40"'));
  assert.ok(svg.includes(`fill="white" d="${SMALL_CLOVER_PATH}"`));
  assert.ok(svg.includes('transform="matrix(1 0 0 1 -10 5)"'));
  assert.ok(!svg.includes('<rect'));
  assert.ok(!svg.includes('black'));
  assert.equal((svg.match(/<path/g) || []).length, 1);
  assert.ok(!maskSvg(80, 40, []).includes('<path'));
});

test('an animated arrow clone resumes the source phase rather than restarting after refresh', () => {
  const arrow = { animationName: 'arrowNudge', currentTime: 725, startTime: 1200, playbackRate: 0.8, playState: 'running' };
  const fade = { animationName: 'fade', currentTime: 170, startTime: 1755, playbackRate: 1, playState: 'running' };
  const savedSource = { ...arrow };
  const clonedArrow = { animationName: 'arrowNudge', currentTime: 0, startTime: 1925, playbackRate: 1 };
  const clonedFade = { animationName: 'fade', currentTime: 0, startTime: 1925, playbackRate: 1 };
  let sourceReads = 0;
  let copyReads = 0;
  const source = { getAnimations(...args) { assert.equal(args.length, 0); sourceReads++; return [arrow, fade]; } };
  // An engine can return effects in another order; names establish the pairing.
  const clone = { getAnimations(...args) { assert.equal(args.length, 0); copyReads++; return [clonedFade, clonedArrow]; } };
  syncCloneAnimations([[source, clone]]);
  assert.equal(clonedArrow.currentTime, 725);
  assert.equal(clonedArrow.startTime, 1200);
  assert.equal(clonedArrow.playbackRate, 0.8);
  assert.equal(clonedFade.currentTime, 170);
  assert.equal(clonedFade.startTime, 1755);
  assert.deepEqual(arrow, savedSource);
  assert.equal(sourceReads, 1);
  assert.equal(copyReads, 1);
});

test('paused effects stay paused and absent/restricted animation APIs safely fall back', () => {
  let pauses = 0;
  const source = { getAnimations: () => [{ animationName: 'arrowNudge', currentTime: 420, startTime: null, playbackRate: 1, playState: 'paused' }] };
  const cloneAnimation = { animationName: 'arrowNudge', currentTime: 0, startTime: null, pause() { pauses++; } };
  // A rejected property assignment must not prevent the independent time sync.
  Object.defineProperty(cloneAnimation, 'playbackRate', { set() { throw new TypeError('read-only timeline'); } });
  assert.doesNotThrow(() => syncCloneAnimations([
    [{}, {}],
    [{ getAnimations() { throw new TypeError('unavailable'); } }, { getAnimations: () => [] }],
    [source, { getAnimations: () => [cloneAnimation] }],
  ]));
  assert.equal(pauses, 1);
  assert.equal(cloneAnimation.currentTime, 420);
  assert.equal(cloneAnimation.startTime, null);
});

test('intro-hidden clover groups cannot invert text until their ancestors become visible', () => {
  const scene = { parentElement: null };
  const group = { parentElement: scene };
  const first = { parentElement: group };
  const second = { parentElement: group };
  const styles = new Map([
    [scene, { display: 'block', visibility: 'visible', opacity: '1' }],
    [group, { display: 'block', visibility: 'visible', opacity: '0' }],
    [first, { display: 'block', visibility: 'visible', opacity: '1' }],
    [second, { display: 'block', visibility: 'visible', opacity: '1' }],
  ]);
  const reads = new Map();
  const readStyle = (node) => { reads.set(node, (reads.get(node) || 0) + 1); return styles.get(node); };
  const frameCache = new Map();
  assert.equal(isShapeVisible(first, scene, readStyle, frameCache), false);
  assert.equal(isShapeVisible(second, scene, readStyle, frameCache), false);
  assert.equal(reads.get(group), 1, 'shared ancestor styles are read once per paint');

  styles.set(group, { display: 'block', visibility: 'visible', opacity: '1' });
  assert.equal(isShapeVisible(first, scene, readStyle), true, 'next paint observes the reveal');
  styles.set(scene, { display: 'block', visibility: 'hidden', opacity: '1' });
  assert.equal(isShapeVisible(first, scene, readStyle), false, 'the scene itself is included');
  styles.set(scene, { display: 'none', visibility: 'visible', opacity: '1' });
  assert.equal(isShapeVisible(first, scene, readStyle), false);
});

test('combined low ancestor opacity delays the mask, even when every individual element is visible', () => {
  const scene = { parentElement: null };
  const wrapper = { parentElement: scene };
  const shape = { parentElement: wrapper };
  const styles = new Map([
    [scene, { opacity: '1' }],
    [wrapper, { opacity: '0.1' }],
    [shape, { opacity: '0.15' }],
  ]);
  assert.equal(isShapeVisible(shape, scene, (node) => styles.get(node)), false);
  styles.set(wrapper, { opacity: '0.5' });
  assert.equal(isShapeVisible(shape, scene, (node) => styles.get(node)), true);
});

class ClipElement {
  constructor(tag, doc) {
    this.nodeType = 1;
    this.localName = tag;
    this.ownerDocument = doc;
    this.values = new Map();
    this.childNodes = [];
    this.parentElement = null;
    this.style = { clipWrites: 0 };
    Object.defineProperty(this.style, 'cssText', { set(value) {
      for (const declaration of value.split(';')) {
        const [key, value] = declaration.split(':');
        if (key && value) this[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      }
    } });
    Object.defineProperty(this.style, 'clipPath', { get() { return this.clipValue; }, set(value) { this.clipWrites++; this.clipValue = value; } });
    this.style.setProperty = function (name, value) { this[name] = value; };
    this.style.getPropertyValue = function (name) { return this[name] || ''; };
    this.style.removeProperty = function (name) { delete this[name]; };
    this.classList = { contains: (name) => this.className.split(/\s+/).includes(name) };
  }
  get children() { return this.childNodes; }
  get attributes() { return [...this.values].map(([name, value]) => ({ name, value })); }
  get className() { return this.getAttribute('class') || ''; }
  set className(value) { this.setAttribute('class', value); }
  get dataset() { return Object.fromEntries([...this.values].filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value])); }
  get isConnected() { return this === this.ownerDocument.documentElement || Boolean(this.parentElement?.isConnected); }
  get textContent() { return this.text || this.children.map((child) => child.textContent).join(''); }
  set textContent(value) { this.text = value; this.replaceChildren(); }
  setAttribute(name, value) { this.values.set(name, String(value)); }
  getAttribute(name) { return this.values.get(name) ?? null; }
  hasAttribute(name) { return this.values.has(name); }
  removeAttribute(name) { this.values.delete(name); }
  append(...children) { children.forEach((child) => { child.remove(); child.parentElement = this; this.childNodes.push(child); }); }
  appendChild(child) { this.append(child); return child; }
  removeChild(child) { child.remove(); return child; }
  replaceChildren(...children) { this.childNodes.forEach((child) => { child.parentElement = null; }); this.childNodes = []; this.append(...children); }
  remove() { if (this.parentElement) this.parentElement.childNodes = this.parentElement.childNodes.filter((child) => child !== this); this.parentElement = null; }
  matches(selector) { return selector.split(',').some((value) => {
    const match = value.trim().match(/^(\w+)?(?:\[([^\]]+)\])?$/);
    if (match) return (!match[1] || match[1] === this.localName) && (!match[2] || this.hasAttribute(match[2]));
    return value.startsWith('.') ? this.classList.contains(value.slice(1)) : value.startsWith('#') && this.getAttribute('id') === value.slice(1);
  }); }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector); }
  querySelectorAll(selector) { return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  cloneNode(deep) { const clone = new ClipElement(this.localName, this.ownerDocument); this.values.forEach((value, name) => clone.setAttribute(name, value)); clone.text = this.text; if (deep) clone.append(...this.children.map((child) => child.cloneNode(true))); return clone; }
  getBoundingClientRect() { return this.rect || this.parentElement.getBoundingClientRect(); }
}

function contrastFixture() {
  const frames = new Map();
  const docListeners = new Map();
  const winListeners = new Map();
  let serial = 0;
  const doc = {
    hidden: false,
    createElement: (tag) => new ClipElement(tag, doc),
    createElementNS: (namespace, tag) => { const node = new ClipElement(tag, doc); node.namespaceURI = namespace; return node; },
    addEventListener: (name, callback) => docListeners.set(name, callback),
    removeEventListener: (name) => docListeners.delete(name),
  };
  doc.defaultView = {
    requestAnimationFrame(callback) { frames.set(++serial, callback); return serial; },
    cancelAnimationFrame(id) { frames.delete(id); },
    getComputedStyle(node) { return { display: 'block', visibility: 'visible', opacity: '1', transform: 'none', transformOrigin: '50% 50%', paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px', ...node.computed }; },
    addEventListener: (name, callback) => winListeners.set(name, callback),
    removeEventListener: (name) => winListeners.delete(name),
  };
  doc.documentElement = doc.createElement('html');
  doc.body = doc.createElement('body');
  doc.documentElement.append(doc.body);
  const scene = doc.createElement('section');
  const shape = doc.createElement('div');
  shape.setAttribute('data-contrast-shape', '');
  shape.setAttribute('data-shape-variant', 'large');
  shape.offsetWidth = shape.offsetHeight = 100;
  shape.rect = { left: 0, top: 0, width: 100, height: 100 };
  const target = doc.createElement('h1');
  target.setAttribute('data-contrast', '');
  target.rect = { left: 10, top: 10, width: 80, height: 40 };
  const label = doc.createElement('span');
  label.setAttribute('id', 'model-name');
  label.setAttribute('data-i18n', 'name');
  label.textContent = 'しらつめ';
  target.append(label);
  scene.append(shape, target);
  doc.body.append(scene);
  return { doc, scene, shape, target, label, frames, docListeners, winListeners, step(time) { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(time)); } };
}

test('animated contrast keeps one local clip URL and path node while exact geometry moves', () => {
  const env = contrastFixture();
  const layer = createContrastLayer({ scene: env.scene });
  const copy = env.target.querySelector('.contrast-copy');
  const url = copy.style.clipPath;
  const path = env.doc.body.querySelector('clipPath').children[0];
  const initial = path.getAttribute('transform');
  assert.ok(url.startsWith('url(') && !url.includes('data:'));
  assert.equal(copy.style.webkitClipPath, url);
  assert.equal(copy.style.visibility, 'visible');
  for (let index = 1; index <= 90; index++) {
    env.shape.rect = { left: index / 10, top: 0, width: 100, height: 100 };
    env.step(index * 40);
    assert.equal(copy.style.clipPath, url);
    assert.equal(env.doc.body.querySelector('clipPath').children[0], path);
  }
  assert.notEqual(path.getAttribute('transform'), initial);
  assert.equal(copy.style.clipWrites, 1, 'animation never reassigns the resource URL');
  assert.equal(copy.style.maskImage, undefined);
  assert.equal(copy.style.webkitMaskImage, undefined);
  env.shape.rect = { left: 1000, top: 0, width: 100, height: 100 };
  env.step(3640);
  assert.equal(copy.style.visibility, 'hidden');
  assert.equal(env.doc.body.querySelector('clipPath').children.length, 0);
  layer.destroy();
});

test('language refresh and visibility lifecycle release stable clips without duplicate IDs or stale frames', () => {
  const env = contrastFixture();
  const layer = createContrastLayer({ scene: env.scene });
  const oldClip = env.doc.body.querySelector('clipPath');
  env.label.textContent = '白詰草';
  layer.refresh();
  assert.equal(oldClip.isConnected, false);
  assert.equal(env.target.querySelectorAll('.contrast-copy').length, 1);
  assert.equal(env.doc.body.querySelectorAll('clipPath').length, 1);
  const copy = env.target.querySelector('.contrast-copy');
  assert.equal(copy.textContent, '白詰草');
  assert.equal(copy.querySelector('[id]'), null);
  assert.equal(copy.querySelector('[data-i18n]'), null);
  env.doc.hidden = true;
  env.docListeners.get('visibilitychange')();
  assert.equal(env.frames.size, 0);
  assert.equal(copy.style.visibility, 'hidden');
  env.doc.hidden = false;
  env.docListeners.get('visibilitychange')();
  assert.equal(env.frames.size, 1);
  assert.equal(copy.style.visibility, 'visible');
  layer.destroy();
  layer.destroy();
  assert.equal(env.doc.body.querySelectorAll('clipPath').length, 0);
  assert.equal(env.target.querySelector('.contrast-copy'), null);
  assert.equal(env.frames.size + env.docListeners.size + env.winListeners.size, 0);
});
