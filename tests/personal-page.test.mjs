import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonalPage, normalizePersonalProfile, DEFAULT_PERSONAL_PROFILE, PERSONAL_PLATFORMS, PERSONAL_COPY } from '../src/personal-page.js';

class Element {
  constructor(tag, doc) {
    this.localName = tag; this.ownerDocument = doc; this.children = []; this.classes = new Set(); this.attributes = new Map(); this.listeners = new Map(); this.parentElement = null;
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name), contains: name => this.classes.has(name), toggle: (name, on) => (on ?? !this.classes.has(name)) ? this.classes.add(name) : this.classes.delete(name) };
  }
  set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return this.text ?? this.children.map(child => child.textContent).join(''); }
  append(...nodes) { for (const node of nodes) { if (node.parentElement) node.parentElement.children = node.parentElement.children.filter(child => child !== node); node.parentElement = this; this.children.push(node); } }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null; }
  replaceChildren(...nodes) { this.children.forEach(node => { node.parentElement = null; }); this.children = []; this.text = undefined; this.append(...nodes); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); if (name === 'src') this.src = ''; }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  removeEventListener(type, handler) { if (this.listeners.get(type) === handler) this.listeners.delete(type); }
  emit(type, fields = {}) { this.listeners.get(type)?.({ type, target: this, ...fields }); }
  focus() { this.ownerDocument.activeElement = this; }
  showModal() { this.open = true; this.setAttribute('open', ''); }
  close() { this.open = false; this.removeAttribute('open'); this.emit('close'); }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  querySelectorAll(selector) {
    const match = node => selector.startsWith('.') ? node.classList.contains(selector.slice(1)) : node.localName === selector;
    return this.children.flatMap(child => [...(match(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
function fixture(t, options) {
  const doc = new Element('document'); doc.ownerDocument = doc;
  doc.createElement = tag => new Element(tag, doc);
  doc.body = doc.createElement('body'); doc.append(doc.body);
  const root = new Element('div', doc);
  doc.body.append(root);
  const component = createPersonalPage({ root, ...options }); t.after(() => component.destroy());
  return { root, component, doc };
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

test('published journal supports text, images, optional headings and safe multiline text in newest order', t => {
  const markup = '<img src=x onerror=alert(1)>\n第二行';
  const f = fixture(t, { posts: [
    { title: '最早', body: '正文', createdAt: '2026-01-01T00:00:00Z', published: true },
    { title: '', body: markup, createdAt: '2026-03-01T00:00:00Z', published: true },
    { body: '', images: [{ url: './assets/frame-01.jpg', alt: '<b>照片</b>' }], createdAt: '2026-02-01T00:00:00Z', published: true },
    { body: '草稿不展示', createdAt: '2027-01-01T00:00:00Z', published: false },
    { title: '仅标题', body: '  \n  ', images: [], published: true },
    { images: [{ url: 'blob:https://example.org/picture' }, { url: 'javascript:alert(1)' }], published: true },
  ] });
  const articles = f.root.querySelectorAll('.personal-journal-post');
  assert.equal(articles.length, 3);
  assert.equal(articles[0].querySelector('.personal-journal-body').textContent, markup);
  assert.equal(articles[0].querySelector('.personal-journal-title'), null);
  assert.equal(articles[0].querySelector('.personal-journal-body').children.length, 0);
  assert.equal(articles[0].querySelectorAll('img').length, 0, 'user text never creates HTML');
  assert.equal(articles[1].querySelector('.personal-journal-body'), null);
  const image = articles[1].querySelector('img');
  assert.equal(image.src, './assets/frame-01.jpg');
  assert.equal(image.alt, '<b>照片</b>'); assert.equal(image.loading, 'lazy');
  assert.equal(articles[2].querySelector('.personal-journal-title').textContent, '最早');
  assert.equal(f.root.querySelector('.personal-journal-entry'), null, 'published posts replace the default placeholder');
  assert.ok(f.root.querySelector('.personal-journal').classList.contains('personal-reveal'));
  assert.equal(normalizePersonalProfile({ journal: { mode: 'feed' } }).journal.mode, 'feed');
});

test('journal settings hide posts or retain a configured external entry and empty feeds stay honest', t => {
  const posts = [{ body: '已发布', published: true }];
  const f = fixture(t, { profile: { journal: { mode: 'hidden' } }, posts });
  assert.equal(f.root.querySelector('.personal-journal'), null);
  f.component.update({ journal: { mode: 'link', url: 'https://example.org/blog' } });
  assert.equal(f.root.querySelector('.personal-journal-entry').href, 'https://example.org/blog');
  assert.equal(f.root.querySelectorAll('.personal-journal-post').length, 0);
  f.component.update({ journal: { mode: 'feed' } });
  assert.equal(f.root.querySelectorAll('.personal-journal-post').length, 1);
  f.component.setPosts([{ body: '草稿', published: false }]);
  assert.equal(f.root.querySelectorAll('.personal-journal-post').length, 0);
  assert.equal(f.root.querySelector('.personal-journal-entry').disabled, true);
});

const journalPosts = count => Array.from({ length: count }, (_, index) => ({ id: `note-${index}`, body: `第${index}条`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(), published: true }));
const selectedPage = root => root.querySelectorAll('.personal-journal-page').find(button => button.getAttribute('aria-current') === 'page');
const pageNumber = (root, page) => root.querySelectorAll('.personal-journal-page').find(button => button.textContent === String(page));

test('large journals keep five entries per page with compact numbered navigation and fixed owner content', t => {
  const posts = journalPosts(500);
  const f = fixture(t, { posts });
  assert.equal(f.root.querySelectorAll('.personal-journal-post').length, 5);
  assert.equal(f.root.querySelector('.personal-journal-body').textContent, '第499条');
  assert.equal(f.root.querySelector('.personal-journal-previous').disabled, true);
  assert.equal(selectedPage(f.root).textContent, '1');
  assert.equal(f.root.querySelector('.personal-journal-more'), null);
  const avatar = f.root.querySelector('.personal-avatar-wrap');
  f.root.querySelector('.personal-journal-next').emit('click');
  assert.equal(f.root.querySelectorAll('.personal-journal-post').length, 5);
  assert.equal(f.root.querySelector('.personal-journal-body').textContent, '第494条');
  assert.equal(selectedPage(f.root).textContent, '2');
  assert.equal(f.root.querySelector('.personal-avatar-wrap'), avatar, 'page changes never replace or replay the owner card');
  pageNumber(f.root, 5).emit('click');
  assert.equal(selectedPage(f.root).textContent, '5');
  assert.deepEqual(f.root.querySelectorAll('.personal-journal-page').filter(button => !button.classList.contains('is-previous') && !button.classList.contains('is-next')).map(button => button.textContent), ['1', '4', '5', '6', '100']);
  assert.equal(f.root.querySelectorAll('.personal-journal-ellipsis').length, 2);
  assert.ok(f.root.querySelector('.personal-journal-pagination').children.length <= 9, 'arrows and seven compact page tokens fit narrow screens');
  pageNumber(f.root, 100).emit('click');
  assert.equal(f.root.querySelector('.personal-journal-body').textContent, '第4条');
  assert.equal(f.root.querySelector('.personal-journal-next').disabled, true);
  assert.equal(f.root.querySelectorAll('.personal-journal-post').length, 5);
});

test('journal page selection survives language and content edits and clamps when posts are removed', t => {
  const posts = journalPosts(12), f = fixture(t, { posts });
  pageNumber(f.root, 3).emit('click');
  assert.equal(f.root.querySelectorAll('.personal-journal-post').length, 2);
  assert.equal(f.root.querySelector('.personal-journal-body').textContent, '第1条');
  f.component.setLanguage('ja');
  assert.equal(selectedPage(f.root).textContent, '3');
  assert.equal(f.root.querySelector('.personal-journal-next').getAttribute('aria-label'), PERSONAL_COPY.ja.journalNext);
  f.component.setCopy({ ja: { journalPagination: '記事のページ' } });
  assert.equal(selectedPage(f.root).textContent, '3');
  assert.equal(f.root.querySelector('.personal-journal-pagination').getAttribute('aria-label'), '記事のページ');
  f.component.setPosts(posts.map(post => post.id === 'note-1' ? { ...post, body: '本文の更新' } : post));
  assert.equal(selectedPage(f.root).textContent, '3');
  assert.equal(f.root.querySelector('.personal-journal-body').textContent, '本文の更新');
  f.component.setPosts(posts.slice(0, 7));
  assert.equal(selectedPage(f.root).textContent, '2');
  assert.equal(f.root.querySelectorAll('.personal-journal-post').length, 2);
  assert.equal(f.root.querySelector('.personal-journal-next').disabled, true);
  f.component.setPosts(posts.slice(0, 5));
  assert.equal(f.root.querySelectorAll('.personal-journal-post').length, 5);
  assert.equal(f.root.querySelector('.personal-journal-pagination').hidden, true);
  assert.equal(selectedPage(f.root).textContent, '1');
});

test('journal page motion rejects repeated clicks and cancels stale changes during content updates', async t => {
  const f = fixture(t, { posts: journalPosts(12) });
  f.doc.defaultView = { matchMedia: () => ({ matches: false }) };
  // The feed captures its window when rendered, so recreate it once for this browser-like fixture.
  f.component.setLanguage('zh');
  const list = f.root.querySelector('.personal-journal-posts'), animations = [], scrolls = [];
  list.scrollIntoView = options => scrolls.push(options);
  list.animate = (frames, options) => {
    let finish, reject;
    const animation = { frames, options, finished: new Promise((resolve, fail) => { finish = resolve; reject = fail; }), finish: () => finish(), cancel: () => reject(new Error('cancelled')) };
    animations.push(animation); return animation;
  };
  const next = f.root.querySelector('.personal-journal-next');
  next.emit('click'); next.emit('click');
  assert.equal(animations.length, 1);
  assert.equal(f.root.querySelector('.personal-journal-pagination').getAttribute('aria-busy'), 'true');
  assert.equal(f.root.querySelector('.personal-journal-body').textContent, '第11条');
  animations[0].finish(); await Promise.resolve(); await Promise.resolve();
  assert.equal(selectedPage(f.root).textContent, '2');
  assert.equal(animations.length, 2);
  assert.equal(f.root.querySelector('.personal-journal-body').textContent, '第6条');
  f.root.querySelector('.personal-journal-next').emit('click');
  assert.equal(animations.length, 2);
  animations[1].finish(); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.root.querySelector('.personal-journal-pagination').getAttribute('aria-busy'), 'false');
  assert.deepEqual(scrolls, [{ block: 'start', behavior: 'smooth' }]);
  assert.ok(animations.every(animation => animation.options.easing.startsWith('cubic-bezier(')));

  f.root.querySelector('.personal-journal-next').emit('click');
  f.component.setPosts(journalPosts(6));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(selectedPage(f.root).textContent, '2');
  assert.equal(f.root.querySelectorAll('.personal-journal-post').length, 1);
  assert.equal(f.root.querySelector('.personal-journal-body').textContent, '第0条');
  assert.equal(f.root.querySelector('.personal-journal-pagination').getAttribute('aria-busy'), 'false');
  f.doc.defaultView.matchMedia = () => ({ matches: true });
  const reducedList = f.root.querySelector('.personal-journal-posts');
  reducedList.animate = () => { throw new Error('Reduced motion must not animate'); };
  reducedList.scrollIntoView = options => scrolls.push(options);
  f.root.querySelector('.personal-journal-previous').emit('click');
  assert.equal(selectedPage(f.root).textContent, '1');
  assert.equal(f.root.querySelectorAll('.personal-journal-post').length, 5);
  assert.deepEqual(scrolls.at(-1), { block: 'start', behavior: 'instant' });
});

test('journal images open an accessible viewer, close it on data changes and release the scroll lock', t => {
  const posts = [{ body: '照片', images: [{ url: 'https://example.org/picture.jpg', alt: '照片说明' }], published: true }];
  const f = fixture(t, { posts });
  const opener = f.root.querySelector('.personal-journal-image-button');
  opener.emit('click');
  const viewer = f.root.querySelector('dialog');
  assert.equal(viewer.open, true);
  assert.equal(viewer.getAttribute('aria-label'), PERSONAL_COPY.zh.viewImage);
  assert.equal(viewer.querySelector('img').src, 'https://example.org/picture.jpg');
  assert.equal(viewer.querySelector('img').alt, '照片说明');
  assert.equal(f.doc.body.classList.contains('modal-open'), true);
  viewer.querySelector('.personal-image-close').emit('click');
  assert.equal(viewer.open, false);
  assert.equal(f.doc.body.classList.contains('modal-open'), false);
  assert.equal(f.doc.activeElement, opener);
  opener.emit('click');
  viewer.querySelector('img').emit('error');
  assert.equal(viewer.querySelector('.personal-image-error').hidden, false);
  f.component.setPosts([]);
  assert.equal(viewer.open, false); assert.equal(viewer.querySelector('img').src, '');
  assert.equal(f.doc.body.classList.contains('modal-open'), false);
  f.component.setPosts(posts); f.root.querySelector('.personal-journal-image-button').emit('click');
  f.component.destroy();
  assert.equal(f.doc.body.classList.contains('modal-open'), false);
});

test('personal hint dictionaries are editable plain text with defaults for omitted keys and locales', t => {
  const f = fixture(t, { copy: { zh: { journal: '<b>新标题</b>', journalNote: '新的\n提示' } } });
  assert.equal(f.root.querySelector('.personal-journal').getAttribute('aria-label'), '<b>新标题</b>');
  assert.equal(f.root.querySelectorAll('b').length, 0);
  assert.equal(f.root.querySelector('.personal-journal-note').textContent, '新的\n提示');
  assert.equal(f.root.querySelector('.personal-eyebrow').textContent, PERSONAL_COPY.zh.eyebrow);
  f.component.setLanguage('ja');
  assert.equal(f.root.querySelector('.personal-journal-note').textContent, PERSONAL_COPY.ja.journalNote);
  f.component.setCopy({ ja: { journalNote: '変更したヒント', soon: '' } });
  assert.equal(f.root.querySelector('.personal-journal-note').textContent, '変更したヒント');
  f.component.setCopy(null);
  assert.equal(f.root.querySelector('.personal-journal-note').textContent, PERSONAL_COPY.ja.journalNote);
  assert.equal(PERSONAL_COPY.zh.journal, '碎碎念', 'instance overrides leave default dictionaries unchanged');
});

test('journal image groups use square-grid metadata while a single photograph keeps its intrinsic layout', t => {
  const f = fixture(t, { posts: [1, 2, 4, 5].map((count, index) => ({ id: `gallery-${count}`, body: '图片', images: Array.from({ length: count }, (_, image) => ({ url: `./image-${image}.jpg` })), createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(), published: true })) });
  const galleries = f.root.querySelectorAll('.personal-journal-images');
  assert.deepEqual(galleries.map(node => node.getAttribute('data-image-count')), ['5', '4', '2', '1']);
  assert.equal(galleries.at(-1).classList.contains('is-single'), true);
  assert.equal(galleries[0].style['--journal-image-columns'], '3');
  assert.equal(galleries[1].style['--journal-image-columns'], '2');
});

test('journal detail browses across feed pages then returns to the selected entry and title focus', t => {
  const posts = journalPosts(12).map(post => ({ ...post, title: `标题 ${post.id}` }));
  const commentsService = { enabled: true, getComments: async () => [], subscribe: () => () => {} };
  const f = fixture(t, { posts, commentsService });
  f.root.querySelectorAll('.personal-journal-open')[4].emit('click');
  const detail = f.doc.body.querySelector('.journal-detail-viewer');
  assert.equal(detail.open, true);
  assert.equal(detail.getAttribute('data-journal-id'), 'note-7');
  assert.equal(detail.querySelector('.comments-form').hidden, false);
  detail.querySelector('.journal-detail-next').emit('click');
  assert.equal(detail.getAttribute('data-journal-id'), 'note-6');
  detail.querySelector('.journal-detail-close').emit('click');
  assert.equal(detail.open, false);
  assert.equal(selectedPage(f.root).textContent, '2');
  const article = f.root.querySelectorAll('.personal-journal-post')[0];
  assert.equal(article.getAttribute('data-journal-id'), 'note-6');
  assert.equal(f.doc.activeElement, article.querySelector('.personal-journal-open'));
  assert.equal(f.doc.body.classList.contains('modal-open'), false);
});

test('detail, feed and language changes share one comment form and retain the journal draft', t => {
  const posts = [{ id: 'same-note', title: { zh: '标题', ja: 'タイトル' }, body: { zh: '正文', ja: '本文' }, published: true }];
  const f = fixture(t, { posts });
  const panel = f.root.querySelector('.personal-post-comments-content');
  const body = panel.querySelector('.comments-body'); body.value = '尚未发送的草稿'; body.emit('input');
  f.root.querySelector('.comments-open-thread').emit('click');
  const detail = f.doc.body.querySelector('.journal-detail-viewer');
  assert.equal(detail.querySelector('.personal-post-comments-content'), panel);
  assert.equal(body.value, '尚未发送的草稿');
  f.component.setLanguage('ja');
  assert.equal(detail.open, true);
  assert.equal(detail.querySelector('.personal-journal-title').textContent, 'タイトル');
  assert.equal(detail.querySelector('.personal-post-comments-content'), panel);
  assert.equal(body.value, '尚未发送的草稿');
  f.component.setPosts(posts.map(post => ({ ...post, body: { ja: '更新された本文' } })));
  assert.equal(detail.open, true);
  assert.equal(detail.querySelector('.personal-journal-body').textContent, '更新された本文');
  detail.querySelector('.journal-detail-close').emit('click');
  assert.equal(f.root.querySelector('.personal-post-comments-content'), panel);
  assert.equal(body.value, '尚未发送的草稿');
  assert.equal(panel.querySelector('.comments-form').hidden, true);
});

test('an image can be viewed above journal detail without losing its open thread or scroll lock', t => {
  const f = fixture(t, { posts: [{ id: 'images', title: '图片', body: '正文', images: [{ url: './one.jpg', alt: '一' }, { url: './two.jpg', alt: '二' }], published: true }] });
  f.root.querySelector('.personal-journal-open').emit('click');
  const detail = f.doc.body.querySelector('.journal-detail-viewer');
  const button = detail.querySelector('.personal-journal-image-button'); button.emit('click');
  const imageViewer = f.root.querySelector('.personal-image-viewer');
  assert.equal(imageViewer.open, true); assert.equal(detail.open, true);
  imageViewer.querySelector('.personal-image-next').emit('click');
  assert.equal(imageViewer.querySelector('.personal-image-full').src, './two.jpg');
  imageViewer.querySelector('.personal-image-close').emit('click');
  assert.equal(imageViewer.open, false); assert.equal(detail.open, true);
  assert.equal(f.doc.body.classList.contains('modal-open'), true);
  assert.equal(f.doc.activeElement, button);
  f.component.setPosts([]);
  assert.equal(detail.open, false);
  assert.equal(f.doc.body.classList.contains('modal-open'), false);
});
