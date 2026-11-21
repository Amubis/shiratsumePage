import test from 'node:test';
import assert from 'node:assert/strict';
import { createLanguageTransition, languageTextFrames, languageTextTargets } from '../src/language-transition.js';

function fixture(t) {
  const listeners = new Map(), frames = new Map(), animations = []; let serial = 0, reduced = false;
  const eventTarget = name => ({
    addEventListener(event, handler) { listeners.set(`${name}:${event}`, handler); },
    removeEventListener(event) { listeners.delete(`${name}:${event}`); },
  });
  const win = { ...eventTarget('window'), getComputedStyle: () => ({ opacity: '.75', scale: '1.2 1', display: 'inline' }),
    requestAnimationFrame(fn) { frames.set(++serial, fn); return serial; }, cancelAnimationFrame(id) { frames.delete(id); } };
  const doc = { ...eventTarget('document'), defaultView: win, hidden: false };
  const node = name => {
    const classes = new Set();
    return { name, isConnected: true, classList: { contains: key => classes.has(key), add: key => classes.add(key), remove: key => classes.delete(key) },
      animate(keyframes, options) {
        let accept, reject;
        const animation = { node: name, keyframes, options, cancelled: false, finished: new Promise((yes, no) => { accept = yes; reject = no; }),
          finish() { accept(); }, cancel() { this.cancelled = true; reject(new Error('cancelled')); } };
        animations.push(animation); return animation;
      }, classes };
  };
  const old = node('old'), next = node('new'), root = { ownerDocument: doc, setAttribute() {} }; let targets = [old], commits = 0;
  const api = createLanguageTransition({ root, reducedMotion: () => reduced, getTargets: () => targets });
  t.after(() => api.destroy());
  return { api, doc, frames, animations, old, next, listeners, get commits() { return commits; }, set reduced(value) { reduced = value; },
    commit() { commits++; targets = [next]; }, finishAnimations() { animations.filter(a => !a.cancelled).forEach(a => a.finish()); },
    hide() { doc.hidden = true; listeners.get('document:visibilitychange')(); } };
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test('TV closure flattens quickly, widens increasingly, and leaves existing transforms untouched', () => {
  const frames = languageTextFrames('close');
  assert.deepEqual(frames.map(f => f.scale), ['1 1', '1.025 0.25', '1.08 0.065', '1.16 0.015']);
  assert.ok(frames.every(f => !('transform' in f)), 'individual scale composes with title skew and navigation transforms');
  assert.equal(languageTextFrames('open').at(-1).scale, '1 1');
});
test('the latest language commits at the closed frame and new DOM reveals with the original opacity and scale', async t => {
  const f = fixture(t), promise = f.api.run(f.commit);
  assert.equal(f.api.phase, 'collapsing'); assert.equal(f.commits, 0);
  assert.equal(f.animations[0].keyframes[0].scale, '1.2 1');
  assert.equal(f.animations[0].keyframes[0].opacity, .75);
  f.finishAnimations(); await tick();
  assert.equal(f.commits, 1); assert.equal(f.api.phase, 'expanding'); assert.equal(f.animations.at(-1).node, 'new');
  assert.equal(f.old.classes.size, 0);
  f.finishAnimations(); await tick(); assert.equal(await promise, true);
  assert.equal(f.next.classes.size, 0); assert.equal(f.frames.size, 0); assert.equal(f.api.busy, false);
});
test('rapid clicks discard obsolete commits; hidden or resized pages settle only the latest language', async t => {
  const f = fixture(t), first = f.api.run(() => { throw new Error('obsolete'); }), next = f.api.run(f.commit);
  assert.equal(await first, false); assert.equal(f.commits, 0); f.hide(); assert.equal(await next, true);
  assert.equal(f.commits, 1); assert.equal(f.old.classes.size, 0); assert.ok(f.animations.every(a => a.cancelled));
});
test('reduced motion and missing targets commit immediately, while cancellation and teardown never commit stale work', async t => {
  const f = fixture(t); f.reduced = true; assert.equal(await f.api.run(f.commit), true); assert.equal(f.animations.length, 0);
  f.reduced = false; const pending = f.api.run(f.commit); f.api.cancel(); assert.equal(await pending, false); assert.equal(f.commits, 1);
  const other = f.api.run(f.commit); f.api.destroy(); assert.equal(await other, false); assert.equal(f.listeners.size, 0); assert.equal(f.frames.size, 0);
  assert.equal(await f.api.run(f.commit), false);
});
test('commit errors release animated text and resize can finish a pending swap without losing it', async t => {
  const f = fixture(t), broken = f.api.run(() => { throw new Error('bad content'); });
  f.finishAnimations(); await tick(); await assert.rejects(broken, /bad content/); assert.equal(f.old.classes.size, 0);
  const next = f.api.run(f.commit); f.listeners.get('window:resize')(); assert.equal(await next, true); assert.equal(f.commits, 1);
});

test('text discovery wraps button text alone and excludes offscreen labels, SVG icons and nested duplicate targets', () => {
  const win = { innerWidth: 800, innerHeight: 600, getComputedStyle: node => ({ display: 'block', opacity: '1', visibility: 'visible', ...node.computed }) };
  const doc = { defaultView: win, createElement: tag => element(tag) };
  function element(tag, contents = '') {
    const el = { nodeType: 1, localName: tag, ownerDocument: doc, childNodes: [], className: '', isConnected: true, hidden: false,
      get textContent() { return this.childNodes.map(child => child.textContent).join(''); },
      append(child) { this.childNodes.push(child); child.parentNode = this; },
      contains(child) { return this.childNodes.some(node => node === child || node.contains?.(child)); },
      closest() { return this.hidden ? this : null; },
      matches(selector) { return selector.includes(this.localName) && ['svg', 'img', 'input', 'select', 'textarea'].includes(this.localName); },
      querySelector() { return this.childNodes.find(child => ['svg', 'img', 'input', 'select', 'textarea'].includes(child.localName)) || null; },
      getBoundingClientRect() { return { top: this.offscreen ? 900 : 10, bottom: this.offscreen ? 920 : 30, left: 10, right: 130, width: 120, height: 20 }; } };
    if (contents) el.append({ nodeType: 3, textContent: contents, replaceWith(replacement) { const index = this.parentNode.childNodes.indexOf(this); this.parentNode.childNodes[index] = replacement; replacement.parentNode = this.parentNode; this.parentNode = null; } });
    return el;
  }
  const button = element('button', '全部照片'), svg = element('svg'); button.append(svg);
  const heading = element('h2', '标题'), nested = element('small', '译文'); heading.append(nested);
  const offscreen = element('p', '不可见'); offscreen.offscreen = true;
  const root = { ownerDocument: doc, querySelectorAll: () => [button, heading, nested, offscreen] };
  const targets = languageTextTargets(root);
  assert.equal(targets.length, 2); assert.equal(targets[0].className, 'language-text-fragment');
  assert.equal(targets[0].textContent, '全部照片'); assert.equal(button.childNodes[1], svg);
  assert.equal(targets[1], heading); assert.equal(offscreen.childNodes[0].nodeType, 3);
});

test('target selectors discover the sort sticker, new localized controls and explicit component markers', () => {
  const win = { innerWidth: 1000, innerHeight: 800, getComputedStyle: () => ({ display: 'block', opacity: '1', visibility: 'visible' }) };
  const doc = { defaultView: win };
  const node = (className, marked = false) => ({
    ownerDocument: doc, localName: 'span', className, marked, isConnected: true, textContent: '可见译文',
    closest: () => null, querySelector: () => null,
    contains: () => false,
    getBoundingClientRect: () => ({ top: 20, bottom: 40, left: 20, right: 160, width: 140, height: 20 }),
  });
  const sort = node('album-sort-tab'), empty = node('album-empty'), retry = node('comments-retry');
  const remove = node('comment-delete-button'), manage = node('owner-tools-manage'), future = node('future-localized-control', true);
  const nickname = node('comment-author'), prose = node('comment-body');
  const candidates = [sort, empty, retry, remove, manage, future, nickname, prose];
  // Match the real selector string instead of returning all candidates no
  // matter what the production selector contains.
  const root = { ownerDocument: doc, querySelectorAll(selector) {
    const selectors = selector.split(',').map(value => value.trim());
    return candidates.filter(candidate => selectors.includes('.' + candidate.className) || candidate.marked && selectors.includes('[data-language-text]'));
  } };
  assert.deepEqual(languageTextTargets(root), [sort, empty, retry, remove, manage, future]);
});

test('empty placeholders animate independently and restore native fields on completion and interruption', async t => {
  const animations = [], overlays = [], handlers = new Map();
  const classes = () => {
    const values = new Set();
    return { contains: name => values.has(name), add: name => values.add(name), remove: name => values.delete(name) };
  };
  const win = {
    getComputedStyle: () => ({ display: 'block', opacity: '1', scale: '1', visibility: 'visible', fontSize: '14px', paddingLeft: '12px', paddingTop: '10px', borderLeftWidth: '1px', borderTopWidth: '1px' }),
    addEventListener(name, handler) { handlers.set('window:' + name, handler); }, removeEventListener(name) { handlers.delete('window:' + name); },
  };
  const doc = { defaultView: win, hidden: false, addEventListener() {}, removeEventListener() {} };
  const body = { append(node) { overlays.push(node); } }; doc.body = body;
  doc.createElement = () => {
    const overlay = { localName: 'span', ownerDocument: doc, isConnected: true, classList: classes(), style: {}, setAttribute() {},
      remove() { this.isConnected = false; overlays.splice(overlays.indexOf(this), 1); },
      animate(frames, options) {
        let finish, reject;
        const animation = { frames, options, finished: new Promise((yes, no) => { finish = yes; reject = no; }), finish() { finish(); }, cancel() { reject(new Error('cancelled')); } };
        animations.push(animation); return animation;
      } };
    return overlay;
  };
  const input = { localName: 'input', value: '', placeholder: '匿名访客', classList: classes(), isConnected: true, closest: () => null,
    getBoundingClientRect: () => ({ top: 50, bottom: 100, left: 20, right: 320, width: 300, height: 50 }) };
  const typed = { ...input, classList: classes(), value: '访客已填写的昵称' };
  const root = { ownerDocument: doc, setAttribute() {}, querySelectorAll: () => [input, typed],
    addEventListener(name, handler) { handlers.set('root:' + name, handler); }, removeEventListener(name) { handlers.delete('root:' + name); } };
  const api = createLanguageTransition({ root, getTargets: () => [] }); t.after(() => api.destroy());
  const first = api.run(() => { input.placeholder = '匿名の訪問者'; });
  assert.equal(overlays.length, 1); assert.equal(overlays[0].textContent, '匿名访客');
  assert.equal(input.classList.contains('language-placeholder-hidden'), true);
  assert.equal(typed.classList.contains('language-placeholder-hidden'), false);
  animations[0].finish(); await tick();
  assert.equal(api.phase, 'expanding'); assert.equal(overlays[0].textContent, '匿名の訪問者');
  animations.at(-1).finish(); await tick(); await first;
  assert.equal(overlays.length, 0); assert.equal(input.classList.contains('language-placeholder-hidden'), false);
  assert.equal(typed.value, '访客已填写的昵称');
  const pending = api.run(() => { input.placeholder = '匿名访客'; });
  handlers.get('root:input')(); await pending;
  assert.equal(api.phase, 'idle'); assert.equal(overlays.length, 0);
  assert.equal(input.classList.contains('language-placeholder-hidden'), false);
});
