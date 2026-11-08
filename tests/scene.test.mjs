import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { seededRandom, generateSceneLayout, generateTiltedGridDots, generateRadialHalftoneDots, generateEllipticalHalftoneDots, hexToHsl, hslToHex, randomThemeColor, SMALL_CLOVER_PATH, CLOVER_PATH, SCENE_LAYOUT, cloverSVG, createCloverScene, createHalftoneSVG, halftoneShadowSVG } from '../src/scene.js';
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
  return [...svg.matchAll(/<circle cx="(-?[\d.]+)" cy="(-?[\d.]+)" r="([\d.]+)"([^>]*)>/g)]
    .map((match) => ({
      x: Number(match[1]), y: Number(match[2]), radius: Number(match[3]),
      alpha: Number(match[4].match(/\bopacity="([\d.]+)"/)?.[1] ?? 1),
      progress: Number(match[4].match(/\bdata-progress="([\d.]+)"/)?.[1] ?? 1),
    }));
}

const halftoneViewports = [[1899, 973], [1440, 900], [390, 844], [320, 844], [320, 568]];
const defaultDotSpacing = (width, height) => Math.min(width, height) <= 600 ? 16 : 32;

test('tilted grid responds with 16/32px spacing, proportional radii and individual feather opacity', () => {
  for (const [width, height] of halftoneViewports) {
    const spacing = defaultDotSpacing(width, height);
    const svg = createHalftoneSVG({ width, height });
    const dots = svgDots(svg);
    assert.ok(!svg.includes('<filter'));
    assert.ok(dots.length > 100 && dots.length < 3000);
    assert.equal(Math.max(...dots.map(({ radius }) => radius)), spacing * 0.75);
    assert.ok(dots.some(({ radius }) => radius < 1));
    assert.equal((svg.match(/\bopacity=/g) || []).length, dots.length + 1);
    assert.ok(svg.startsWith('<svg') && svg.includes('fill="currentColor" opacity="1"'));
    assert.ok(svg.includes('data-layout="tilted-grid"'));
    assert.ok(svg.includes('data-angle="8"'));
    assert.ok(svg.includes(`data-dot-spacing="${spacing}"`));
    assert.ok(svg.includes(`data-max-radius="${spacing * 0.75}"`));
    assert.ok(svg.includes(`data-feather-width="${spacing * 5}"`));
    assert.ok(svg.includes('data-feather-steps="5"'));
    assert.ok(svg.includes(`viewBox="0 0 ${width} ${height}"`));
    assert.ok(dots.every(({ alpha, progress }) => alpha > 0 && alpha <= 1 && progress > 0 && progress <= 1));
    assert.ok(dots.some(({ alpha }) => alpha < 0.15));
    assert.ok(dots.some(({ alpha }) => alpha > 0.2 && alpha < 0.6));
    assert.ok(dots.some(({ alpha }) => alpha > 0.7 && alpha < 0.95));
  }
});

test('responsive grid keeps equal orthogonal steps rotated clockwise 8 degrees around the viewport center', () => {
  for (const [width, height] of halftoneViewports) {
    const spacing = defaultDotSpacing(width, height);
    const dots = generateTiltedGridDots({ width, height });
    assert.deepEqual(dots, generateTiltedGridDots({ width, height }));
    assert.deepEqual(dots, generateEllipticalHalftoneDots({ width, height }));
    assert.deepEqual(dots, generateRadialHalftoneDots({ width, height }));
    const angle = 8 * Math.PI / 180;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const byIndex = new Map(dots.map((dot) => [`${dot.gridX},${dot.gridY}`, dot]));
    assert.equal(byIndex.size, dots.length);
    let neighborPairs = 0;
    dots.forEach((dot) => {
      const x = dot.x - width / 2;
      const y = dot.y - height / 2;
      assert.ok(Math.abs((cosine * x + sine * y) / spacing - dot.gridX) < 1e-8);
      assert.ok(Math.abs((-sine * x + cosine * y) / spacing - dot.gridY) < 1e-8);
      const right = byIndex.get(`${dot.gridX + 1},${dot.gridY}`);
      const down = byIndex.get(`${dot.gridX},${dot.gridY + 1}`);
      if (right && down) {
        const u = [right.x - dot.x, right.y - dot.y];
        const v = [down.x - dot.x, down.y - dot.y];
        assert.ok(Math.abs(Math.hypot(...u) - spacing) < 1e-8);
        assert.ok(Math.abs(Math.hypot(...v) - spacing) < 1e-8);
        assert.ok(Math.abs(u[0] * v[0] + u[1] * v[1]) < 1e-8);
        assert.ok(Math.abs(Math.atan2(u[1], u[0]) - angle) < 1e-8);
        neighborPairs += 1;
      }
    });
    assert.ok(neighborPairs > 10);
    assert.ok(dots.some(({ x }) => x < 0) && dots.some(({ x }) => x > width));
    assert.ok(dots.some(({ y }) => y < 0) && dots.some(({ y }) => y > height));
  }
});

test('explicit grid spacing is preserved and a supplied small radius still closes the outer grid', () => {
  const svg = createHalftoneSVG({ width: 390, height: 844, spacing: 24 });
  assert.ok(svg.includes('data-dot-spacing="24"'));
  assert.ok(svg.includes('data-max-radius="18"'));
  assert.ok(svg.includes('data-feather-width="120"'));
  const dots = generateTiltedGridDots({ width: 1440, height: 900, spacing: 40, maxRadius: 1 });
  assert.equal(Math.max(...dots.map(({ radius }) => radius)), 40 / Math.SQRT2 + 0.5);
  const byIndex = new Map(dots.map((dot) => [`${dot.gridX},${dot.gridY}`, dot]));
  const start = dots.find(({ gridX, gridY }) => byIndex.has(`${gridX + 1},${gridY}`));
  const next = byIndex.get(`${start.gridX + 1},${start.gridY}`);
  assert.ok(Math.abs(Math.hypot(next.x - start.x, next.y - start.y) - 40) < 1e-8);
});

test('only the square lattice rotates while the ellipse size field remains horizontal', () => {
  for (const [width, height] of halftoneViewports) {
    const spacing = defaultDotSpacing(width, height);
    const dots = generateTiltedGridDots({ width, height });
    let differsFromRotatedEllipse = 0;
    dots.forEach((dot) => {
      const horizontalRho = Math.hypot((dot.x - width / 2) / (width * 0.45), (dot.y - height / 2) / (height * 0.435));
      assert.ok(Math.abs(dot.edgeRho - horizontalRho) < 1e-10);
      const rotatedRho = Math.hypot(dot.gridX * spacing / (width * 0.45), dot.gridY * spacing / (height * 0.435));
      if (Math.abs(horizontalRho - rotatedRho) > 0.02) differsFromRotatedEllipse += 1;
    });
    assert.ok(differsFromRotatedEllipse > 10);
    assert.ok(dots.length < 3000);
  }
});

test('dot radius and opacity grow together across a physical smooth feather and become solid outside the ellipse', () => {
  for (const [width, height] of halftoneViewports) {
    const spacing = defaultDotSpacing(width, height);
    const maximum = spacing * 0.75;
    const minimumAxis = Math.min(width * 0.45, height * 0.435);
    const dots = generateTiltedGridDots({ width, height });
    const ordered = [...dots].sort((a, b) => a.edgeRho - b.edgeRho);
    for (let index = 1; index < ordered.length; index += 1) {
      assert.ok(ordered[index].radius + 1e-9 >= ordered[index - 1].radius);
      assert.ok(ordered[index].alpha + 1e-9 >= ordered[index - 1].alpha);
    }
    dots.forEach(({ edgeRho, radius, alpha, progress, inwardDistance, featherWidth }) => {
      assert.equal(featherWidth, spacing * 5);
      assert.ok(Math.abs(inwardDistance - (1 - edgeRho) * minimumAxis) < 1e-10);
      assert.ok(Math.abs(progress - Math.max(0, Math.min(1, 1 - inwardDistance / featherWidth))) < 1e-10);
      assert.ok(Math.abs(alpha - progress * progress * (3 - 2 * progress)) < 1e-10);
      assert.ok(Math.abs(radius - maximum * alpha) < 1e-10);
      assert.ok(radius >= 0.18 && inwardDistance < featherWidth);
    });
    assert.ok(dots.some(({ edgeRho }) => edgeRho < 0.78));
    assert.ok(dots.filter(({ edgeRho }) => edgeRho >= 1).every(({ radius, alpha }) => radius === maximum && alpha === 1));
    assert.ok(dots.some(({ alpha }) => alpha === 1));
    assert.ok(dots.every(({ x, y, radius }) => Math.hypot(x - width / 2, y - height / 2) > radius));
  }
});

test('small discernible dots to plane-covering circles span at least three actual grid steps', () => {
  const inverseSmoothstep = (value) => {
    let low = 0;
    let high = 1;
    for (let index = 0; index < 60; index += 1) {
      const middle = (low + high) / 2;
      if (middle * middle * (3 - 2 * middle) < value) low = middle;
      else high = middle;
    }
    return (low + high) / 2;
  };
  for (const [width, height] of halftoneViewports) {
    const spacing = defaultDotSpacing(width, height);
    const maximum = spacing * 0.75;
    const physicalTransition = 5 * spacing * (inverseSmoothstep(spacing / Math.SQRT2 / maximum) - inverseSmoothstep(0.1 * spacing / maximum));
    assert.ok(physicalTransition >= 3 * spacing);
    const rows = new Map();
    generateTiltedGridDots({ width, height }).forEach((dot) => {
      if (!rows.has(dot.gridY)) rows.set(dot.gridY, []);
      rows.get(dot.gridY).push(dot);
    });
    const transitions = [];
    rows.forEach((row) => {
      const small = row.filter(({ radius }) => radius <= 0.1 * spacing);
      const covering = row.filter(({ radius }) => radius >= spacing / Math.SQRT2);
      small.forEach((start) => covering.forEach((end) => {
        if (end.gridX > start.gridX) transitions.push(end.gridX - start.gridX);
      }));
    });
    assert.ok(transitions.length > 5);
    assert.ok(Math.min(...transitions) >= 3);
  }
});

test('circular dot footprints leave the physical inner ellipse fully clear', () => {
  for (const [width, height] of halftoneViewports) {
    const dots = svgDots(createHalftoneSVG({ width, height }));
    const axisX = width * 0.45;
    const axisY = height * 0.435;
    const minimumAxis = Math.min(axisX, axisY);
    const safeRho = 1 - defaultDotSpacing(width, height) * 5 / minimumAxis - 0.0001;
    dots.forEach(({ x, y, radius }) => {
      const centerRho = Math.hypot((x - width / 2) / axisX, (y - height / 2) / axisY);
      // Normalized ellipse distance is 1/minimumAxis-Lipschitz. This bounds the
      // entire rendered circle, rather than checking its center alone.
      assert.ok(centerRho - radius / minimumAxis >= safeRho);
    });
    assert.ok(safeRho > 0.44);
    assert.ok(!dots.some(({ x, y, radius }) => Math.hypot(x - width / 2, y - height / 2) <= radius));
  }
});

test('fully opaque outer circles cover all four viewport edges without clipped triangles', () => {
  for (const [width, height] of halftoneViewports) {
    const dots = svgDots(createHalftoneSVG({ width, height })).filter(({ alpha }) => alpha === 1);
    const covered = (x, y) => dots.some((dot) => (dot.x - x) ** 2 + (dot.y - y) ** 2 <= dot.radius ** 2);
    const depths = Math.min(width, height) <= 600 ? [0] : [0, 10, 20];
    for (const depth of depths) {
      for (let x = 0; x <= width; x += 4) {
        assert.ok(covered(x, depth));
        assert.ok(covered(x, height - depth));
      }
      for (let y = 0; y <= height; y += 4) {
        assert.ok(covered(depth, y));
        assert.ok(covered(width - depth, y));
      }
      assert.ok(covered(width - depth, height - depth));
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
