import test from 'node:test';
import assert from 'node:assert/strict';
import { createStableClip } from '../src/stable-clip.js';

class Node {
  constructor(name) { this.localName = name; this.values = new Map(); this.children = []; this.style = {}; this.writes = 0; }
  setAttribute(name, value) { this.values.set(name, String(value)); this.writes++; }
  getAttribute(name) { return this.values.get(name) ?? null; }
  removeAttribute(name) { this.values.delete(name); }
  append(node) { node.parentElement = this; this.children.push(node); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null; }
}
const document = () => ({ body: new Node('body'), createElementNS: (_, name) => new Node(name) });
const definition = doc => doc.body.children[0].children[0].children[0];

test('clips have unique stable local URLs and remain available to WebKit rendering', () => {
  const doc = document();
  const first = createStableClip({ document: doc, prefix: 'text' });
  const second = createStableClip({ document: doc, prefix: 'text' });
  assert.notEqual(first.id, second.id);
  assert.equal(first.url, `url("#${first.id}")`);
  assert.ok(!first.url.includes('data:'));
  assert.equal(definition(doc).getAttribute('clipPathUnits'), 'userSpaceOnUse');
  assert.ok(!/display\s*:\s*none|visibility\s*:\s*hidden/.test(doc.body.children[0].style.cssText));
  assert.equal(doc.body.children[0].getAttribute('width'), '0');
  assert.equal(doc.body.children[0].getAttribute('aria-hidden'), 'true');
  first.destroy(); second.destroy();
  assert.equal(doc.body.children.length, 0);
});

test('animated geometry reuses the same definition and path nodes without reloading URLs', () => {
  const doc = document();
  const clip = createStableClip({ document: doc });
  clip.update([{ path: 'M0 0H10V10Z', matrix: [1, 0, 0, 1, 20, 30] }]);
  const root = doc.body.children[0], def = definition(doc), path = def.children[0], url = clip.url;
  const writes = path.writes;
  clip.update([{ path: 'M0 0H10V10Z', matrix: [1, 0, 0, 1, 20, 30] }]);
  assert.equal(path.writes, writes);
  for (let i = 0; i < 90; i++) clip.update([{ path: 'M0 0H10V10Z', matrix: [1, 0, 0, 1, i, 30] }]);
  assert.equal(doc.body.children[0], root);
  assert.equal(def.children[0], path);
  assert.equal(clip.url, url);
  assert.equal(path.getAttribute('transform'), 'matrix(1 0 0 1 89 30)');
});

test('union paths, inverse evenodd paths, empty clips and cleanup keep their intended geometry', () => {
  const doc = document(), clip = createStableClip({ document: doc });
  clip.update([{ path: 'M0 0H100V100H0Z M20 20H40V40H20Z', rule: 'evenodd' }, { path: 'M50 50H60V60Z' }]);
  const def = definition(doc);
  assert.equal(def.children.length, 2);
  assert.equal(def.children[0].getAttribute('clip-rule'), 'evenodd');
  assert.equal(def.children[0].getAttribute('fill-rule'), 'evenodd');
  assert.equal(def.children[1].getAttribute('clip-rule'), 'nonzero');
  clip.update([]);
  assert.equal(def.children.length, 0);
  clip.destroy(); clip.destroy();
  clip.update([{ path: 'M0 0H10V10Z' }]);
  assert.equal(doc.body.children.length, 0);
});

test('invalid projected geometry leaves the previously visible path unchanged', () => {
  const doc = document(), clip = createStableClip({ document: doc });
  clip.update([{ path: 'M0 0H10V10Z' }]);
  const path = definition(doc).children[0];
  assert.throws(() => clip.update([{ path: 'M2 2H20V20Z', matrix: [1, 0, 0, 1, NaN, 0] }]), TypeError);
  assert.equal(definition(doc).children[0], path);
  assert.equal(path.getAttribute('d'), 'M0 0H10V10Z');
});
