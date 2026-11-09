import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonalPage, normalizePersonalProfile, DEFAULT_PERSONAL_PROFILE, PERSONAL_PLATFORMS } from '../src/personal-page.js';

class Element {
  constructor(tag, doc) {
    this.localName = tag; this.ownerDocument = doc; this.children = []; this.classes = new Set(); this.attributes = new Map(); this.listeners = new Map();
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name), contains: name => this.classes.has(name) };
  }
  set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return this.text ?? this.children.map(child => child.textContent).join(''); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; this.text = undefined; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  emit(type) { this.listeners.get(type)?.({ type, target: this }); }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  querySelectorAll(selector) {
    const match = node => selector.startsWith('.') ? node.classList.contains(selector.slice(1)) : node.localName === selector;
    return this.children.flatMap(child => [...(match(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
function fixture(t, options) {
  const doc = { createElement(tag) { return new Element(tag, doc); } };
  const root = new Element('div', doc);
  const component = createPersonalPage({ root, ...options }); t.after(() => component.destroy());
  return { root, component };
}

test('owner page defaults provide a clover avatar and four explicit unavailable personal links', t => {
  const f = fixture(t);
  assert.equal(DEFAULT_PERSONAL_PROFILE.avatar, null);
  assert.equal(PERSONAL_PLATFORMS.length, 4);
  assert.equal(f.root.querySelectorAll('img').length, 0);
  assert.ok(f.root.querySelector('.personal-avatar-fallback'));
  assert.equal(f.root.querySelectorAll('a').length, 0);
  assert.ok(f.root.querySelectorAll('.personal-social').every(button => button.localName === 'button' && button.disabled));
  assert.equal(f.root.querySelector('.personal-name').id, 'personal-heading');
});

test('social profiles share safe links with the header contacts and deduplicate existing entries', () => {
  const data = normalizePersonalProfile({ socials: { x: 'https://example.org/me', vrchat: 'javascript:alert(1)', pixiv: '//example.org/' }, contacts: [{ label: 'Twitter', url: 'https://example.org/me' }, { label: 'Email', url: 'mailto:hello@example.org' }] });
  assert.equal(data.socials.x, 'https://example.org/me');
  assert.equal(data.socials.vrchat, null); assert.equal(data.socials.pixiv, null);
  assert.equal(data.contacts.length, 2);
  assert.equal(normalizePersonalProfile(null).avatar, null);
});

test('configured profiles render text as text and external accounts as independent safe links', t => {
  const f = fixture(t, { profile: { name: { zh: '名字', ja: '名前' }, bio: '<img src=x onerror=alert(1)>', socials: { x: 'https://example.org/me' } } });
  assert.equal(f.root.querySelector('.personal-bio').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(f.root.querySelectorAll('img').length, 0);
  const link = f.root.querySelector('a');
  assert.equal(link.href, 'https://example.org/me'); assert.equal(link.target, '_blank'); assert.equal(link.rel, 'noopener noreferrer');
  assert.ok(link.querySelector('.personal-social-icon').style['--platform-icon'].includes('./assets/icons/x.svg'));
  f.component.setLanguage('ja');
  assert.equal(f.root.querySelector('.personal-name').textContent, '名前');
  assert.equal(f.root.querySelector('.personal-social-label').textContent, 'RED / 小紅書');
});

test('avatar load failure falls back to the owner clover without using any model portrait', t => {
  const f = fixture(t, { profile: { avatar: './assets/owner-test.png' } });
  const image = f.root.querySelector('img'); assert.equal(image.src, './assets/owner-test.png'); image.emit('error');
  assert.equal(f.root.querySelectorAll('img').length, 0); assert.ok(f.root.querySelector('.personal-avatar-fallback'));
  f.component.update({ avatar: 'data:image/svg+xml,unsafe' }); assert.equal(f.root.querySelectorAll('img').length, 0);
});

test('journal supports an honest placeholder, an external blog, or no entry without fake posts', t => {
  const f = fixture(t);
  assert.equal(f.root.querySelector('.personal-journal-entry').disabled, true);
  f.component.update({ journal: { mode: 'link', url: 'https://example.org/notes' } });
  assert.equal(f.root.querySelector('.personal-journal-entry').href, 'https://example.org/notes');
  f.component.update({ journal: { mode: 'link', url: 'javascript:alert(1)' } });
  assert.equal(f.root.querySelector('.personal-journal-entry').disabled, true);
  f.component.update({ journal: { mode: 'hidden' } }); assert.equal(f.root.querySelector('.personal-journal'), null);
  f.component.destroy(); f.component.update({ name: 'later' }); assert.equal(f.root.children.length, 0);
});
