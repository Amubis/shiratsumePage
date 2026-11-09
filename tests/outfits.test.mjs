import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { OUTFITS, MODEL_PROFILE, wrapOutfitIndex, outfitRailGeometry, nearestOutfitDot, outfitViewGeometry, createOutfitShowcase } from '../src/outfits.js';

class Element {
  constructor(tag, doc) {
    this.localName = tag;
    this.ownerDocument = doc;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.classes = new Set();
    this.style = { setProperty(name, value) { this[name] = String(value); } };
    this.captures = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      contains: (name) => this.classes.has(name),
      toggle: (name, force) => {
        const add = force ?? !this.classes.has(name);
        if (add) this.classes.add(name); else this.classes.delete(name);
        return add;
      },
    };
    if (tag === 'img') this.decode = async () => {
      if (doc.failedImages.has(this.src)) throw new Error('Missing image');
      if (doc.delayedImages.has(this.src)) await doc.delayedImages.get(this.src);
    };
  }
  set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'class') this.className = String(value);
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  getBoundingClientRect() {
    return this.classList.contains('outfit-dots') ? { left: 10, top: 10, right: 186, bottom: 66, width: 176, height: 56 }
      : { left: 0, top: 0, right: 500, bottom: 600, width: 500, height: 600 };
  }
  setPointerCapture(id) { this.captures.add(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  focus() {
    const previous = this.ownerDocument.activeElement;
    this.ownerDocument.activeElement = this;
    previous?.emit('blur');
    this.emit('focus');
  }
  animate(frames, options) {
    let resolve, reject;
    const finished = new Promise((yes, no) => { resolve = yes; reject = no; });
    const animation = { node: this, frames, options, finished, stopped: false,
      cancel() { this.stopped = true; reject(new Error('cancelled')); },
      finish() { this.stopped = true; resolve(); } };
    this.ownerDocument.animations.push(animation);
    return animation;
  }
  emit(type, fields = {}) {
    const event = { type, target: this, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...fields };
    this.listeners.get(type)?.forEach((handler) => handler(event));
    return event;
  }
  all(predicate) { return this.children.flatMap((node) => [...(predicate(node) ? [node] : []), ...node.all(predicate)]); }
  find(className) { return this.all((node) => node.classList.contains(className))[0]; }
}

function fixture(t, { docSetup, ...options } = {}) {
  const doc = { failedImages: new Set(), delayedImages: new Map(), animations: [] };
  let clock = 0;
  let frameSerial = 0;
  const frames = new Map();
  doc.defaultView = {
    requestAnimationFrame(callback) { const id = ++frameSerial; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
  };
  doc.tick = (milliseconds) => {
    for (let elapsed = 0; elapsed < milliseconds; elapsed += 1000 / 60) {
      clock += 1000 / 60;
      const batch = [...frames];
      batch.forEach(([id]) => frames.delete(id));
      batch.forEach(([, callback]) => callback(clock));
    }
  };
  doc.pendingFrames = () => frames.size;
  docSetup?.(doc);
  doc.createElement = (tag) => new Element(tag, doc);
  doc.createElementNS = (_, tag) => new Element(tag, doc);
  const container = doc.createElement('div');
  const changed = [];
  const api = createOutfitShowcase({ container, reducedMotion: () => true, onChange: (index) => changed.push(index), ...options });
  t.after(() => api.destroy());
  return { doc, container, api, changed, pair:container.find('outfit-pair'), stage: container.find('outfit-stage'), backStage:container.find('outfit-back-stage'), image: container.find('outfit-image'), backImage:container.find('outfit-back-image'), dots: container.all((node) => node.classList.contains('outfit-dot')), rail: container.find('outfit-dots'), clover: container.find('outfit-rail-clover'), cue: container.find('outfit-cue'), status: container.find('outfit-status') };
}

async function settle() { for (let i = 0; i < 10; i += 1) await Promise.resolve(); }

test('each rear figure shares the front baseline and matches its visible height only during inspection', () => {
  for (const outfit of OUTFITS) {
    const geometry = outfitViewGeometry(outfit);
    const frontHeight = outfit.frontBounds[3] - outfit.frontBounds[1];
    const rearHeight = outfit.backBounds[3] - outfit.backBounds[1];
    assert.ok(Math.abs(rearHeight * geometry.previewScale - frontHeight) < 1e-8);
    assert.ok(Math.abs(rearHeight * geometry.restScale / frontHeight - .93) < 1e-10);
    for (const mode of ['rest', 'preview']) {
      const rearBottom = 1280 + (outfit.backBounds[3] - 1280) * geometry[`${mode}Scale`] + geometry[`${mode}Y`] / 100 * 2560;
      assert.ok(Math.abs(rearBottom - outfit.frontBounds[3]) < 1e-8, `${outfit.id}: baseline drift`);
      const rearCenter = geometry[`${mode}X`] / 100 * 1440 + 720 + ((outfit.backBounds[0] + outfit.backBounds[2]) / 2 - 720) * geometry[`${mode}Scale`];
      const frontCenter = (mode === 'rest' ? -.62 : -.70) * 1440 + (outfit.frontBounds[0] + outfit.frontBounds[2]) / 2;
      assert.ok(Math.abs((rearCenter - frontCenter) / 1440 - (mode === 'rest' ? .2 : .48)) < 1e-8);
    }
  }
});

test('four supplied matching front/back pairs are configured with both languages and real assets', async () => {
  assert.equal(OUTFITS.length, 4);
  assert.equal(new Set(OUTFITS.map(({ id }) => id)).size, 4);
  for (const outfit of OUTFITS) {
    assert.ok(outfit.back);
    assert.ok(outfit.label.zh);
    assert.ok(outfit.label.ja);
    assert.ok((await stat(new URL(`../${outfit.front}`, import.meta.url))).size > 1000);
    assert.ok((await stat(new URL(`../${outfit.back}`, import.meta.url))).size > 1000);
    assert.equal(outfit.front.replace('-front.png',''),outfit.back.replace('-back.png',''));
  }
  for (const locale of ['zh', 'ja']) for (const key of ['heading', 'lead', 'description']) assert.ok(MODEL_PROFILE[locale][key]);
  assert.equal(wrapOutfitIndex(-1), 3);
  assert.equal(wrapOutfitIndex(4), 0);
  assert.equal(wrapOutfitIndex(9), 1);
  assert.throws(() => wrapOutfitIndex(1.5), TypeError);
});

test('stage cycles through every outfit, loops, and keeps one selected dot and front image', async (t) => {
  const f = fixture(t);
  assert.equal(f.api.index, 0);
  assert.equal(f.cue.hidden, false);
  assert.equal(f.image.src, OUTFITS[0].front);
  for (const expected of [1, 2, 3, 0]) {
    f.stage.emit('click');
    await settle();
    assert.equal(f.api.index, expected);
    assert.equal(f.image.src, OUTFITS[expected].front);
    assert.equal(f.backImage.src, OUTFITS[expected].back, 'rear follows the selected outfit, not the next option');
    assert.equal(f.dots.filter((dot) => dot.getAttribute('aria-pressed') === 'true').length, 1);
    assert.equal(f.dots[expected].getAttribute('aria-pressed'), 'true');
  }
  assert.deepEqual(f.changed, [1, 2, 3, 0]);
  assert.equal(f.cue.hidden, true);
  assert.equal(f.container.all((node) => node.localName === 'img').length, 2);
});

test('dots select directly and language changes preserve the outfit and update accessible names', async (t) => {
  const f = fixture(t);
  f.dots[3].emit('click');
  await settle();
  assert.equal(f.api.index, 3);
  assert.ok(f.status.textContent.includes('蓝白格套装'));
  f.api.setLanguage('ja');
  assert.equal(f.api.index, 3);
  assert.ok(f.image.alt.includes('ブルーのギンガムコーデ'));
  assert.ok(f.backImage.alt.includes('ブルーのギンガムコーデ') && f.backImage.alt.includes('背面'));
  assert.ok(f.stage.getAttribute('aria-label').includes('タップして次のコーデへ'));
  assert.ok(f.dots[3].getAttribute('aria-label').includes('(4 / 4)'));
  assert.equal(f.cue.hidden, true);
});

test('arrow keys and endpoints are handled inside the stage rather than turning page chapters', async (t) => {
  const f = fixture(t);
  const event = f.stage.emit('keydown', { key: 'ArrowLeft' });
  await settle();
  assert.equal(f.api.index, 3);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  f.stage.emit('keydown', { key: 'Home' });
  await settle();
  assert.equal(f.api.index, 0);
  const tab = f.stage.emit('keydown', { key: 'Tab' });
  assert.equal(tab.prevented, false);
});

test('failed image decoding keeps the existing portrait visible and allows a later retry', async (t) => {
  const f = fixture(t);
  await settle();
  f.doc.failedImages.add(OUTFITS[2].front);
  assert.equal(await f.api.goTo(2), false);
  assert.equal(f.api.index, 0);
  assert.equal(f.image.src, OUTFITS[0].front);
  assert.equal(f.stage.getAttribute('aria-busy'), 'false');
  assert.ok(f.status.textContent.includes('加载失败'));
  f.doc.failedImages.clear();
  assert.equal(await f.api.goTo(2), true);
  assert.equal(f.api.index, 2);
});

test('a failed rear decode retains the entire selected pair and a retry can load both views', async (t) => {
  const f = fixture(t);
  await settle();
  f.doc.failedImages.add(OUTFITS[2].back);
  assert.equal(await f.api.goTo(2), false);
  assert.equal(f.api.index, 0);
  assert.equal(f.image.src, OUTFITS[0].front);
  assert.equal(f.backImage.src, OUTFITS[0].back);
  assert.equal(f.backStage.getAttribute('aria-busy'), 'false');
  f.doc.failedImages.clear();
  assert.equal(await f.api.goTo(2), true);
  assert.equal(f.image.src, OUTFITS[2].front);
  assert.equal(f.backImage.src, OUTFITS[2].back);
});

test('both views decode before either displayed image or its shadow switches', async (t) => {
  let completeBack;
  const loading = new Promise(resolve => { completeBack = resolve; });
  const f = fixture(t, {docSetup:doc=>doc.delayedImages.set(OUTFITS[2].back,loading)});
  const pending = f.api.goTo(2);
  await settle();
  assert.equal(f.image.src,OUTFITS[0].front);
  assert.equal(f.backImage.src,OUTFITS[0].back);
  assert.deepEqual(f.container.all(node=>node.localName==='image').map(node=>node.getAttribute('href')),[OUTFITS[0].front,OUTFITS[0].back]);
  assert.equal(f.stage.getAttribute('aria-busy'),'true');
  assert.equal(f.backStage.getAttribute('aria-busy'),'true');
  completeBack();
  assert.equal(await pending,true);
  const sources=f.container.all(node=>node.localName==='image');
  assert.deepEqual(sources.map(node=>node.getAttribute('href')),[OUTFITS[2].front,OUTFITS[2].back]);
});

test('rear hover and keyboard focus inspect without advancing, while its label explains next-outfit activation', (t) => {
  const f = fixture(t);
  assert.deepEqual(f.pair.children.map(node => node.localName), ['svg', 'button', 'button']);
  assert.equal(f.stage.children.some(node => node.localName === 'button'), false);
  assert.equal(f.backStage.getAttribute('aria-pressed'), null, 'advancing is not a toggle action');
  assert.ok(f.backStage.getAttribute('aria-label').includes('背面'));
  assert.ok(f.backStage.getAttribute('aria-label').includes('下一套'));
  f.backStage.emit('pointerenter', { pointerType: 'mouse' });
  assert.equal(f.pair.classList.contains('is-back-inspected'), true);
  assert.equal(f.api.index, 0);
  f.backStage.emit('pointerleave');
  assert.equal(f.pair.classList.contains('is-back-inspected'), false);
  f.backStage.focus();
  assert.equal(f.pair.classList.contains('is-back-inspected'), true);
  const escape = f.backStage.emit('keydown', { key: 'Escape' });
  assert.equal(escape.stopped, true);
  assert.equal(f.pair.classList.contains('is-back-inspected'), false);
});

test('touching either view advances the same matching pair and hides the cue', async (t) => {
  const f = fixture(t);
  f.backStage.emit('pointerdown', { pointerType: 'touch' });
  f.backStage.emit('focus');
  f.backStage.emit('pointerup', { pointerType: 'touch' });
  f.backStage.emit('click', { detail: 1 });
  await settle();
  assert.equal(f.api.index, 1);
  assert.equal(f.backImage.src, OUTFITS[1].back);
  assert.equal(f.cue.hidden, true);
  assert.equal(f.pair.classList.contains('is-back-inspected'), false);
  f.stage.emit('click'); await settle();
  assert.equal(f.api.index, 2);
  assert.equal(f.backImage.src, OUTFITS[2].back);
  f.api.setEnabled(false);
  f.backStage.emit('click'); await settle();
  assert.equal(f.api.index, 2);
  assert.equal(f.backStage.disabled, true);
});

test('delayed touch focus never pins the rear after activating the next outfit', async (t) => {
  const f = fixture(t);
  for (let expected = 1; expected <= 2; expected++) {
    f.backStage.emit('pointerdown', { pointerType: 'touch' });
    f.backStage.emit('pointerup', { pointerType: 'touch' });
    await settle();
    f.backStage.emit('focus');
    f.backStage.emit('click', { detail: 1 });
    await settle();
    assert.equal(f.api.index, expected);
    assert.equal(f.pair.classList.contains('is-back-inspected'), false);
  }
});

test('concurrent requests do not race or leave the stage busy; disabling blocks interactions', async (t) => {
  const f = fixture(t);
  const first = f.api.goTo(1);
  assert.equal(await f.api.goTo(3), false);
  assert.equal(await first, true);
  assert.equal(f.api.index, 1);
  f.api.setEnabled(false);
  assert.equal(await f.api.next(), false);
  assert.equal(f.stage.disabled, true);
  f.api.setEnabled(true);
  assert.equal(await f.api.previous(), true);
  assert.equal(f.api.index, 0);
});

test('one shared projection composes both silhouettes behind the portraits with a single opacity', (t) => {
  const a = fixture(t);
  const b = fixture(t);
  const masks = [a, b].map((f) => f.container.all((node) => node.localName === 'mask')[0]);
  assert.notEqual(masks[0].getAttribute('id'), masks[1].getAttribute('id'));
  assert.equal(masks[0].getAttribute('mask-type'), 'alpha');
  assert.equal(a.container.all(node=>node.localName==='mask').length,1);
  assert.equal(a.container.all(node=>node.localName==='pattern').length,1);
  assert.equal(a.container.all(node=>node.classList.contains('outfit-shadow')).length,1);
  assert.equal(masks[0].children.length,2);
  assert.deepEqual(masks[0].children.map(node=>node.getAttribute('href')),[OUTFITS[0].front,OUTFITS[0].back]);
  assert.equal(a.pair.children[0].classList.contains('outfit-shared-shadow'),true);
  assert.equal(a.stage.all(node=>node.localName==='mask').length,0);
  assert.equal(a.backStage.all(node=>node.localName==='mask').length,0);
  const source = masks[0].children[0];
  assert.equal(source.getAttribute('width'), '1440');
  assert.equal(source.getAttribute('height'), '2560');
  assert.equal(source.getAttribute('href'), OUTFITS[0].front);
  const group = a.container.all((node) => node.localName === 'g')[0];
  assert.equal(group.getAttribute('mask'), `url(#${masks[0].getAttribute('id')})`);
  assert.equal(group.getAttribute('opacity'), '.36');
  assert.equal(masks[0].children.every(node=>node.getAttribute('opacity')===null),true,'the union has no per-portrait opacity multiplication');
  const pattern = a.container.all((node) => node.localName === 'pattern')[0];
  assert.equal(pattern.getAttribute('width'), '52');
  const diameter = Number(pattern.children[0].getAttribute('r')) * 2;
  assert.ok(diameter >= 24, 'shadow circles remain about twice the original prototype diameter');
  assert.ok(Number(pattern.getAttribute('width')) - diameter >= 8, 'visible round circles have a clear gap rather than forming a solid silhouette');
});

test('the shared mask follows calibrated rear inspection, press and cancellation without replacing its nodes', (t) => {
  const f=fixture(t);
  const mask=f.container.all(node=>node.localName==='mask')[0];
  const sources=mask.children.slice();
  const matrix=node=>node.getAttribute('transform').match(/[\d.e+-]+/g).map(Number);
  const initial=sources.map(matrix);
  assert.ok(initial[1][0]<1);
  f.backStage.emit('pointerenter',{pointerType:'mouse'});
  const preview=sources.map(matrix);
  assert.ok(preview[1][0]>initial[1][0]);
  assert.ok(Math.abs((OUTFITS[0].backBounds[3]-OUTFITS[0].backBounds[1])*preview[1][3]-(OUTFITS[0].frontBounds[3]-OUTFITS[0].frontBounds[1]))<.002);
  f.backStage.emit('pointerleave');
  assert.deepEqual(sources.map(matrix),initial);
  f.stage.emit('pointerdown',{pointerId:1,button:0});
  assert.ok(Math.abs(matrix(sources[0])[0]-.94)<1e-6);
  f.stage.emit('pointercancel');
  assert.deepEqual(sources.map(matrix),initial);
  assert.equal(mask.children[0],sources[0]);assert.equal(mask.children[1],sources[1]);
});

test('projection synchronization stops after a short transition and destruction cancels pending work', (t) => {
  const f=fixture(t,{reducedMotion:()=>false});
  f.backStage.emit('pointerenter',{pointerType:'mouse'});
  assert.ok(f.doc.pendingFrames()>0);
  f.doc.tick(900);
  assert.equal(f.doc.pendingFrames(),0,'resting artwork must not retain a permanent projection frame loop');
  f.backStage.emit('pointerleave');
  assert.ok(f.doc.pendingFrames()>0);
  f.api.destroy();
  assert.equal(f.doc.pendingFrames(),0);
});

test('the indicator replaces the visible caption with one small clover and influenced passive circles', (t) => {
  const f = fixture(t);
  assert.equal(f.container.find('outfit-caption'), undefined);
  assert.equal(f.container.find('outfit-count'), undefined);
  assert.equal(f.container.find('outfit-name'), undefined);
  assert.equal(f.container.all((node) => node.classList.contains('outfit-rail-clover')).length, 1);
  const geometry = outfitRailGeometry(0);
  assert.equal(geometry.cloverSize, 26);
  assert.ok(geometry.dots.every((dot) => dot.size >= 5 && dot.size <= 10));
  assert.ok(geometry.dots[1].size > geometry.dots[2].size);
  assert.ok(geometry.dots[1].opacity > geometry.dots[2].opacity);
  assert.ok(geometry.dots.every((dot) => dot.size < geometry.cloverSize));
  assert.ok(geometry.dots[1].influence > 0);
  assert.equal(geometry.dots[2].influence, 0, 'influence extends slightly beyond one gap');
  assert.ok(geometry.dots[1].x - geometry.dots[0].x > geometry.dots[3].x - geometry.dots[2].x, 'far circles are more tightly packed');
  assert.equal(f.dots[0].getAttribute('aria-pressed'), 'true');
  assert.ok(f.dots[0].getAttribute('aria-label').includes('深色水手服'));
});

test('pointer follows continuously between snap zones, snaps near a circle, and returns to selected on leave', async (t) => {
  const f = fixture(t);
  await f.api.goTo(1, { animate: false });
  const initial = outfitRailGeometry(1);
  const middle = (initial.dots[1].x + initial.dots[2].x) / 2;
  f.rail.emit('pointerenter', { pointerType: 'mouse', clientX: 10 + middle });
  assert.ok(Math.abs(parseFloat(f.clover.style.left) - middle) < .001, 'the clover follows a coordinate between outfits');
  assert.equal(f.api.index, 1, 'hover never changes the displayed outfit');
  const secondDotX = parseFloat(f.dots[2].children[0].style.left) + 2 * 44;
  f.rail.emit('pointermove', { pointerType: 'mouse', clientX: 10 + secondDotX + 2 });
  assert.ok(Math.abs(parseFloat(f.clover.style.left) - outfitRailGeometry(2).cloverX) < .001, 'the circle hit zone snaps to that option');
  f.rail.emit('pointerleave');
  assert.equal(parseFloat(f.clover.style.left), outfitRailGeometry(1).cloverX);
  assert.equal(f.dots[1].getAttribute('aria-pressed'), 'true');
});

test('pointer clicks use the moving visual position while keyboard activation uses its stable semantic button', async (t) => {
  const f = fixture(t);
  const geometry = outfitRailGeometry(0);
  const lastX = geometry.dots[3].x;
  assert.equal(nearestOutfitDot(lastX, geometry), 3);
  f.dots[0].emit('click', { detail: 1, clientX: 10 + lastX });
  await settle();
  assert.equal(f.api.index, 3, 'even a different fixed hit element selects the visible circle under the pointer');
  f.dots[1].emit('click', { detail: 0, clientX: 0 });
  await settle();
  assert.equal(f.api.index, 1, 'keyboard activation follows the focused accessible option');
  const key = f.dots[1].emit('keydown', { key: 'ArrowRight' });
  await settle();
  assert.equal(f.api.index, 2);
  assert.equal(f.doc.activeElement, f.dots[2]);
  assert.equal(key.prevented, true);
  assert.equal(key.stopped, true);
});

test('the rail accelerates, briefly overshoots, rolls by travelled arc length and settles at the target', async (t) => {
  const f = fixture(t, { reducedMotion: () => false });
  await f.api.goTo(1, { animate: false });
  const initial = parseFloat(f.clover.style.left);
  const target = outfitRailGeometry(1).cloverX;
  const positions = [];
  for (let i = 0; i < 45; i += 1) { f.doc.tick(16); positions.push(parseFloat(f.clover.style.left)); }
  assert.ok(positions[0] > initial && positions[0] < positions[3]);
  assert.ok(positions[1] - positions[0] > positions[0] - initial, 'movement initially accelerates');
  assert.ok(Math.max(...positions) > target, 'the water-like motion briefly passes the target');
  f.doc.tick(1200);
  assert.equal(parseFloat(f.clover.style.left), target);
  const angle = Number(f.clover.style.transform.match(/rotate\(([^)]+)deg\)/)[1]);
  assert.ok(Math.abs(angle - (target - initial) / 13 * 180 / Math.PI) < .001, 'wheel rotation matches the visible travelled distance and enlarged clover radius');
});

test('stronger magnets acquire beyond the old snap zone and release with hysteresis into a free interval', (t) => {
  const f = fixture(t);
  const initial = outfitRailGeometry(0);
  f.rail.emit('pointerenter', { pointerType: 'mouse', clientX: 10 + initial.dots[1].x + 11 });
  const snapped = outfitRailGeometry(1);
  assert.equal(parseFloat(f.clover.style.left), snapped.cloverX, '11px from a circle now snaps');
  f.rail.emit('pointermove', { pointerType: 'mouse', clientX: 10 + snapped.dots[1].x + 16 });
  assert.equal(parseFloat(f.clover.style.left), snapped.cloverX, '16px remains held by the acquired magnet');
  const releasedX = snapped.dots[1].x + 19;
  f.rail.emit('pointermove', { pointerType: 'mouse', clientX: 10 + releasedX });
  assert.ok(Math.abs(parseFloat(f.clover.style.left) - releasedX) < .001, 'outside18px the gap permits continuous tracking');
});

test('both outer rail zones snap to their endpoints including far margins without extrapolating past a marker', (t) => {
  const f = fixture(t);
  const initial = outfitRailGeometry(0);
  for (const x of [-1000, 0, initial.dots[0].x + 13.5]) {
    f.rail.emit('pointermove', { pointerType: 'mouse', clientX: 10 + x });
    assert.equal(parseFloat(f.clover.style.left), outfitRailGeometry(0).cloverX);
  }
  for (const x of [initial.dots[3].x - 13.5, 176, 1000]) {
    f.rail.emit('pointermove', { pointerType: 'mouse', clientX: 10 + x });
    assert.equal(parseFloat(f.clover.style.left), outfitRailGeometry(3).cloverX);
  }
  assert.equal(f.api.index, 0, 'outer hover remains a preview rather than selecting an outfit');
});

test('fast pointer reversals remain inside end stops while programmatic end turns retain a small settling overshoot', async (t) => {
  const f = fixture(t, { reducedMotion: () => false });
  await f.api.goTo(3, { animate: false });
  const selectedEnd = outfitRailGeometry(3).cloverX;
  let furthest = 0;
  for (let step = 0; step < 50; step += 1) { f.doc.tick(16); furthest = Math.max(furthest, parseFloat(f.clover.style.left)); }
  assert.ok(furthest > selectedEnd, 'programmatic end selection keeps its light overshoot');
  for (const x of [0, 176, 0, 176]) {
    f.rail.emit('pointermove', { pointerType: 'mouse', clientX: 10 + x });
    for (let step = 0; step < 40; step += 1) {
      f.doc.tick(16);
      const center = parseFloat(f.clover.style.left);
      const first = parseFloat(f.dots[0].children[0].style.left);
      const last = parseFloat(f.dots[3].children[0].style.left) + 132;
      assert.ok(center >= first - .0001 && center <= last + .0001, 'pointer spring never carries the clover beyond an endpoint');
    }
  }
});

test('pointer press stays compressed indefinitely; cancel and release outside restore without activation', async (t) => {
  const f = fixture(t);
  f.stage.emit('pointerdown', { button: 0, pointerId: 7, clientX: 200, clientY: 300 });
  assert.equal(f.stage.style.transform, 'scale(.94)');
  assert.equal(f.stage.hasPointerCapture(7), true);
  f.doc.tick(10000);
  await settle();
  assert.equal(f.stage.style.transform, 'scale(.94)');
  assert.equal(f.api.index, 0);
  f.stage.emit('pointercancel', { pointerId: 7 });
  assert.equal(f.stage.style.transform, '');
  assert.equal(f.stage.hasPointerCapture(7), false);
  f.stage.emit('click', { detail: 1 });
  await settle();
  assert.equal(f.api.index, 0);
  f.stage.emit('pointerdown', { button: 0, pointerId: 8, clientX: 200, clientY: 300 });
  f.stage.emit('pointerup', { pointerId: 8, clientX: 600, clientY: 300 });
  f.stage.emit('click', { detail: 1 });
  await settle();
  assert.equal(f.api.index, 0);
  assert.equal(f.stage.style.transform, '');
});

test('the rear keeps hover inspection during a held press, owns capture, and supports Space and Enter', async (t) => {
  const f = fixture(t);
  f.backStage.emit('pointerenter', { pointerType: 'mouse' });
  f.backStage.emit('pointerdown', { button: 0, pointerId: 13, clientX: 200, clientY: 300 });
  f.stage.emit('blur');
  assert.equal(f.backStage.hasPointerCapture(13), true);
  assert.equal(f.stage.style.transform, 'scale(.94)');
  assert.equal(f.pair.classList.contains('is-back-inspected'), true);
  f.doc.tick(4000);
  assert.equal(f.api.index, 0);
  f.backStage.emit('pointerup', { pointerId: 13, clientX: 200, clientY: 300 });
  f.backStage.emit('click', { detail: 1 }); await settle();
  assert.equal(f.api.index, 1);
  assert.equal(f.backStage.hasPointerCapture(13), false);
  const down = f.backStage.emit('keydown', { key: ' ', repeat: false });
  assert.equal(down.prevented, true);
  assert.equal(f.stage.style.transform, 'scale(.94)');
  f.backStage.emit('keyup', { key: ' ' }); await settle();
  assert.equal(f.api.index, 2);
  f.backStage.emit('keydown', { key: 'Enter' });
  f.backStage.emit('click', { detail: 0 }); await settle();
  assert.equal(f.api.index, 3);
});

test('release holds the compressed portrait during delayed decode, then rebounds concurrently with the flip', async (t) => {
  let resolveImage;
  const loading = new Promise((resolve) => { resolveImage = resolve; });
  const f = fixture(t, { reducedMotion: () => false, docSetup: (doc) => doc.delayedImages.set(OUTFITS[1].front, loading) });
  f.stage.emit('pointerdown', { button: 0, pointerId: 9, clientX: 200, clientY: 300 });
  f.stage.emit('pointerup', { pointerId: 9, clientX: 200, clientY: 300 });
  f.stage.emit('click', { detail: 1 });
  f.doc.tick(1500);
  await settle();
  assert.equal(f.stage.style.transform, 'scale(.94)');
  assert.equal(f.image.src, OUTFITS[0].front);
  assert.equal(f.doc.animations.filter((animation) => animation.frames.some((frame) => frame.transform.includes('rotateY'))).length, 0);
  resolveImage();
  await settle();
  const rebound = f.doc.animations.find((animation) => animation.frames.some((frame) => frame.transform === 'scale(1.06)'));
  const flip = f.doc.animations.find((animation) => animation.frames.some((frame) => frame.transform.includes('rotateY')));
  assert.ok(rebound);
  assert.ok(flip);
  assert.equal(rebound.stopped, false);
  assert.equal(flip.stopped, false);
  assert.ok(f.doc.animations.every((animation) => animation.frames.every((frame) => !frame.transform.includes('translateY'))), 'the previous vertical bounce is gone');
  for (let step = 0; step < 3; step += 1) { f.doc.animations.filter((animation) => !animation.stopped).forEach((animation) => animation.finish()); await settle(); }
  assert.equal(f.api.index, 1);
  assert.equal(f.stage.style.transform, '');
  assert.equal(f.stage.getAttribute('aria-busy'), 'false');
});

test('Space holds until keyup, and theme disabling cancels a held press or turn cleanly', async (t) => {
  const f = fixture(t);
  const maskId = f.container.all((node) => node.localName === 'mask')[0].getAttribute('id');
  const down = f.stage.emit('keydown', { key: ' ', repeat: false });
  f.doc.tick(5000);
  assert.equal(down.prevented, true);
  assert.equal(f.stage.style.transform, 'scale(.94)');
  assert.equal(f.api.index, 0);
  f.stage.emit('keyup', { key: ' ' });
  await settle();
  assert.equal(f.api.index, 1);
  f.stage.emit('pointerdown', { button: 0, pointerId: 10 });
  f.api.setEnabled(false);
  assert.equal(f.stage.style.transform, '');
  assert.equal(f.stage.hasPointerCapture(10), false);
  assert.equal(f.stage.getAttribute('aria-busy'), 'false');
  f.api.setEnabled(true);
  assert.equal(await f.api.goTo(2), true);
  assert.equal(f.container.all((node) => node.localName === 'mask')[0].getAttribute('id'), maskId);
});

test('destroy removes all handlers and prevents asynchronous changes', async (t) => {
  const f = fixture(t);
  const pending = f.api.goTo(1);
  f.api.destroy();
  assert.equal(await pending, false);
  assert.equal(f.stage.listeners.get('click').size, 0);
  assert.equal(f.container.children.length, 0);
  assert.equal(await f.api.next(), false);
  assert.equal(f.api.index, 0);
});
