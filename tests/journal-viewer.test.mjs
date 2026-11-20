import test from 'node:test';
import assert from 'node:assert/strict';
import { createJournalViewer } from '../src/journal-viewer.js';

class Element {
  constructor(tag, doc) {
    this.localName = tag; this.ownerDocument = doc; this.children = []; this.attributes = new Map(); this.listeners = new Map(); this.classes = new Set(); this.open = false;
    this.classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name), contains: name => this.classes.has(name), toggle: (name, state) => (state ?? !this.classes.has(name)) ? this.classes.add(name) : this.classes.delete(name) };
    if (doc?.animations) this.animate = (frames, options) => {
      let resolve, reject;
      const item = { frames, options, node: this, done: false, cancelled: false, finished: new Promise((yes, no) => { resolve = yes; reject = no; }), finish() { this.done = true; resolve(); }, cancel() { this.cancelled = true; reject(new Error('cancel')); } };
      doc.animations.push(item); return item;
    };
  }
  set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  removeAttribute(key) { this.attributes.delete(key); }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const child of this.children) child.parentElement = null; this.children = []; this.append(...nodes); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null; }
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback); }
  emit(type, fields = {}) { const event = { type, target: this, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...fields }; for (const callback of this.listeners.get(type) || []) callback(event); return event; }
  querySelectorAll(selector) {
    const matches = node => selector === 'dialog[open]' ? node.localName === 'dialog' && node.open : selector.startsWith('.') ? node.classes.has(selector.slice(1)) : node.localName === selector;
    return this.children.flatMap(node => [...(matches(node) ? [node] : []), ...node.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  focus() { this.ownerDocument.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit('close'); }
}

const tick = async () => { for (let pass = 0; pass < 8; pass++) await Promise.resolve(); };
function fixture(t, { animated = false, reduced = false } = {}) {
  const doc = new Element('document'); doc.ownerDocument = doc;
  if (animated) doc.animations = [];
  doc.defaultView = { matchMedia: () => ({ matches: reduced }) };
  doc.createElement = tag => new Element(tag, doc);
  doc.body = doc.createElement('body'); doc.append(doc.body);
  const mount = doc.createElement('main'); doc.body.append(mount);
  let entries = Array.from({ length: 3 }, (_, index) => ({ id: `post-${index}`, title: `Title ${index}`, images: [{ url: `./${index}-1.jpg`, alt: { zh: '图片一', ja: '画像一' } }, { url: `./${index}-2.jpg`, alt: '图片二' }] }));
  let locale = 'zh';
  const comments = new Map(entries.map(post => [post.id, doc.createElement('section')]));
  const releases = [], returns = [], take = [];
  const words = () => ({ viewPost: locale === 'ja' ? '記事を見る' : '查看碎碎念', closePost: '关闭', previousPost: '上一篇', nextPost: '下一篇', viewImage: '图片', closeImage: '关闭图片', previousImage: '上一张', nextImage: '下一张', imageUnavailable: '不可用' });
  const viewer = createJournalViewer({ document: doc, mount, getEntries: () => entries, getWords: words, getLocale: () => locale,
    renderArticle(post) { const article = doc.createElement('article'); article.setAttribute('data-journal-id', post.id); return article; },
    takeComments(post) { take.push(post.id); return comments.get(post.id); },
    releaseComments(post) { releases.push(post.id); mount.append(comments.get(post.id)); },
    onReturn(post) { returns.push(post.id); return mount; },
  });
  t.after(() => viewer.destroy());
  return { doc, mount, viewer, releases, returns, take, comments,
    get entries() { return entries; }, set entries(value) { entries = value; },
    set locale(value) { locale = value; },
    get detail() { return doc.querySelector('.journal-detail-viewer'); },
    get images() { return doc.querySelector('.personal-image-viewer'); },
    async settle() { for (let pass = 0; pass < 5; pass++) { doc.animations?.filter(item => !item.done && !item.cancelled).forEach(item => item.finish()); await tick(); } },
  };
}

test('detail navigation retains the actual thread node and returns the selected entry once', t => {
  const f = fixture(t);
  assert.equal(f.viewer.open('missing'), false);
  assert.equal(f.viewer.open('post-0'), true);
  assert.equal(f.detail.querySelector('.journal-detail-previous').disabled, true);
  assert.equal(f.detail.querySelector('.journal-detail-comments').children[0] === f.comments.get('post-0'), true);
  f.detail.querySelector('.journal-detail-next').emit('click');
  assert.equal(f.viewer.selectedId, 'post-1');
  assert.deepEqual(f.releases, ['post-0']);
  assert.equal(f.detail.querySelector('.journal-detail-comments').children[0] === f.comments.get('post-1'), true);
  f.viewer.close();
  assert.deepEqual(f.returns, ['post-1']);
  assert.deepEqual(f.releases, ['post-0', 'post-1']);
  assert.equal(f.doc.activeElement === f.mount, true);
  assert.equal(f.doc.body.classList.contains('modal-open'), false);
});

test('closing during a pending animated change cancels the new selection and returns the visible entry', async t => {
  const f = fixture(t, { animated: true });
  f.viewer.open('post-0'); await f.settle();
  f.detail.querySelector('.journal-detail-next').emit('click');
  assert.equal(f.viewer.selectedId, 'post-0');
  f.viewer.close(); await f.settle();
  assert.equal(f.detail.open, false);
  assert.equal(f.viewer.selectedId, null);
  assert.deepEqual(f.returns, ['post-0']);
  assert.equal(f.doc.body.classList.contains('modal-open'), false);
  assert.ok(f.doc.animations.every(item => item.options.easing.startsWith('cubic-bezier(')));
});

test('rapid animated requests commit one selected neighbor and leave no stale return animation', async t => {
  const f = fixture(t, { animated: true });
  f.viewer.open('post-0'); await f.settle();
  const next = f.detail.querySelector('.journal-detail-next'); next.emit('click'); next.emit('click');
  await f.settle();
  assert.equal(f.viewer.selectedId, 'post-1');
  assert.deepEqual(f.releases, ['post-0']);
  f.detail.querySelector('.journal-detail-previous').emit('click'); await f.settle();
  assert.equal(f.viewer.selectedId, 'post-0');
  assert.equal(f.detail.querySelector('.journal-detail-previous').disabled, true);
});

test('text entry arrows do not change posts while detail Escape still closes the reading surface', t => {
  const f = fixture(t);
  f.viewer.open('post-1');
  f.detail.emit('keydown', { key: 'ArrowRight', target: f.doc.createElement('textarea') });
  assert.equal(f.viewer.selectedId, 'post-1');
  const next = f.detail.emit('keydown', { key: 'ArrowRight' });
  assert.equal(next.prevented, true); assert.equal(f.viewer.selectedId, 'post-2');
  assert.equal(f.detail.querySelector('.journal-detail-next').disabled, true);
  const escape = f.detail.emit('keydown', { key: 'Escape', target: f.doc.createElement('textarea') });
  assert.equal(escape.prevented, true); assert.equal(f.detail.open, false);
});

test('nested image Escape restores its opener and keeps the underlying detail locked', t => {
  const f = fixture(t);
  f.viewer.open('post-0');
  const opener = f.doc.createElement('button');
  f.viewer.openImage(f.entries[0], 0, opener);
  assert.equal(f.images.open, true);
  assert.equal(f.images.querySelector('.personal-image-previous').disabled, true);
  f.images.querySelector('.personal-image-full').emit('error');
  assert.equal(f.images.querySelector('.personal-image-error').hidden, false);
  f.images.emit('keydown', { key: 'ArrowRight' });
  assert.equal(f.images.querySelector('.personal-image-full').src, './0-2.jpg');
  assert.equal(f.images.querySelector('.personal-image-error').hidden, true);
  f.images.emit('keydown', { key: 'Escape' });
  assert.equal(f.images.open, false); assert.equal(f.detail.open, true);
  assert.equal(f.doc.activeElement === opener, true);
  assert.equal(f.doc.body.classList.contains('modal-open'), true);
  f.viewer.close(); assert.equal(f.doc.body.classList.contains('modal-open'), false);
});

test('reduced motion is immediate and refreshing a removed post safely closes the detail', t => {
  const f = fixture(t, { animated: true, reduced: true });
  f.viewer.open('post-1');
  f.detail.querySelector('.journal-detail-next').emit('click');
  assert.equal(f.viewer.selectedId, 'post-2');
  f.locale = 'ja'; f.viewer.refresh();
  assert.equal(f.detail.getAttribute('aria-label'), '記事を見る');
  assert.equal(f.doc.animations.length, 0);
  f.entries = []; f.viewer.refresh();
  assert.equal(f.detail.open, false);
  assert.deepEqual(f.returns, ['post-2']);
});
