import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommentService, createAnonymousComments, COMMENTS_COPY } from '../src/comments.js';
import { createPersonalPage } from '../src/personal-page.js';
import { createAlbum, ALBUM_COPY } from '../src/album.js';

class Element {
  constructor(tag, doc) {
    this.localName = tag; this.ownerDocument = doc; this.children = []; this.classes = new Set(); this.attributes = new Map(); this.listeners = new Map(); this.value = ''; this.isConnected = true;
    this.style = { setProperty() {}, getPropertyValue() { return ''; } };
    this.classList = { add: (...names) => names.forEach(name => this.classes.add(name)), remove: (...names) => names.forEach(name => this.classes.delete(name)), contains: name => this.classes.has(name), toggle: (name, on) => (on ?? !this.classes.has(name)) ? this.classes.add(name) : this.classes.delete(name) };
  }
  set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return this.text ?? this.children.map(child => child.textContent).join(''); }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children.forEach(node => { node.parentElement = null; node.isConnected = false; }); this.children = []; this.text = undefined; this.append(...nodes); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.isConnected = false; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); if (name === 'src') this.src = ''; }
  addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(handler); }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  emit(type, fields = {}) {
    const event = { type, target: this, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...fields };
    const results = [...this.listeners.get(type) || []].map(handler => handler(event));
    return { event, completed: Promise.all(results) };
  }
  focus() { this.ownerDocument.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit('close'); }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  querySelectorAll(selector) {
    const match = node => selector.startsWith('.') ? node.classList.contains(selector.slice(1)) : node.localName === selector;
    return this.children.flatMap(child => [...(match(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getBoundingClientRect() { return { left: 10, top: 20, width: 200, height: 180, right: 210, bottom: 200 }; }
}

function documentFixture() {
  const doc = new Element('document'); doc.ownerDocument = doc;
  doc.createElement = tag => new Element(tag, doc); doc.body = doc.createElement('body'); doc.append(doc.body);
  doc.defaultView = { addEventListener() {}, removeEventListener() {}, getComputedStyle() { return { opacity: '1', transform: 'none' }; } };
  doc.querySelector = selector => selector === 'dialog[open]' ? doc.body.querySelectorAll('dialog').find(dialog => dialog.open) || null : null;
  const container = doc.createElement('div'); doc.body.append(container);
  return { doc, container, find: selector => container.querySelector(selector) };
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const response = (status, data) => ({ status, ok: status >= 200 && status < 300, async json() { return data; } });
const comment = (id, extra = {}) => ({ id, parentId: null, nickname: '', body: `留言 ${id}`, status: 'approved', createdAt: '2026-11-01T12:00:00Z', ...extra });
function serviceStub(comments = []) {
  const listeners = new Set();
  return { enabled: true, calls: [], sent: [], listeners,
    async getComments(request) { this.calls.push(request); return comments; },
    async postComment(payload, options) { this.sent.push({ payload, options }); return { comment: { id: 'pending', status: 'pending' } }; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    toggle(value) { this.enabled = value; listeners.forEach(listener => listener()); },
  };
}

test('public service omits credentials, encodes targets, normalizes approved records and follows runtime availability', async () => {
  const calls = [];
  const client = createCommentService({ fetchImpl: async (url, options) => { calls.push({ url, options }); return response(200, { comments: [comment('a'), comment('hidden', { status: 'pending' }), comment('a')], available: true }); } });
  assert.equal(client.enabled, false);
  await assert.rejects(client.getComments({ targetType: 'photo', targetId: 'a' }), error => error.code === 'comments_unavailable');
  let updates = 0; const unsubscribe = client.subscribe(() => updates++);
  client.setBaseUrl('https://comments.example.org/');
  assert.equal(client.enabled, true); assert.equal(updates, 1);
  const result = await client.getComments({ targetType: 'photo', targetId: 'a/b & 中' });
  assert.equal(result.length, 1);
  const url = new URL(calls[0].url); assert.equal(url.searchParams.get('targetId'), 'a/b & 中');
  assert.equal(calls[0].options.credentials, 'omit'); assert.equal(calls[0].options.mode, 'cors');
  await client.postComment({ targetType: 'photo', targetId: 'a', body: '你好' });
  assert.equal(calls[1].options.method, 'POST'); assert.equal(calls[1].options.credentials, 'omit');
  assert.equal(JSON.parse(calls[1].options.body).body, '你好');
  client.setBaseUrl(''); assert.equal(client.baseUrl, '');
  client.setBaseUrl('javascript:alert(1)'); assert.equal(client.enabled, false);
  unsubscribe(); client.setBaseUrl(null); assert.equal(updates, 3);
});

test('anonymous panel hides closed service details, updates editable bilingual labels and renders user text literally', async t => {
  const f = documentFixture(); const client = serviceStub([comment('a', { nickname: '<b>名字</b>', body: '<img src=x onerror=alert(1)>', verified: true }), comment('b', { verified: 'true' })]);
  client.enabled = false;
  const panel = createAnonymousComments({ container: f.container, service: client, targetId: 'photo-1' }); t.after(() => panel.destroy());
  assert.equal(f.find('.comments-load-state').textContent, COMMENTS_COPY.zh.unavailable);
  assert.equal(f.find('.comments-form').hidden, true); assert.equal(client.calls.length, 0);
  client.toggle(true); await tick();
  assert.equal(f.container.querySelectorAll('.comment-owner').length, 1, 'only server boolean verification grants the author marker');
  assert.equal(f.find('.comment-body').textContent, '<img src=x onerror=alert(1)>'); assert.equal(f.container.querySelectorAll('img').length, 0);
  panel.setLanguage('ja'); assert.equal(f.find('.comments-submit').textContent, COMMENTS_COPY.ja.submit);
  panel.setCopy({ ja: { title: '<b>掲示板</b>', submit: '送る' } });
  assert.equal(f.find('.comments-heading').textContent, '<b>掲示板</b>'); assert.equal(f.container.querySelectorAll('b').length, 0);
  assert.equal(f.find('.comments-submit').textContent, '送る');
});

test('unnamed comments use the visitor language without changing a chosen nickname', async t => {
  const f=documentFixture();const client=serviceStub([comment('anonymous'),comment('named',{nickname:'Amu'})]);
  const panel=createAnonymousComments({container:f.container,service:client,targetId:'photo',language:'ja'});t.after(()=>panel.destroy());
  await tick();
  assert.deepEqual(f.container.querySelectorAll('.comment-author').map(node=>node.textContent),[COMMENTS_COPY.ja.anonymous,'Amu']);
  panel.setLanguage('zh');
  assert.deepEqual(f.container.querySelectorAll('.comment-author').map(node=>node.textContent),[COMMENTS_COPY.zh.anonymous,'Amu']);
});

test('switching threads cancels old fetches, ignores late replies and restores each photo draft', async t => {
  const f = documentFixture(); const requests = [];
  const client = serviceStub(); client.getComments = request => new Promise(resolve => requests.push({ request, resolve }));
  const panel = createAnonymousComments({ container: f.container, service: client, targetId: 'first' }); t.after(() => panel.destroy());
  f.find('.comments-body').value = '第一张的文字'; panel.setTarget('photo', 'second');
  assert.equal(requests[0].request.signal.aborted, true); assert.equal(f.find('.comments-body').value, '');
  requests[1].resolve([comment('second-comment')]); await tick(); requests[0].resolve([comment('old-comment')]); await tick();
  assert.equal(f.find('.comment-body').textContent, '留言 second-comment');
  f.find('.comments-body').value = '第二张'; panel.setTarget('photo', 'first');
  assert.equal(f.find('.comments-body').value, '第一张的文字');
  panel.setActive(false); assert.equal(requests[2].request.signal.aborted, true);
  panel.destroy(); assert.equal(client.listeners.size, 0); assert.equal(f.container.children.length, 0);
});

test('form validates Unicode lengths, supports one reply level, reports moderation and preserves text on 429', async t => {
  const f = documentFixture(); const client = serviceStub([comment('parent'), comment('child', { parentId: 'parent' })]);
  const panel = createAnonymousComments({ container: f.container, service: client, targetType: 'note', targetId: 'note-1' }); t.after(() => panel.destroy()); await tick();
  assert.equal(f.container.querySelectorAll('.comment-reply-button').length, 1);
  f.find('.comments-body').value = '  '; await f.find('.comments-form').emit('submit').completed;
  assert.equal(client.sent.length, 0); assert.equal(f.find('.comments-submit-state').textContent, COMMENTS_COPY.zh.invalidBody);
  f.find('.comment-reply-button').emit('click'); assert.equal(f.find('.comments-reply-target').hidden, false);
  f.find('.comments-body').value = '🌷'.repeat(2000);
  await f.find('.comments-form').emit('submit').completed;
  assert.equal(client.sent[0].payload.parentId, 'parent'); assert.equal(client.sent[0].payload.targetType, 'note');
  assert.equal(client.sent[0].payload.nickname, ''); assert.equal(f.find('.comments-body').value, '');
  assert.equal(f.find('.comments-submit-state').textContent, COMMENTS_COPY.zh.pending);
  assert.equal(f.container.querySelectorAll('.comment').length, 2, 'pending submissions are never added to the approved thread');
  client.postComment = async () => { throw Object.assign(new Error('too many'), { status: 429 }); };
  f.find('.comments-body').value = '留下文字'; await f.find('.comments-form').emit('submit').completed;
  assert.equal(f.find('.comments-body').value, '留下文字'); assert.equal(f.find('.comments-submit-state').textContent, COMMENTS_COPY.zh.rateLimited);
});

test('late submission completion cannot clear another target draft and closing aborts the request', async t => {
  const f = documentFixture(); const client = serviceStub(); let finish; let signal;
  client.postComment = (payload, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); };
  const panel = createAnonymousComments({ container: f.container, service: client, targetId: 'first' }); t.after(() => panel.destroy()); await tick();
  f.find('.comments-body').value = '第一张'; const submitted = f.find('.comments-form').emit('submit');
  panel.setTarget('photo', 'second'); f.find('.comments-body').value = '第二张';
  assert.equal(signal.aborted, true); finish({ comment: { status: 'pending' } }); await submitted.completed;
  assert.equal(f.find('.comments-body').value, '第二张'); assert.equal(f.find('.comments-submit-state').textContent, '');
});

test('restored reply drafts wait for their approved parent before submitting', async t => {
  const f = documentFixture(); const client = serviceStub([comment('parent')]);
  const panel = createAnonymousComments({ container: f.container, service: client, targetId: 'first' }); t.after(() => panel.destroy()); await tick();
  f.find('.comment-reply-button').emit('click'); f.find('.comments-body').value = '回复草稿';
  panel.setActive(false);
  let finish; client.getComments = () => new Promise(resolve => { finish = resolve; }); panel.setActive(true);
  assert.equal(f.find('.comments-submit').disabled, true);
  assert.equal(f.find('.comments-reply-target').hidden, false);
  await f.find('.comments-form').emit('submit').completed; assert.equal(client.sent.length, 0);
  finish([comment('parent')]); await tick(); assert.equal(f.find('.comments-submit').disabled, false);
  await f.find('.comments-form').emit('submit').completed; assert.equal(client.sent[0].payload.parentId, 'parent');
});

test('a removed reply parent never silently converts the saved reply into a top level comment', async t => {
  const f = documentFixture(); const client = serviceStub([comment('parent')]);
  const panel = createAnonymousComments({ container: f.container, service: client, targetId: 'first' }); t.after(() => panel.destroy()); await tick();
  f.find('.comment-reply-button').emit('click'); f.find('.comments-body').value = '回复草稿'; panel.setActive(false);
  client.getComments = async () => []; panel.setActive(true); await tick();
  assert.equal(f.find('.comments-submit').disabled, true); assert.match(f.find('.comments-reply-target').textContent, /暂时无法回复/);
  await f.find('.comments-form').emit('submit').completed; assert.equal(client.sent.length, 0);
  f.find('.comments-cancel-reply').emit('click'); assert.equal(f.find('.comments-submit').disabled, false);
  assert.equal(f.find('.comments-body').value, '回复草稿');
});

test('journal lazily opens comments for six visible published posts and preserves drafts across language updates', async t => {
  const f = documentFixture(); const client = serviceStub();
  const page = createPersonalPage({ root: f.container, commentsService: client, posts: Array.from({ length: 8 }, (_, index) => ({ id: `note-${index}`, body: `正文 ${index}`, published: true })) }); t.after(() => page.destroy());
  assert.equal(f.container.querySelectorAll('.personal-post-comments').length, 6); assert.equal(client.calls.length, 0);
  const details = f.find('.personal-post-comments'); details.open = true; details.emit('toggle'); await tick();
  assert.equal(client.calls.length, 1); assert.equal(client.calls[0].targetType, 'note'); assert.equal(client.calls[0].targetId, 'note-0');
  f.find('.comments-body').value = '切语言时保留'; page.setLanguage('ja'); await tick();
  assert.equal(f.find('.comments-body').value, '切语言时保留'); assert.equal(f.find('.comments-submit').textContent, COMMENTS_COPY.ja.submit);
  f.find('.personal-journal-more').emit('click'); assert.equal(f.container.querySelectorAll('.personal-post-comments').length, 8);
  page.setCommentsService(null); assert.equal(f.find('.personal-post-comments-summary').getAttribute('aria-disabled'), 'true');
  const stillOpenSummary = f.find('.personal-post-comments-summary');
  assert.equal(stillOpenSummary.emit('click').event.prevented, undefined, 'open comments can be collapsed after disabling the service');
});

test('localized note titles, body and image descriptions switch language without changing the comment target', async t => {
  const f = documentFixture(); const client = serviceStub();
  const page = createPersonalPage({ root: f.container, commentsService: client, posts: [{ id: 'localized-note', title: { zh: '标题', ja: '題名' }, body: { zh: '正文', ja: '本文' }, images: [{ url: './picture.jpg', alt: { zh: '照片', ja: '写真' } }], published: true }] }); t.after(() => page.destroy());
  assert.equal(f.find('.personal-journal-title').textContent, '标题');
  page.setLanguage('ja');
  assert.equal(f.find('.personal-journal-title').textContent, '題名'); assert.equal(f.find('.personal-journal-body').textContent, '本文'); assert.equal(f.find('.personal-journal-image').alt, '写真');
  const details = f.find('.personal-post-comments'); details.open = true; details.emit('toggle'); await tick();
  assert.equal(client.calls[0].targetId, 'localized-note');
});

test('editable album captions, world and small cover labels reach the visitor in both languages', t => {
  const f=documentFixture();
  const album=createAlbum({container:f.container,copy:{zh:{title:'影像手帐'},ja:{title:'映像ノート'}},media:[{id:'p',url:'./photo.jpg',sourceKind:'video-still',modelIds:['shiratsume'],takenAt:null,caption:{zh:'夏日的一天',ja:'夏の一日'},worldName:'Japan Shrine'}]});t.after(()=>album.destroy());
  assert.equal(f.find('.album-cover-note').textContent,'映像ノート');
  assert.equal(f.find('.album-photo-label').textContent,'PHOTO 01-01');
  album.openPlayer(0);const caption=()=>f.doc.body.querySelector('.album-player-caption').textContent;
  assert.ok(caption().includes('夏日的一天'));assert.ok(caption().includes('Japan Shrine'));
  album.setLanguage('ja');assert.ok(caption().includes('夏の一日'));
});

test('photo player keeps comments on the selected photo, releases work on close and leaves text cursor arrow keys alone', async t => {
  const f = documentFixture(); const client = serviceStub();
  const album = createAlbum({ container: f.container, commentsService: client, copy: { zh: { title: '新的相册标题' } } }); t.after(() => album.destroy());
  assert.equal(f.find('.album-title').textContent, '新的相册标题');
  assert.equal(client.calls.length, 0); album.openPlayer(0); await tick();
  assert.equal(client.calls[0].targetId, 'still-01');
  const dialog = f.doc.body.querySelector('dialog');
  const event = dialog.emit('keydown', { key: 'ArrowRight', target: dialog.querySelector('.comments-body') }).event;
  assert.equal(event.prevented, undefined); assert.equal(client.calls.length, 1);
  dialog.emit('keydown', { key: 'ArrowRight' }); await tick(); assert.equal(client.calls.at(-1).targetId, 'still-02');
  album.setCopy(null); assert.equal(f.find('.album-title').textContent, ALBUM_COPY.zh.title);
  album.closePlayer(true); assert.equal(album.state.playerOpen, false);
  album.destroy(); assert.equal(client.listeners.size, 0);
});
