import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { seededRandom, generateSceneLayout, generateRadialHalftoneDots, hexToHsl, hslToHex, randomThemeColor, SMALL_CLOVER_PATH, CLOVER_PATH, SCENE_LAYOUT, cloverSVG, createCloverScene, createHalftoneSVG, halftoneShadowSVG } from '../src/scene.js';
import { createVideoPlayer } from '../src/media.js';

test('seeded colors/poses remain stable across language renders but differ by model', () => {
  const sequence = (seed) => { const random = seededRandom(seed); return Array.from({ length: 20 }, random); };
  assert.deepEqual(sequence('shiratsume'), sequence('shiratsume'));
  assert.notDeepEqual(sequence('shiratsume'), sequence('another-model'));
  assert.ok(sequence('shiratsume').every((value) => value >= 0 && value < 1));
});

test('theme hex/HSL round trips and matches the requested base', () => {
  const value = hexToHsl('#B7BB5A');
  assert.ok(Math.abs(value.h - 62.474) < 0.001);
  assert.ok(Math.abs(value.s - 41.631) < 0.001);
  assert.ok(Math.abs(value.l - 54.314) < 0.001);
  for (const color of ['#b7bb5a', '#ffffff', '#000000', '#ff0000', '#123456']) {
    assert.equal(hslToHex(hexToHsl(color)), color);
  }
  assert.equal(hslToHex(hexToHsl('#abc')), '#aabbcc');
  assert.throws(() => hexToHsl('var(--theme)'), TypeError);
});

test('near-theme colors stay inside the specified HSL deviations', () => {
  const base = hexToHsl('#B7BB5A');
  const random = seededRandom('palette');
  for (let index = 0; index < 1000; index += 1) {
    const color = randomThemeColor('#B7BB5A', random);
    assert.ok(Math.abs(color.h - base.h) <= 5);
    assert.ok(Math.abs(color.s - base.s) <= 10);
    assert.ok(Math.abs(color.l - base.l) <= 10);
  }
  const red = randomThemeColor('#ff0000', () => 0);
  assert.equal(red.h, 355);
  assert.equal(red.s, 90);
});

test('clover is one joined path with reusable exact geometry and escaped attributes', () => {
  const svg = cloverSVG({ className: 'clover-svg', color: '#B7BB5A' });
  assert.equal((svg.match(/<path /g) || []).length, 1);
  for (const path of [SMALL_CLOVER_PATH, CLOVER_PATH]) {
    assert.equal((path.match(/M/g) || []).length, 1);
    assert.ok(path.endsWith('Z'));
  }
  assert.ok(svg.includes(`d="${SMALL_CLOVER_PATH}"`));
  assert.ok(cloverSVG({ variant: 'large' }).includes(`d="${CLOVER_PATH}"`));
  assert.ok((SMALL_CLOVER_PATH.match(/C/g) || []).length < (CLOVER_PATH.match(/C/g) || []).length);
  assert.ok(svg.includes('aria-hidden="true"'));
  assert.ok(!svg.includes('<circle'));
  assert.ok(!cloverSVG({ color: '" onload="alert(1)' }).includes('fill="" onload='));
});

function svgDots(svg) {
  return [...svg.matchAll(/<circle cx="(-?[\d.]+)" cy="(-?[\d.]+)" r="([\d.]+)"/g)]
    .map((match) => ({ x: Number(match[1]), y: Number(match[2]), radius: Number(match[3]) }));
}

test('radial halftone preserves the accepted dot density, sizes and clear center', () => {
  const svg = createHalftoneSVG();
  assert.ok(!svg.includes('<filter'));
  const dots = svgDots(svg);
  assert.ok(dots.length > 100 && dots.length < 800);
  assert.ok(!dots.some(({ x, y }) => Math.abs(x - 720) < 150 && Math.abs(y - 450) < 90));
  assert.ok(Math.max(...dots.map(({ radius }) => radius)) >= 46 / Math.SQRT2);
  assert.ok(dots.some(({ radius }) => radius < 1));
  assert.equal((svg.match(/opacity=/g) || []).length, 1);
  assert.ok(svg.includes('opacity="1"'));
  assert.ok(svg.includes('data-layout="radial"'));
  assert.ok(svg.includes('data-ring='));
  assert.ok(createHalftoneSVG({ width: 390, height: 844 }).includes('viewBox="0 0 390 844"'));
});

test('dots form stable concentric rings with physical spacing rather than a rectangular grid', () => {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const dots = generateRadialHalftoneDots({ width, height });
    assert.deepEqual(dots, generateRadialHalftoneDots({ width, height }));
    const rings = new Map();
    dots.forEach((dot) => {
      const distance = Math.hypot(dot.x - width / 2, dot.y - height / 2);
      assert.ok(Math.abs(distance - dot.ringRadius) < 1e-7);
      assert.ok(Math.abs(distance / Math.min(width / 2, height / 2) - dot.rho) < 1e-7);
      if (!rings.has(dot.ring)) rings.set(dot.ring, []);
      rings.get(dot.ring).push(dot);
    });
    assert.ok(rings.size >= 8);
    rings.forEach((ring) => {
      assert.equal(new Set(ring.map(({ rho }) => rho)).size, 1);
      for (let index = 1; index < ring.length; index += 1) {
        assert.ok(Math.hypot(ring[index].x - ring[index - 1].x, ring[index].y - ring[index - 1].y) > 38);
      }
    });
    const xCoordinates = new Set(dots.map(({ x }) => x.toFixed(3)));
    const yCoordinates = new Set(dots.map(({ y }) => y.toFixed(3)));
    assert.ok(xCoordinates.size > dots.length * 0.3);
    assert.ok(yCoordinates.size > dots.length * 0.3);
  }
});

test('dot size grows outwards along a ray until the outer dots merge', () => {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const dots = generateRadialHalftoneDots({ width, height });
    const ray = dots.filter(({ x, y }) => x > width / 2 && Math.abs(y - height / 2) / (x - width / 2) < 0.13).sort((a, b) => a.x - b.x);
    assert.ok(ray.length >= 2);
    for (let index = 1; index < ray.length; index += 1) assert.ok(ray[index].radius >= ray[index - 1].radius);
    assert.ok(ray.at(-1).radius >= 46 / Math.SQRT2);
    assert.ok(dots.every(({ x, y, radius }) => Math.hypot(x - width / 2, y - height / 2) > radius));
  }
});

test('dot footprints keep the central 60 percent rectangle fully clear on desktop and mobile', () => {
  for (const [width, height] of [[1440, 900], [390, 844], [320, 568]]) {
    const dots = svgDots(createHalftoneSVG({ width, height }));
    dots.forEach(({ x, y, radius }) => {
      const nearestEdge = Math.min(x / width, (width - x) / width, y / height, (height - y) / height);
      assert.ok(nearestEdge <= 0.18);
      const distance = Math.hypot(Math.max(width * 0.2 - x, 0, x - width * 0.8), Math.max(height * 0.2 - y, 0, y - height * 0.8));
      // Test the rendered two-decimal radii, including a half-pixel safety gap.
      assert.ok(distance >= radius + 0.48);
    });
  }
});

test('all four edges, including their midpoints, have a continuous filled outer band', () => {
  for (const [width, height] of [[1440, 900], [390, 844], [320, 568]]) {
    const dots = svgDots(createHalftoneSVG({ width, height }));
    const covered = (x, y) => dots.some((dot) => (dot.x - x) ** 2 + (dot.y - y) ** 2 <= dot.radius ** 2);
    for (const depth of [0, 10, 20]) {
      for (let x = 0; x <= width; x += 4) {
        assert.ok(covered(x, depth));
        assert.ok(covered(x, height - depth));
      }
      for (let y = 0; y <= height; y += 4) {
        assert.ok(covered(depth, y));
        assert.ok(covered(width - depth, y));
      }
    }
  }
});

test('preview retains the original smaller, separated dot profile', () => {
  const svg = createHalftoneSVG({ profile: 'soft' });
  const dots = svgDots(svg);
  assert.equal(dots[1].x - dots[0].x, 34);
  assert.equal(Math.max(...dots.map(({ radius }) => radius)), 17);
  assert.ok(svg.includes('opacity=".58"'));
  assert.equal(createHash('sha256').update(svg).digest('hex'), 'ada9ab0d352dc7c72784f4e30d848fc19668112878f4a0eadeffc4adc15f7f80');
  assert.equal(createHash('sha256').update(createHalftoneSVG({ profile: 'soft', width: 390, height: 844 })).digest('hex'), 'fb5385aba858b0cbcc9cac8c21ff9fe2996cc499fe308c53e61daacb1be09d60');
});

test('preview clovers keep their original overlapping side cluster', () => {
  assert.equal(SCENE_LAYOUT.length, 3);
  assert.ok(SCENE_LAYOUT.every(({ x, y }) => x <= 30 && y >= 55));
  const [first, second] = SCENE_LAYOUT;
  const distance = Math.hypot((first.x - second.x) * 10, (first.y - second.y) * 8);
  assert.ok(distance < (first.size + second.size) * 8 / 2);
  assert.ok(Object.isFrozen(SCENE_LAYOUT));
  assert.ok(SCENE_LAYOUT.some(({ variant }) => variant === 'small'));
  assert.ok(SCENE_LAYOUT.some(({ variant }) => variant === 'large'));
});

test('generated layouts are reproducible, dispersed across sides, and clear the title', () => {
  assert.deepEqual(generateSceneLayout('visit-a'), generateSceneLayout('visit-a'));
  assert.notDeepEqual(generateSceneLayout('visit-a'), generateSceneLayout('visit-b'));
  for (let seed = 0; seed < 500; seed += 1) {
    const layout = generateSceneLayout(`visit-${seed}`);
    assert.equal(layout.length, 3);
    assert.ok(layout.some(({ x }) => x < 32));
    assert.ok(layout.some(({ x }) => x > 68));
    layout.forEach((shape, index) => {
      assert.ok(shape.size >= 28 && shape.size <= 46);
      const half = shape.size / 2;
      const overlapsTitle = shape.x + half > 32 && shape.x - half < 68 && shape.y + half > 25 && shape.y - half < 65;
      assert.equal(overlapsTitle, false);
      layout.slice(index + 1).forEach((other) => assert.ok(Math.hypot(shape.x - other.x, shape.y - other.y) >= 38));
    });
    assert.ok(Math.abs(layout[0].y - layout[1].y) >= 18);
  }
});

test('scene instances expose their actual shape variants and rebuild without extra decorations', () => {
  const children = [];
  const doc = {
    createDocumentFragment: () => ({ children: [], append(element) { this.children.push(element); } }),
    createElement: () => ({
      attributes: {}, variables: {}, style: { setProperty(name, value) { this[name] = value; } },
      setAttribute(name, value) { this.attributes[name] = value; },
      remove() { const index = children.indexOf(this); if (index >= 0) children.splice(index, 1); },
    }),
  };
  const container = { ownerDocument: doc, append(fragment) { children.push(...fragment.children); } };
  const scene = createCloverScene({ container });
  const pose = () => children.map((element) => ['--x', '--y', '--size', '--rotation'].map((name) => element.style[name]));
  const originalPose = pose();
  assert.equal(children.length, 3);
  children.forEach((element, index) => {
    assert.equal(element.attributes['data-contrast-shape'], '');
    assert.equal(element.attributes['data-shape-variant'], SCENE_LAYOUT[index].variant);
    assert.ok(element.attributes['data-scene-id'].startsWith('scatter-'));
    const duration = parseFloat(element.style['--duration']);
    assert.ok(duration >= 4 && duration <= 7);
    assert.ok(element.innerHTML.includes(SCENE_LAYOUT[index].variant === 'large' ? CLOVER_PATH : SMALL_CLOVER_PATH));
  });
  scene.setTheme('#B8A0C2', 'preview');
  assert.equal(children.length, 3);
  assert.ok(children[0].innerHTML.includes('#B8A0C2'));
  children.forEach((element, index) => {
    assert.equal(element.attributes['data-scene-id'], SCENE_LAYOUT[index].id);
    assert.equal(element.style['--x'], `${SCENE_LAYOUT[index].x}%`);
  });
  scene.setTheme('#B7BB5A', 'shiratsume');
  assert.deepEqual(pose(), originalPose);
  scene.setTheme('#B7BB5A', 'shiratsume');
  assert.deepEqual(pose(), originalPose);
  scene.destroy();
  assert.equal(children.length, 0);
});

test('clover projection grows near-solid dots at the outer contour without a blur filter', () => {
  const svg = halftoneShadowSVG({ id: 'explore-one', color: '#B7BB5A', shadowColor: '#272923' });
  const dots = svgDots(svg);
  assert.ok(svg.includes('clipPathUnits="userSpaceOnUse"'));
  assert.ok(svg.includes('transform="translate(6 7)"'));
  assert.ok(dots.some(({ radius }) => radius === 2.3));
  assert.ok(Math.max(...dots.map(({ radius }) => radius)) >= 7 / Math.SQRT2);
  assert.equal(dots.find(({ x, y }) => x === 49 && y === 49).radius, 2.3);
  assert.ok(dots.find(({ x, y }) => x === 105 && y === 105).radius >= 7 / Math.SQRT2);
  assert.ok(svg.includes(`d="${CLOVER_PATH}"`));
  assert.ok(svg.includes('fill="#B7BB5A"'));
  assert.ok(!svg.includes('<filter'));
  assert.notEqual(halftoneShadowSVG(), halftoneShadowSVG());
});

test('preview clover projection retains the original uniform, separated pattern', () => {
  const svg = halftoneShadowSVG({ id: 'preview-shadow', profile: 'soft' });
  assert.ok(svg.includes('<pattern'));
  assert.ok(svg.includes('r="2.3"'));
  assert.ok(svg.includes('width="7" height="7"'));
  assert.ok(!svg.includes('<filter'));
});

function mediaFixture(play = () => Promise.resolve(), { nativePrimary = false } = {}) {
  const layers = [];
  const poster = { style: {}, src: 'poster.jpg' };
  const classes = new Set();
  const docListeners = new Map();
  const doc = {
    hidden: false,
    addEventListener: (name, callback) => docListeners.set(name, callback),
    removeEventListener: (name) => docListeners.delete(name),
    createElement() {
      const events = new Map();
      const video = {
        style: {}, dataset: {}, duration: 10, currentTime: 0, readyState: 4, pauseCalls: 0, paused: true,
        setAttribute() {}, removeAttribute(name) { delete this[name]; }, load() {},
        play() { this.paused = false; return play(this); }, pause() { this.paused = true; this.pauseCalls += 1; }, remove() {},
        addEventListener: (name, callback) => events.set(name, callback),
        removeEventListener: (name) => events.delete(name),
        emit: (name) => events.get(name)?.(),
      };
      layers.push(video);
      return video;
    },
  };
  const primary = nativePrimary ? doc.createElement('video') : null;
  if (primary) { primary.controls = true; primary.src = 'a.mp4'; }
  const container = {
    ownerDocument: doc, dataset: {}, append() {},
    querySelector: (selector) => selector === 'img.poster' ? poster : selector === 'video[data-hero-primary]' ? primary : null,
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
  };
  return { container, layers, poster, doc, classes, primary, emitVisibility: () => docListeners.get('visibilitychange')?.() };
}

test('video player requests exactly two non-repeating layers and keeps an opaque crossfade base', async () => {
  const fixture = mediaFixture();
  const player = createVideoPlayer({ container: fixture.container, playlist: ['a.mp4', 'b.mp4', 'c.mp4'] });
  assert.equal(fixture.layers.length, 2);
  assert.notEqual(fixture.layers[0].src, fixture.layers[1].src);
  assert.equal(await player.start(), true);
  fixture.layers[0].currentTime = 9.5;
  fixture.layers[0].emit('timeupdate');
  await Promise.resolve();
  assert.equal(fixture.layers[1].style.zIndex, '2');
  assert.equal(fixture.layers[0].style.opacity, '1');
  assert.equal(fixture.layers[1].style.opacity, '1');
  player.destroy();
});

test('autoplay rejection leaves the poster usable without a rejected start promise', async () => {
  const fixture = mediaFixture(() => Promise.reject(new Error('Autoplay blocked')));
  const player = createVideoPlayer({ container: fixture.container, playlist: ['a.mp4'] });
  assert.equal(await player.start(), false);
  assert.equal(fixture.poster.style.opacity, '1');
  assert.equal(fixture.classes.has('has-video'), false);
  player.destroy();
});

test('a stale playback promise cannot pause the newly selected model', async () => {
  let release;
  let calls = 0;
  const firstPlayback = new Promise((resolve) => { release = resolve; });
  const fixture = mediaFixture(() => ++calls === 1 ? firstPlayback : Promise.resolve());
  const player = createVideoPlayer({ container: fixture.container, playlist: ['old.mp4'] });
  const oldStart = player.start();
  player.setPlaylist(['new.mp4'], 'new.jpg');
  await Promise.resolve();
  const pausesBefore = fixture.layers[0].pauseCalls;
  release();
  assert.equal(await oldStart, false);
  assert.equal(fixture.layers[0].pauseCalls, pausesBefore);
  assert.equal(fixture.layers[0].src, 'new.mp4');
  player.destroy();
});

test('reduced motion waits for intentional playback and visibility preserves user pause', async () => {
  let calls = 0;
  const fixture = mediaFixture(() => { calls += 1; return Promise.resolve(); });
  const player = createVideoPlayer({ container: fixture.container, playlist: ['a.mp4'], reducedMotion: () => true });
  assert.equal(await player.start(), false);
  assert.equal(calls, 0);
  assert.equal(await player.resume(), true);
  player.pause();
  assert.equal(player.paused, true);
  fixture.doc.hidden = true;
  fixture.emitVisibility();
  fixture.doc.hidden = false;
  fixture.emitVisibility();
  assert.equal(calls, 1);
  player.destroy();
});

test('native primary video is reused and only one additional layer is created', async () => {
  const fixture = mediaFixture(undefined, { nativePrimary: true });
  const player = createVideoPlayer({ container: fixture.container, playlist: ['a.mp4', 'b.mp4'] });
  assert.equal(fixture.layers.length, 2);
  assert.equal(fixture.layers[0], fixture.primary);
  assert.equal(fixture.primary.controls, false);
  assert.equal(fixture.classes.has('is-managed'), true);
  assert.equal(await player.start(), true);
  player.destroy();
});

test('a playing event reveals video even when the play promise never settles', async () => {
  const fixture = mediaFixture(() => new Promise(() => {}));
  const player = createVideoPlayer({ container: fixture.container, playlist: ['a.mp4'], loadingTimeout: 15 });
  const starting = player.start();
  assert.equal(fixture.container.dataset.videoState, 'loading');
  fixture.layers[0].emit('playing');
  assert.equal(await starting, true);
  assert.equal(fixture.container.dataset.videoState, 'playing');
  assert.equal(fixture.classes.has('has-video'), true);
  assert.equal(fixture.poster.style.opacity, '0');
  player.destroy();
});

test('loading timeout is visible and a manual retry can recover', async () => {
  let calls = 0;
  const fixture = mediaFixture(() => ++calls === 1 ? new Promise(() => {}) : Promise.resolve());
  const player = createVideoPlayer({ container: fixture.container, playlist: ['a.mp4'], loadingTimeout: 3 });
  assert.equal(await player.start(), false);
  assert.equal(fixture.container.dataset.videoState, 'timeout');
  assert.equal(fixture.poster.style.opacity, '1');
  assert.equal(await player.resume(), true);
  assert.equal(fixture.container.dataset.videoState, 'playing');
  player.destroy();
});

test('a late playing event recovers a timed-out attempt without a reload', async () => {
  const fixture = mediaFixture(() => new Promise(() => {}));
  const player = createVideoPlayer({ container: fixture.container, playlist: ['a.mp4'], loadingTimeout: 3 });
  assert.equal(await player.start(), false);
  fixture.layers[0].emit('playing');
  assert.equal(fixture.container.dataset.videoState, 'playing');
  assert.equal(player.paused, false);
  player.destroy();
});

test('a late play rejection after pause cannot overwrite the paused state', async () => {
  let reject;
  const fixture = mediaFixture(() => new Promise((resolve, fail) => { reject = fail; }));
  const statuses = [];
  const player = createVideoPlayer({ container: fixture.container, playlist: ['a.mp4'], loadingTimeout: 3, onStatus: (value) => statuses.push(value) });
  const starting = player.start();
  player.pause();
  reject(Object.assign(new Error('Interrupted'), { name: 'AbortError' }));
  assert.equal(await starting, false);
  await new Promise((resolve) => setTimeout(resolve, 6));
  assert.equal(fixture.container.dataset.videoState, 'paused');
  assert.equal(statuses.at(-1), 'paused');
  assert.equal(statuses.includes('blocked'), false);
  player.destroy();
});

test('only NotAllowedError is reported as blocked, preserving the reason', async () => {
  const fixture = mediaFixture(() => Promise.reject(Object.assign(new Error('Policy rejected autoplay'), { name: 'NotAllowedError' })));
  let last;
  const player = createVideoPlayer({ container: fixture.container, playlist: ['a.mp4'], onStatus: (state, details) => { last = { state, details }; } });
  assert.equal(await player.start(), false);
  assert.equal(last.state, 'blocked');
  assert.equal(last.details.reason, 'NotAllowedError');
  assert.equal(fixture.poster.style.opacity, '1');
  player.destroy();
});

test('a stale rejection from an earlier retry cannot replace a successful newer play', async () => {
  let rejectFirst;
  let calls = 0;
  const fixture = mediaFixture(() => ++calls === 1 ? new Promise((resolve, reject) => { rejectFirst = reject; }) : Promise.resolve());
  const player = createVideoPlayer({ container: fixture.container, playlist: ['a.mp4'] });
  const first = player.start();
  assert.equal(await player.resume(), true);
  rejectFirst(Object.assign(new Error('Old request was interrupted'), { name: 'AbortError' }));
  assert.equal(await first, false);
  await Promise.resolve();
  assert.equal(fixture.container.dataset.videoState, 'playing');
  player.destroy();
});

test('an active AbortError is an error, not a fabricated autoplay block', async () => {
  const fixture = mediaFixture(() => Promise.reject(Object.assign(new Error('Interrupted'), { name: 'AbortError' })));
  let last;
  const player = createVideoPlayer({ container: fixture.container, playlist: ['a.mp4'], onStatus: (state, details) => { last = { state, details }; } });
  assert.equal(await player.start(), false);
  assert.deepEqual(last, { state: 'error', details: { reason: 'AbortError' } });
  player.destroy();
});

test('decode errors expose the native media error code and reset the visible layer', async () => {
  const fixture = mediaFixture();
  let last;
  const player = createVideoPlayer({ container: fixture.container, playlist: ['a.mp4'], onStatus: (state, details) => { last = { state, details }; } });
  await player.start();
  fixture.layers[0].error = { code: 3 };
  fixture.layers[0].emit('error');
  assert.deepEqual(last, { state: 'error', details: { reason: 'decode', errorCode: 3 } });
  assert.equal(fixture.poster.style.opacity, '1');
  player.destroy();
});

test('model switch resets layer stacking after a crossfade has promoted the second layer', async () => {
  const fixture = mediaFixture();
  const player = createVideoPlayer({ container: fixture.container, playlist: ['a.mp4', 'b.mp4'] });
  await player.start();
  fixture.layers[0].currentTime = 9.5;
  fixture.layers[0].emit('timeupdate');
  await Promise.resolve();
  assert.equal(fixture.layers[1].style.zIndex, '2');
  player.setPlaylist(['new.mp4']);
  await Promise.resolve();
  assert.equal(fixture.layers[0].style.zIndex, '1');
  assert.equal(fixture.layers[1].style.zIndex, '0');
  assert.equal(fixture.layers[0].src, 'new.mp4');
  player.destroy();
});
