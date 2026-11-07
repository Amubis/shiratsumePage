import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageReveal, sanitizePageClone } from '../src/transition-preview.js';
import { CLOVER_PATH } from '../src/scene.js';

class Element {
  constructor(name, attributes = {}, children = []) {
    this.localName = name;
    this.namespaceURI = name === 'svg' ? 'http://www.w3.org/2000/svg' : 'http://www.w3.org/1999/xhtml';
    this.values = new Map(Object.entries(attributes));
    this.children = [];
    this.parentElement = null;
    this.style = {};
    Object.defineProperty(this.style, 'cssText', { set(value) {
      for (const declaration of value.split(';')) {
        const [key, value] = declaration.split(':');
        if (key && value) this[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      }
    } });
    this.append(...children);
  }
  get attributes() { return [...this.values].map(([name, value]) => ({ name, value })); }
  getAttribute(name) { return this.values.get(name) ?? null; }
  hasAttribute(name) { return this.values.has(name); }
  setAttribute(name, value) { this.values.set(name, String(value)); }
  removeAttribute(name) { this.values.delete(name); }
  append(...children) { for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); } }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this); this.parentElement = null; }
  cloneNode(deep) { return new Element(this.localName, Object.fromEntries(this.values), deep ? this.children.map((child) => child.cloneNode(true)) : []); }
}
const E = (name, attributes, children) => new Element(name, attributes, children);
const walk = (node) => [node, ...node.children.flatMap(walk)];

test('a snapshot removes document/navigation hooks without changing the source or graying buttons', () => {
  const source = E('section', { id: 'hello', class: 'page-section hello-section', 'aria-labelledby': 'hello-heading', 'data-page': 'hello' }, [
    E('h2', { id: 'hello-heading', 'data-i18n': 'helloHeading' }),
    E('button', { 'data-go': '2', onclick: 'navigate()', autofocus: '' }),
    E('a', { href: '#moments', tabindex: '0' }),
    E('img', { src: './photo.jpg', loading: 'lazy', 'data-model-image': '' }),
  ]);
  const snapshot = sanitizePageClone(source.cloneNode(true));
  assert.equal(snapshot.getAttribute('id'), null);
  assert.equal(snapshot.getAttribute('aria-labelledby'), null);
  assert.equal(snapshot.getAttribute('class'), 'page-section hello-section');
  assert.ok(walk(snapshot).every((node) => node.attributes.every(({ name }) => !name.startsWith('data-') && !name.startsWith('on'))));
  const [, button, link, image] = snapshot.children;
  assert.equal(button.getAttribute('tabindex'), '-1');
  assert.equal(button.hasAttribute('disabled'), false);
  assert.equal(button.hasAttribute('autofocus'), false);
  assert.equal(link.getAttribute('href'), null);
  assert.equal(image.getAttribute('loading'), 'eager');
  assert.equal(source.getAttribute('id'), 'hello');
  assert.equal(source.children[1].getAttribute('data-go'), '2');
  assert.equal(source.children[3].getAttribute('loading'), 'lazy');
});

test('SVG dotted shadows retain their local pattern, clip and use references with unique IDs', () => {
  const decoration = () => E('svg', {}, [
    E('defs', {}, [E('pattern', { id: 'dots' }), E('clipPath', { id: 'clip' })]),
    E('g', { 'clip-path': 'url(#clip)', style: 'fill:url("#dots")' }, [E('rect', { fill: 'url(#dots)' })]),
    E('use', { 'xlink:href': '#dots' }),
    E('use', { href: '#icon-arrow' }),
  ]);
  const snapshot = sanitizePageClone(E('section', {}, [decoration(), decoration()]), { prefix: 'preview' });
  const [first, second] = snapshot.children;
  const ids = walk(snapshot).map((node) => node.getAttribute('id')).filter(Boolean);
  assert.equal(ids.length, 4);
  assert.equal(new Set(ids).size, 4);
  for (const svg of [first, second]) {
    const [pattern, clip] = svg.children[0].children;
    const group = svg.children[1];
    assert.equal(group.getAttribute('clip-path'), `url(#${clip.getAttribute('id')})`);
    assert.equal(group.getAttribute('style'), `fill:url(#${pattern.getAttribute('id')})`);
    assert.equal(group.children[0].getAttribute('fill'), `url(#${pattern.getAttribute('id')})`);
    assert.equal(svg.children[2].getAttribute('xlink:href'), `#${pattern.getAttribute('id')}`);
    assert.equal(svg.children[3].getAttribute('href'), '#icon-arrow');
  }
});

function environment() {
  const pending = new Map();
  let serial = 0;
  let reads = 0;
  let now = 0;
  const win = {
    innerWidth: 150, innerHeight: 100,
    performance: { now: () => now },
    requestAnimationFrame(fn) { pending.set(++serial, fn); return serial; },
    cancelAnimationFrame(id) { pending.delete(id); },
    getComputedStyle(shape) { reads++; return { transform: shape.transform, transformOrigin: '50px 50px' }; },
  };
  const body = E('body');
  const doc = {
    defaultView: win, body,
    createElement: (name) => E(name),
    createElementNS: (namespace, name) => { const node = E(name); node.namespaceURI = namespace; return node; },
  };
  const container = E('div');
  container.ownerDocument = doc;
  const section = E('section', { id: 'hello', class: 'page-section hello-section' }, [E('img', { src: './photo.jpg', loading: 'lazy' })]);
  const shape = { offsetWidth: 100, offsetHeight: 100, transform: 'matrix(1,0,0,1,0,0)', rect: { left: 20, top: 30, width: 100, height: 100 }, getBoundingClientRect() { return this.rect; } };
  return {
    container, shape, section, pending, doc,
    reads: () => reads,
    step(time) { now = time; const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach((fn) => fn(time)); },
  };
}
const clips = (env) => walk(env.doc.body).filter((node) => node.localName === 'clipPath');

test('the incoming DOM begins transparent, follows the actual growing clover, then seals and cleans up', () => {
  const env = environment();
  const reveal = createPageReveal(env);
  assert.equal(reveal.element.style.visibility, 'hidden');
  const stableURL = reveal.element.style.clipPath;
  assert.match(stableURL, /^url\("#live-clip-/);
  assert.equal(clips(env).length, 1);
  const clip = clips(env)[0];
  assert.equal(clip.children.length, 0, 'an empty live clip hides the initial snapshot');
  assert.equal(reveal.element.style.maskImage, undefined);
  assert.equal(reveal.element.getAttribute('aria-hidden'), 'true');
  assert.equal(reveal.element.inert, true);
  assert.equal(env.container.children.length, 1);
  reveal.start();
  const path = clip.children[0];
  assert.equal(path.getAttribute('d'), CLOVER_PATH);
  assert.equal(path.getAttribute('transform'), 'matrix(1 0 0 1 20 30)');
  assert.equal(reveal.element.style.webkitClipPath, stableURL);
  reveal.start();
  assert.equal(env.pending.size, 1);

  env.shape.transform = 'matrix(2,0,0,2,-50,-50)';
  env.shape.rect = { left: -30, top: -20, width: 200, height: 200 };
  env.step(20);
  assert.equal(reveal.element.style.clipPath, stableURL, 'animation never replaces a resource URL');
  assert.equal(clip.children[0], path, 'frames reuse the existing SVG path node');
  assert.equal(path.getAttribute('transform'), 'matrix(2 0 0 2 -30 -20)');
  reveal.seal();
  assert.equal(env.pending.size, 0);
  assert.equal(reveal.element.style.clipPath, 'none');
  assert.equal(reveal.element.style.webkitClipPath, 'none');
  assert.equal(reveal.element.style.visibility, 'visible');
  assert.equal(env.container.children.length, 1);
  reveal.destroy();
  reveal.destroy();
  reveal.start();
  assert.equal(env.container.children.length, 0);
  assert.equal(env.pending.size, 0);
  assert.equal(clips(env).length, 0, 'destroy releases the document-level clip definition');
  assert.equal(env.section.getAttribute('id'), 'hello');
});

test('leaving the viewport clears geometry without changing the document clip URL', () => {
  const env = environment();
  const reveal = createPageReveal(env);
  reveal.start();
  const url = reveal.element.style.clipPath;
  env.shape.rect = { left: 1000, top: 1000, width: 100, height: 100 };
  env.step(20);
  assert.equal(clips(env)[0].children.length, 0);
  assert.equal(reveal.element.style.clipPath, url);
  reveal.destroy();
  assert.equal(clips(env).length, 0);
});

test('high-refresh displays are throttled to 60fps without freezing after 60 total updates', () => {
  const env = environment();
  const reveal = createPageReveal(env);
  reveal.start();
  const timestamps = [];
  let previousReads = env.reads();
  for (let index = 1; index <= 288; index++) {
    const timestamp = index * 1000 / 144;
    env.step(timestamp);
    if (env.reads() !== previousReads) timestamps.push(timestamp);
    previousReads = env.reads();
  }
  assert.ok(timestamps.length > 60, 'sampling continues through a longer animation');
  assert.ok(timestamps.length <= 120);
  for (let index = 1; index < timestamps.length; index++) assert.ok(timestamps[index] - timestamps[index - 1] >= 1000 / 60);
  reveal.destroy();
  const stoppedReads = env.reads();
  env.step(2200);
  assert.equal(env.reads(), stoppedReads);
});
