import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_OWNER_PROFILE, localizeOwnerText, safeOwnerURL, createOwnerProfile,
} from '../src/owner-profile.js';

class Element {
  constructor(tag, doc) {
    this.localName = tag;
    this.ownerDocument = doc;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.parentElement = null;
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      contains: (name) => this.classes.has(name),
    };
  }
  get className() { return [...this.classes].join(' '); }
  set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
  get textContent() { return this.text ?? this.children.map((node) => node.textContent).join(''); }
  set textContent(value) { this.text = value; this.replaceChildren(); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...nodes) { nodes.forEach((node) => { node.parentElement = this; this.children.push(node); }); }
  replaceChildren(...nodes) {
    this.children.forEach((node) => { node.parentElement = null; });
    this.children = [];
    this.append(...nodes);
  }
  contains(node) { return Boolean(node) && (node === this || this.children.some((child) => child.contains(node))); }
  querySelectorAll(selector) {
    const matches = (node) => selector.startsWith('.') ? node.classList.contains(selector.slice(1))
      : selector.startsWith('#') ? node.id === selector.slice(1) : node.localName === selector;
    return this.children.flatMap((child) => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, handler, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push({ handler, once: options?.once });
  }
  removeEventListener(type, handler) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry.handler !== handler));
  }
  emit(type, fields = {}) {
    const event = { type, target: this, relatedTarget: null, pointerType: 'mouse', ...fields };
    for (let node = this; node; node = node.parentElement) {
      for (const { handler, once } of [...(node.listeners.get(type) || [])]) {
        handler(event);
        if (once) node.removeEventListener(type, handler);
      }
    }
    return event;
  }
  focus() {
    const previous = this.ownerDocument.activeElement;
    this.ownerDocument.activeElement = this;
    if (previous !== this) {
      previous?.emit('focusout', { relatedTarget: this });
      this.emit('focusin', { relatedTarget: previous });
    }
  }
}

function fixture(t, options = {}) {
  const doc = new Element('document');
  doc.ownerDocument = doc;
  doc.createElement = (tag) => new Element(tag, doc);
  const timers = new Map();
  let serial = 0;
  let clock = 0;
  doc.defaultView = {
    setTimeout(callback, delay) { const id = ++serial; timers.set(id, { callback, at: clock + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const body = doc.createElement('body');
  doc.append(body);
  const root = doc.createElement('div');
  body.append(root);
  doc.activeElement = body;
  const component = createOwnerProfile({ root, ...options });
  const button = root.querySelector('.owner-avatar');
  const card = root.querySelector('.owner-card');
  const tick = (ms) => {
    clock += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= clock) { timers.delete(id); timer.callback(); }
    }
  };
  t.after(() => component.destroy());
  return { doc, body, root, button, card, component, timers, tick };
}

test('default owner profile provides no fabricated owner avatar or contact information', (t) => {
  assert.equal(DEFAULT_OWNER_PROFILE.avatar, null);
  assert.deepEqual(DEFAULT_OWNER_PROFILE.contacts, []);
  const f = fixture(t);
  assert.equal(f.button.getAttribute('aria-expanded'), 'false');
  assert.equal(f.card.getAttribute('aria-hidden'), 'true');
  assert.equal(f.card.hidden, true);
  assert.equal(f.button.getAttribute('aria-controls'), f.card.id);
  assert.equal(f.card.getAttribute('aria-labelledby'), f.root.querySelector('.owner-name').id);
  assert.equal(f.root.querySelector('.owner-name').textContent, '关于我');
  assert.equal(f.root.querySelector('.owner-empty').textContent, '暂未公开联系方式');
  assert.equal(f.root.querySelectorAll('a').length, 0);
  assert.equal(f.root.querySelectorAll('img').length, 0);
  assert.ok(f.root.querySelector('.owner-avatar-fallback'));
});

test('URL filtering accepts intended avatar/contact schemes and rejects executable or malformed URLs', () => {
  assert.equal(safeOwnerURL('https://example.com/me'), 'https://example.com/me');
  assert.equal(safeOwnerURL('mailto:owner@example.com'), 'mailto:owner@example.com');
  assert.equal(safeOwnerURL('tel:+819012345678'), 'tel:+819012345678');
  for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,hi', 'blob:https://example.com/a', 'file:///tmp/a', '//example.com/me', './contact', 'java\nscript:alert(1)', 'mailto:', 'tel:']) {
    assert.equal(safeOwnerURL(url), null, url);
  }
  for (const url of ['./assets/owner.jpg', '../owner.png', '/images/owner.webp', 'images/owner.jpg', 'https://example.com/owner.jpg']) {
    assert.equal(safeOwnerURL(url, 'avatar'), url);
  }
  for (const url of ['data:image/svg+xml,bad', 'javascript:alert(1)', 'mailto:owner@example.com', '//example.com/a', '\\example.com\\a', '#home', '?x=1']) {
    assert.equal(safeOwnerURL(url, 'avatar'), null, url);
  }
});

test('profile content stays text, unsafe contacts are omitted, and language changes update real links', (t) => {
  const f = fixture(t, { profile: {
    name: { zh: '<img onerror=alert(1)>', ja: 'わたしについて' },
    bio: { zh: '欢迎 <script>bad()</script>', ja: '小さな庭へようこそ。' },
    avatar: 'javascript:alert(1)',
    contacts: [
      { label: { zh: '<b>邮件</b>', ja: 'メール' }, url: 'mailto:owner@example.com' },
      { label: 'unsafe', url: 'data:text/html,bad' },
    ],
  } });
  assert.equal(f.root.querySelector('.owner-name').textContent, '<img onerror=alert(1)>');
  assert.equal(f.root.querySelector('.owner-name').children.length, 0);
  assert.equal(f.root.querySelectorAll('script').length, 0);
  assert.equal(f.root.querySelectorAll('a').length, 1);
  assert.equal(f.root.querySelector('a').textContent, '<b>邮件</b>');
  assert.equal(f.root.querySelector('a').href, 'mailto:owner@example.com');
  f.button.emit('click');
  f.component.setLanguage('ja');
  assert.equal(f.button.getAttribute('aria-label'), 'わたしについて');
  assert.equal(f.root.querySelector('a').textContent, 'メール');
  assert.equal(f.card.hidden, false, 'localization does not close an already open card');
  assert.equal(localizeOwnerText({ zh: 'fallback' }, 'ja'), 'fallback');
});

test('hover card stays reachable across the gap and closes after the pointer leaves the combined region', (t) => {
  const f = fixture(t);
  f.button.emit('pointerenter');
  assert.equal(f.card.hidden, false);
  f.root.emit('pointerleave');
  f.tick(149);
  assert.equal(f.card.hidden, false);
  f.root.emit('pointerenter');
  f.tick(200);
  assert.equal(f.card.hidden, false);
  f.root.emit('pointerleave');
  f.tick(150);
  assert.equal(f.card.hidden, true);
  assert.equal(f.button.getAttribute('aria-expanded'), 'false');
});

test('touch focus followed by its click opens once rather than immediately toggling shut', (t) => {
  const f = fixture(t);
  f.button.emit('pointerdown', { pointerType: 'touch' });
  f.button.emit('pointerenter', { pointerType: 'touch' });
  assert.equal(f.card.hidden, true);
  f.button.focus();
  f.button.emit('click', { detail: 1 });
  assert.equal(f.card.hidden, false);
  f.root.emit('pointerleave', { pointerType: 'touch' });
  f.tick(1000);
  assert.equal(f.card.hidden, false);
  f.button.emit('click', { detail: 1 });
  assert.equal(f.card.hidden, true);
});

test('keyboard focus can enter contacts and Escape closes without reopening on returned focus', (t) => {
  const f = fixture(t, { profile: { contacts: [{ label: 'Contact', url: 'https://example.com/contact' }] } });
  f.button.focus();
  assert.equal(f.card.hidden, false);
  const contact = f.root.querySelector('a');
  contact.focus();
  assert.equal(f.card.hidden, false);
  f.root.emit('pointerleave');
  f.tick(150);
  assert.equal(f.card.hidden, false, 'keyboard focus in the card keeps it open');
  f.doc.emit('keydown', { key: 'Escape' });
  assert.equal(f.card.hidden, true);
  assert.equal(f.doc.activeElement, f.button);
  assert.equal(f.button.getAttribute('aria-expanded'), 'false');
  assert.equal(contact.target, '_blank');
  assert.equal(contact.rel, 'noopener noreferrer');
  f.button.emit('pointerenter');
  f.body.emit('click');
  assert.equal(f.card.hidden, true, 'outside clicks dismiss the card without stealing focus');
});

test('profile updates replace data without stale image errors overriding the current avatar', (t) => {
  const f = fixture(t, { profile: { avatar: './assets/first.jpg', contacts: [] } });
  const oldImage = f.root.querySelector('img');
  f.component.update({ avatar: './assets/second.jpg', name: 'Owner', bio: '', contacts: [] });
  const currentImage = f.root.querySelector('img');
  assert.notEqual(oldImage, currentImage);
  oldImage.emit('error');
  assert.equal(f.root.querySelector('img'), currentImage);
  currentImage.emit('error');
  assert.equal(f.root.querySelector('img'), null);
  assert.ok(f.root.querySelector('.owner-avatar-fallback'));
  assert.equal(f.root.querySelector('.owner-bio').hidden, true);
  f.component.setLanguage('ja');
  assert.equal(f.root.querySelector('.owner-empty').textContent, '連絡先はまだ公開していません');
});

test('close/destroy clean pending timers and remove interaction listeners', (t) => {
  const f = fixture(t);
  f.button.emit('pointerenter');
  f.root.emit('pointerleave');
  assert.equal(f.timers.size, 1);
  f.component.close();
  assert.equal(f.timers.size, 0);
  f.component.destroy();
  f.button.emit('pointerenter');
  f.button.focus();
  f.button.emit('click');
  f.tick(500);
  assert.equal(f.card.hidden, true);
  assert.ok([f.root, f.button, f.doc].every((node) => [...node.listeners.values()].every((listeners) => listeners.length === 0)));
});
