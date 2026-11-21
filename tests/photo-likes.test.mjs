import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoLikesService, createPhotoLikeButton } from '../src/photo-likes.js';

const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const pending = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const options = fetchImpl => ({ baseUrl: 'https://amubis.art', pageURL: 'https://amubis.art/', fetchImpl });

test('likes read is explicit and sends same-origin cookies, with numeric snapshots for packing', async t => {
  const calls = [];
  const service = createPhotoLikesService(options(async (url, init) => { calls.push({ url, ...init }); return response({ available: true, likes: [{ photoId: 'one', count: 7, liked: true }] }); }));
  t.after(() => service.destroy());
  assert.equal(calls.length, 0);
  await service.refresh();
  assert.equal(calls[0].url, 'https://amubis.art/api/photo-likes');
  assert.equal(calls[0].credentials, 'same-origin'); assert.equal(calls[0].cache, 'no-store');
  assert.deepEqual(service.snapshot(), { one: 7 });
  assert.deepEqual(service.get('one'), { photoId: 'one', count: 7, liked: true, weight: 1, pending: false, error: '', loaded: true, canLike: true });
});

test('concurrent first likes await one cookie bootstrap and repeated same-photo clicks share one write', async t => {
  const bootstrap = pending(), save = pending(), calls = [];
  const service = createPhotoLikesService(options(async (url, init) => {
    calls.push(init);
    if (init.method === 'GET') return bootstrap.promise;
    if (JSON.parse(init.body).photoId === 'one') return save.promise;
    return response({ photoId: 'two', count: 1, liked: true });
  }));
  t.after(() => service.destroy());
  const first = service.toggle('one'), repeated = service.toggle('one'), other = service.toggle('two');
  assert.equal(calls.length, 1); assert.equal(calls[0].method, 'GET');
  bootstrap.resolve(response({ likes: [] })); await tick();
  assert.equal(calls.filter(call => call.method === 'POST').length, 2);
  assert.equal(service.get('one').pending, true);
  save.resolve(response({ photoId: 'one', count: 1, liked: true }));
  await Promise.all([first, repeated, other]);
  assert.equal(service.get('one').count, 1); assert.equal(service.get('one').pending, false);
});

test('unlike is explicit, failures preserve the last confirmed count and can be retried', async t => {
  let fail = true; const payloads = [];
  const service = createPhotoLikesService(options(async (url, init) => {
    if (init.method === 'GET') return response({ likes: [{ photoId: 'one', count: 8, liked: true }] });
    payloads.push(JSON.parse(init.body));
    return fail ? response({ code: 'rate_limited' }, 429) : response({ photoId: 'one', count: 7, liked: false });
  }));
  t.after(() => service.destroy()); await service.refresh();
  await assert.rejects(service.toggle('one'), error => error.status === 429);
  assert.equal(service.get('one').count, 8); assert.equal(service.get('one').liked, true); assert.equal(service.get('one').pending, false);
  assert.equal(service.get('one').error, 'rate_limited');
  fail = false; await service.toggle('one');
  assert.deepEqual(payloads, [{ photoId: 'one', liked: false }, { photoId: 'one', liked: false }]);
  assert.equal(service.get('one').count, 7); assert.equal(service.get('one').liked, false); assert.equal(service.get('one').error, '');
});

test('late totals cannot overwrite a newer acknowledged vote', async t => {
  const stale = pending(); let reads = 0;
  const service = createPhotoLikesService(options(async (url, init) => {
    if (init.method === 'POST') return response({ photoId: 'one', count: 5, liked: true });
    if (++reads === 1) return response({ likes: [{ photoId: 'one', count: 4, liked: false }] });
    return stale.promise;
  }));
  t.after(() => service.destroy()); await service.refresh();
  const refreshing = service.refresh(); await service.toggle('one');
  stale.resolve(response({ likes: [{ photoId: 'one', count: 4, liked: false }] })); await refreshing;
  assert.equal(service.get('one').count, 5); assert.equal(service.get('one').liked, true);
});

test('changing API source aborts work and ignores late results from the old site', async t => {
  const stale = pending(); let signal;
  const service = createPhotoLikesService(options(async (url, init) => { signal = init.signal; return stale.promise; }));
  t.after(() => service.destroy());
  const reading = service.refresh();
  service.setBaseUrl('https://other.example'); assert.equal(signal.aborted, true);
  stale.resolve(response({ likes: [{ photoId: 'private-source', count: 10, liked: true }] }));
  await assert.rejects(reading, error => error.code === 'likes_source_changed');
  assert.deepEqual(service.snapshot(), {}); assert.equal(service.get('private-source').loaded, false);
});

test('GitHub Pages reads totals but cannot submit a vote with a mismatched cookie origin', async t => {
  const methods = [];
  const service = createPhotoLikesService({ ...options(async (url, init) => { methods.push(init.method); return response({ likes: [{ photoId: 'one', count: 3, liked: false }] }); }), pageURL: 'https://amubis.github.io/shiratsumePage/' });
  t.after(() => service.destroy()); await service.refresh();
  assert.equal(service.get('one').canLike, false); assert.equal(service.get('one').count, 3);
  await assert.rejects(service.toggle('one'), error => error.code === 'likes_main_site_only');
  assert.deepEqual(methods, ['GET']);
});

test('invalid negative counts fail the read instead of corrupting prominence', async t => {
  const service = createPhotoLikesService(options(async () => response({ likes: [{ photoId: 'one', count: -1, liked: false }] })));
  t.after(() => service.destroy());
  await assert.rejects(service.refresh(), error => error.code === 'invalid_response');
  assert.deepEqual(service.snapshot(), {}); assert.equal(service.get('one').loaded, false);
});

class Element {
  constructor(tag) { this.localName = tag; this.children = []; this.attributes = new Map(); this.events = new Map(); this.classes = new Set(); this.classList = { toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name) }; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name); }
  append(...nodes) { this.children.push(...nodes); }
  addEventListener(type, listener) { this.events.set(type, listener); }
  removeEventListener(type, listener) { if (this.events.get(type) === listener) this.events.delete(type); }
  emit(type, fields) { return this.events.get(type)?.({ preventDefault() {}, stopPropagation() {}, ...fields }); }
  remove() { this.removed = true; }
}
const doc = { createElement: tag => new Element(tag) };

test('one shared vote updates card and viewer buttons; localized labels and reduced motion remain usable', async t => {
  const events = [];
  const service = createPhotoLikesService(options(async (url, init) => response(init.method === 'GET' ? { likes: [{ photoId: 'one', count: 2, liked: false }] } : { photoId: 'one', count: 3, liked: true })));
  t.after(() => service.destroy()); await service.refresh();
  const card = createPhotoLikeButton({ document: doc, service, photoId: 'one', reducedMotion: () => true });
  const viewer = createPhotoLikeButton({ document: doc, service, photoId: 'one', language: 'ja', reducedMotion: () => true });
  t.after(() => { card.destroy(); viewer.destroy(); });
  assert.equal(card.element.localName, 'button'); assert.equal(card.element.type, 'button');
  assert.equal(card.element.children[2].getAttribute('data-language-text'), '');
  assert.equal(card.element.title, '点赞'); assert.equal(viewer.element.title, 'いいね');
  await card.element.events.get('click')({ preventDefault: () => events.push('prevent'), stopPropagation: () => events.push('stop') });
  assert.deepEqual(events, ['prevent', 'stop']);
  assert.equal(card.element.getAttribute('aria-pressed'), 'true'); assert.equal(viewer.element.getAttribute('aria-pressed'), 'true');
  assert.equal(card.element.children[1].textContent, '3'); assert.equal(viewer.element.children[1].textContent, '3');
  card.setLanguage('ja'); assert.equal(card.element.title, 'いいねを取り消す');
  viewer.setPhotoId('other'); assert.equal(viewer.element.getAttribute('aria-pressed'), 'false'); assert.equal(viewer.element.children[1].textContent, '0');
});

test('cross-origin buttons retain counts with a clear main-site hint and no fake success', async t => {
  const service = createPhotoLikesService({ ...options(async () => response({ likes: [{ photoId: 'one', count: 5, liked: false }] })), pageURL: 'https://amubis.github.io/shiratsumePage/' });
  t.after(() => service.destroy()); await service.refresh();
  const button = createPhotoLikeButton({ document: doc, service, photoId: 'one' }); t.after(() => button.destroy());
  assert.equal(button.element.disabled, true); assert.equal(button.element.title, '请在主站点赞'); assert.equal(button.element.children[1].textContent, '5');
});

test('a completed pointer hold sends one five-like vote and consumes its release click', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const payloads = [];
  const service = createPhotoLikesService(options(async (url, init) => {
    if (init.method === 'GET') return response({ likes: [{ photoId: 'one', count: 0, liked: false, weight: 0 }] });
    const body = JSON.parse(init.body); payloads.push(body);
    const weight = body.liked ? body.weight ?? 1 : 0;
    return response({ photoId: 'one', count: weight, liked: body.liked, weight });
  }));
  t.after(() => service.destroy()); await service.refresh();
  const card = createPhotoLikeButton({ document: doc, service, photoId: 'one' });
  const viewer = createPhotoLikeButton({ document: doc, service, photoId: 'one' });
  t.after(() => { card.destroy(); viewer.destroy(); });
  const pointer = { pointerId: 1, button: 0, detail: 1, clientX: 20, clientY: 20 };
  card.element.emit('pointerdown', pointer);
  t.mock.timers.tick(2949);
  assert.equal(payloads.length, 0);
  assert.equal(card.element.getAttribute('data-like-motion'), 'charging');
  t.mock.timers.tick(1); await tick();
  card.element.emit('pointerup', pointer);
  await card.element.emit('click', pointer);
  assert.deepEqual(payloads, [{ photoId: 'one', liked: true, weight: 5 }]);
  assert.equal(card.element.children[1].textContent, '5');
  assert.equal(viewer.element.children[1].textContent, '5');
  assert.equal(card.element.getAttribute('data-like-motion'), 'celebrating');
  assert.equal(viewer.element.classes.has('is-boosted'), true);
  card.element.emit('pointerdown', pointer); card.element.emit('pointerup', pointer);
  await card.element.emit('click', pointer);
  assert.deepEqual(payloads.at(-1), { photoId: 'one', liked: false });
  assert.equal(viewer.element.children[1].textContent, '0');
});

test('movement, deactivation and photo changes cancel an unfinished hold, and Space works with reduced motion', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const votes = [];
  let active = true;
  const service = {
    get: () => ({ count: 0, liked: false, loaded: true, canLike: true }),
    toggle: async id => votes.push(['toggle', id]),
    boost: async id => votes.push(['boost', id]),
  };
  const { element, setPhotoId, destroy } = createPhotoLikeButton({ document: doc, service, photoId: 'one', reducedMotion: () => true, isActive: () => active });
  t.after(destroy);
  const pointer = { pointerId: 1, button: 0, detail: 1, clientX: 20, clientY: 20 };
  element.emit('pointerdown', pointer);
  element.emit('pointermove', { ...pointer, clientX: 50 });
  t.mock.timers.tick(3000);
  await element.emit('click', pointer);
  element.emit('pointerdown', pointer); setPhotoId('two'); t.mock.timers.tick(3000);
  element.emit('pointerdown', pointer); active = false; t.mock.timers.tick(3000); active = true;
  assert.deepEqual(votes, []);
  element.emit('keydown', { key: ' ' }); t.mock.timers.tick(90);
  await element.emit('keyup', { key: ' ' });
  element.emit('keydown', { key: ' ' }); t.mock.timers.tick(2950); await tick();
  await element.emit('keyup', { key: ' ' });
  assert.deepEqual(votes, [['toggle', 'two'], ['boost', 'two']]);
});
