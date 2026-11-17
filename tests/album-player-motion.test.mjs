import test from 'node:test';
import assert from 'node:assert/strict';
import { albumPlayerOpenFrames, albumPlayerPictureRect, albumPlayerReturnFrames, ALBUM_PLAYER_TIMING, createAlbumPlayerMotion } from '../src/album-player-motion.js';

class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, listener) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(listener); }
  removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener); }
  emit(name, detail = {}) { const event = { prevented: false, preventDefault() { this.prevented = true; }, ...detail }; [...this.listeners.get(name) || []].forEach((listener) => listener(event)); return event; }
}
function fixture({ reduced = false, onRequestClose } = {}) {
  const doc = new Target(); const win = new Target(); doc.defaultView = win; doc.hidden = false;
  const animations = [];
  function node(rect) {
    const value = new Target(); value.ownerDocument = doc; value.rect = rect; value.children = []; value.attributes = new Map();
    value.setAttribute = (name, data) => value.attributes.set(name, data);
    value.append = (...children) => { children.forEach(child => { child.parentElement = value; value.children.push(child); }); };
    value.remove = () => { if (value.parentElement) value.parentElement.children = value.parentElement.children.filter(child => child !== value); value.parentElement = null; };
    const classes = new Set(); value.classList = { add: (...items) => items.forEach((item) => classes.add(item)), remove: (...items) => items.forEach((item) => classes.delete(item)), contains: (item) => classes.has(item) };
    const styles = new Map(); value.style = { setProperty: (name, data) => styles.set(name, data), removeProperty: (name) => styles.delete(name), getPropertyValue: (name) => styles.get(name) || '', getPropertyPriority: () => '' };
    value.getBoundingClientRect = () => value.rect;
    value.animate = (frames, options) => {
      let resolve, reject; const finished = new Promise((yes, no) => { resolve = yes; reject = no; });
      const animation = { node: value, frames, options, finished, cancelled: false, finish: () => resolve(), cancel() { this.cancelled = true; reject(new Error('cancelled')); } };
      animations.push(animation); return animation;
    };
    return value;
  }
  doc.createElement = () => node({ left: 0, top: 0, width: 0, height: 0 });
  win.getComputedStyle = (value, pseudo) => pseudo ? { opacity: '.8' } : { opacity: value.opacity ?? '1', transform: value.transform || 'none' };
  const dialog = node({ left: 160, top: 100, width: 1000, height: 700 }); dialog.open = false;
  dialog.showModal = () => { dialog.open = true; };
  let hidden = 0; dialog.close = () => { dialog.open = false; hidden++; dialog.emit('close'); };
  const source = node({ left: 400, top: 350, width: 200, height: 140 });
  const motion = createAlbumPlayerMotion({ dialog, reducedMotion: () => reduced, onRequestClose });
  return { doc, win, dialog, source, motion, animations, node, get hidden() { return hidden; }, set reduced(value) { reduced = value; }, show() { dialog.showModal(); } };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('player rises from the clicked print, flips past rest, and settles without changing the final box', () => {
  const frames = albumPlayerOpenFrames({ sourceRect: { left: 400, top: 350, width: 200, height: 140 }, dialogRect: { left: 160, top: 100, width: 1000, height: 700 } });
  assert.match(frames[0].transform, /translate\(-160\.00px,-22\.00px\) scale\(0\.2000\) rotateY\(-76deg\)/);
  assert.match(frames[1].transform, /translate\(0px,-22px\).*rotateY\(7deg\)/);
  assert.match(frames[2].transform, /translate\(0px,4px\).*rotateY\(-1.5deg\)/);
  assert.equal(frames.at(-1).transform, 'none');
  assert.equal(frames.at(-1).opacity, 1);
  assert.match(albumPlayerOpenFrames({ sourceRect: { left: 0, top: 0, width: 1, height: 1 } })[0].transform, /scale\(0\.1600\)/);
});

test('the transparent native dialog locks input while the real print charges, then the player springs open', async () => {
  const f = fixture(); const opening = f.motion.open({ source: f.source, show: f.show });
  assert.equal(f.dialog.open, true);
  assert.equal(f.motion.phase, 'charging');
  assert.equal(f.dialog.classList.contains('album-player-motion-charging'), true);
  assert.deepEqual(f.animations[0].frames, [{ scale: 1 }, { scale: .94 }]);
  assert.equal(f.animations[0].options.duration, ALBUM_PLAYER_TIMING.charge);
  f.animations[0].finish(); await flush();
  assert.equal(f.motion.phase, 'revealing');
  assert.equal(f.dialog.classList.contains('album-player-motion-charging'), false);
  assert.equal(f.dialog.classList.contains('album-player-motion-opening'), true);
  assert.equal(f.animations[1].node, f.dialog);
  f.animations[1].finish(); assert.equal(await opening, true);
  assert.equal(f.motion.busy, false);
  assert.equal(f.dialog.classList.contains('album-player-motion-opening'), false);
  assert.equal(f.source.classList.contains('album-photo-charging'), false);
  assert.equal(f.dialog.open, true);
});

test('closing without a destination fades the current pose, and native Escape waits for that fade', async () => {
  const f = fixture({ reduced: true }); await f.motion.open({ show: f.show }); f.reduced = false;
  f.dialog.opacity = '.7'; f.dialog.transform = 'matrix(1,0,0,1,0,-4)';
  const event = f.dialog.emit('cancel'); assert.equal(event.prevented, true);
  assert.equal(f.dialog.open, true); assert.equal(f.motion.busy, true);
  const fade = f.animations.at(-1);
  assert.equal(fade.options.duration, 180);
  assert.deepEqual(fade.frames, [{ opacity: .7, transform: f.dialog.transform }, { opacity: 0, transform: f.dialog.transform }]);
  fade.finish(); await flush();
  assert.equal(f.dialog.open, false); assert.equal(f.hidden, 1); assert.equal(f.motion.busy, false);
  assert.equal(f.dialog.style.getPropertyValue('--album-player-backdrop-from'), '');
});

test('cancelling during charge closes without flashing a backdrop or later reopening', async () => {
  const f = fixture(); const opening = f.motion.open({ source: f.source, show: f.show });
  const closing = f.motion.close(); assert.equal(await opening, false); assert.equal(await closing, true);
  assert.equal(f.dialog.open, false); assert.equal(f.hidden, 1);
  f.animations[0].finish(); await flush();
  assert.equal(f.animations.length, 1); assert.equal(f.dialog.open, false);
  assert.equal(f.source.classList.contains('album-photo-charging'), false);
});

test('rapid reopen and explicit teardown resolve old work and cannot retain a top-layer dialog', async () => {
  const f = fixture(); const first = f.motion.open({ source: f.source, show: f.show });
  const second = f.motion.open({ source: f.source, show: f.show });
  assert.equal(await first, false); assert.equal(await second, true);
  const closing = f.motion.close(); f.motion.cancel({ hide: () => f.dialog.close() });
  assert.equal(await closing, false); assert.equal(f.dialog.open, false);
  assert.equal(f.motion.busy, false); assert.equal(f.animations.every((animation) => animation.cancelled), true);
});

test('resize, backgrounding and Tab settle active work without a trapped hidden modal', async () => {
  const f = fixture(); const opening = f.motion.open({ source: f.source, show: f.show }); f.win.emit('resize');
  assert.equal(await opening, true); assert.equal(f.dialog.open, true); assert.equal(f.motion.busy, false);
  const closing = f.motion.close(); f.doc.hidden = true; f.doc.emit('visibilitychange');
  assert.equal(await closing, true); assert.equal(f.dialog.open, false);
  f.doc.hidden = false;
  const next = f.motion.open({ source: f.source, show: f.show }); f.dialog.emit('keydown', { key: 'Tab' });
  assert.equal(await next, true); assert.equal(f.dialog.classList.contains('album-player-motion-charging'), false);
  f.motion.destroy(); assert.equal(f.dialog.open, false);
  assert.equal([...f.doc.listeners.values(), ...f.win.listeners.values(), ...f.dialog.listeners.values()].every((set) => set.size === 0), true);
});

test('reduced motion and missing animation support show and close immediately', async () => {
  const f = fixture({ reduced: true }); assert.equal(await f.motion.open({ source: f.source, show: f.show }), true);
  assert.equal(f.animations.length, 0); assert.equal(await f.motion.close(), true);
  f.reduced = false; f.dialog.animate = undefined;
  assert.equal(await f.motion.open({ source: f.source, show: f.show }), true); assert.equal(f.dialog.open, true);
  assert.equal(await f.motion.close(), true); assert.equal(f.dialog.open, false);
});

test('external close and show failures release animations and hidden state', async () => {
  const f = fixture(); const opening = f.motion.open({ source: f.source, show: f.show }); f.dialog.close();
  assert.equal(await opening, false); assert.equal(f.motion.busy, false);
  assert.equal(f.source.classList.contains('album-photo-charging'), false);
  await assert.rejects(f.motion.open({ source: f.source, show() { f.dialog.showModal(); throw new Error('show failure'); } }), /show failure/);
  assert.equal(f.dialog.open, false); assert.equal(f.motion.busy, false);
});

test('the return starts at the contain-fitted bitmap and ends at the destination print box', () => {
  const image = { naturalWidth: 1600, naturalHeight: 900, getBoundingClientRect: () => ({ left: 200, top: 100, width: 800, height: 600 }) };
  const source = albumPlayerPictureRect(image);
  assert.deepEqual(source, { left: 200, top: 175, width: 800, height: 450 });
  const target = { left: 30, top: 80, width: 160, height: 90 };
  const frames = albumPlayerReturnFrames({ sourceRect: source, targetRect: target });
  assert.match(frames[2].transform, /rotateY\(67deg\)/);
  assert.equal(frames.at(-1).opacity, 0);
  assert.match(frames.at(-1).transform, /translate\(-490\.00px,-275\.00px\) scale\(0\.20000,0\.20000\) rotateY\(0deg\) rotateZ\(0deg\)/);
  assert.equal(albumPlayerPictureRect({ getBoundingClientRect: () => ({ width: 0, height: 0 }) }), null);
});

test('a settled player returns its current high resolution picture and restores the real destination', async () => {
  const f = fixture({ reduced: true }); await f.motion.open({ show: f.show }); f.reduced = false;
  const image = f.node({ left: 200, top: 100, width: 800, height: 600 }); image.src = 'https://media.example/current-photo.webp'; image.naturalWidth = 1600; image.naturalHeight = 900;
  const chrome = f.node({}); f.dialog.append(chrome);
  const closing = f.motion.close({ target: f.source, image });
  const plane = f.dialog.children.find(value => value.className === 'album-player-return-print');
  assert.ok(plane); assert.equal(plane.children[0].src, image.src);
  assert.equal(plane.style.getPropertyValue('top'), '65px', 'the 75px letterbox is excluded before adding the paper border');
  assert.equal(f.dialog.classList.contains('album-player-motion-returning'), true);
  assert.equal(f.source.classList.contains('album-photo-return-target'), true);
  assert.equal(f.motion.close({ target: f.source, image }), closing, 'repeated close does not restart the return');
  const flight = f.animations.at(-1); assert.equal(flight.node, plane); assert.equal(flight.options.duration, 480);
  assert.equal(f.animations.find(value => value.node === chrome).options.duration, 130);
  flight.finish(); assert.equal(await closing, true);
  assert.equal(f.dialog.open, false); assert.equal(f.hidden, 1); assert.equal(f.motion.busy, false);
  assert.equal(f.dialog.children.includes(plane), false); assert.equal(f.source.classList.contains('album-photo-return-target'), false);
  assert.equal(f.dialog.classList.contains('album-player-motion-returning'), false);
  assert.ok(f.animations.every(value => value.cancelled));
});

test('return cancellation and actual page scrolling remove the flying print and restore its destination', async () => {
  const f = fixture({ reduced: true }); await f.motion.open({ show: f.show }); f.reduced = false;
  const image = f.node({ left: 200, top: 150, width: 800, height: 450 }); image.src = '/photo.jpg';
  const first = f.motion.close({ target: f.source, image });
  f.motion.cancel({ hide: () => f.dialog.close() }); assert.equal(await first, false);
  assert.equal(f.dialog.children.length, 0); assert.equal(f.source.classList.contains('album-photo-return-target'), false);
  f.reduced = true; await f.motion.open({ show: f.show }); f.reduced = false;
  const second = f.motion.close({ target: f.source, image });
  f.win.emit('scroll'); assert.equal(f.motion.busy, true, 'a queued preparation scroll with unchanged coordinates is harmless');
  f.win.scrollY = 200; f.win.emit('scroll'); assert.equal(await second, true);
  assert.equal(f.dialog.open, false); assert.equal(f.dialog.children.length, 0); assert.equal(f.source.classList.contains('album-photo-return-target'), false);
});

test('missing destinations preserve fade fallback and Escape delegates preparation to the album', async () => {
  let requested = 0; const f = fixture({ reduced: true, onRequestClose: () => { requested++; } });
  await f.motion.open({ show: f.show }); f.reduced = false;
  const event = f.dialog.emit('cancel'); assert.equal(event.prevented, true); assert.equal(requested, 1); assert.equal(f.motion.busy, false);
  const closing = f.motion.close({ target: { isConnected: false } });
  assert.equal(f.animations.at(-1).options.duration, 180); assert.equal(f.dialog.children.length, 0);
  f.animations.at(-1).finish(); assert.equal(await closing, true);
});
