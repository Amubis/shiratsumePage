import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTransform, shapeMatrix, projectShape, maskSvg, syncCloneAnimations, isShapeVisible } from '../src/contrast.js';
import { CLOVER_PATH, SMALL_CLOVER_PATH } from '../src/scene.js';

const close = (actual, expected) => actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-8, `component ${index}: ${value} ≠ ${expected[index]}`));
const point = ([a, b, c, d, e, f], x, y) => [a * x + c * y + e, b * x + d * y + f];

test('a translated, nonsquare clover keeps its actual path aspect ratio inside the text mask', () => {
  const shape = { width: 200, height: 100, rect: { left: 320, top: 180, width: 200, height: 100 }, transform: 'matrix(1, 0, 0, 1, -100, -50)', transformOrigin: '50% 50%', variant: 'small' };
  close(shapeMatrix(shape), [1, 0, 0, 1, 320, 180]);
  const projected = projectShape(shape, { left: 350, top: 200, width: 80, height: 40 });
  assert.equal(projected.path, SMALL_CLOVER_PATH);
  close(point(projected.matrix, 50, 50), [70, 30]);
  close(point(projected.matrix, 100, 100), [170, 80]);
});

test('a quarter-turn mask follows the rotated artwork, including its off-center transform origin', () => {
  const shape = { width: 200, height: 100, rect: { left: 310, top: 80, width: 100, height: 200 }, transform: 'matrix(0, 1, -1, 0, -100, -50)', transformOrigin: '20px 35px', variant: 'large' };
  const projection = projectShape(shape, { left: 350, top: 150, width: 80, height: 60 });
  assert.equal(projection.path, CLOVER_PATH);
  close(shapeMatrix(shape), [0, 1, -1, 0, 410, 80]);
  // The upper-right point is now below the center, rather than at the box edge.
  close(point(projection.matrix, 100, 0), [60, 130]);
  close(point(projection.matrix, 50, 50), [10, 30]);
});

test('a 45-degree rotation does not stretch the clover into its axis-aligned bounding box', () => {
  const root = Math.SQRT1_2;
  const shape = { width: 100, height: 100, rect: { left: 300, top: 200, width: 100 * Math.SQRT2, height: 100 * Math.SQRT2 }, transform: [root, root, -root, root, 0, 0], transformOrigin: '50% 50%' };
  const projection = projectShape(shape, { left: 320, top: 230, width: 100, height: 60 });
  close(point(projection.matrix, 0, 0), [50 * Math.SQRT2 - 20, -30]);
  close(point(projection.matrix, 100, 0), [100 * Math.SQRT2 - 20, 50 * Math.SQRT2 - 30]);
  close(point(projection.matrix, 0, 100), [-20, 50 * Math.SQRT2 - 30]);
});

test('nonuniform scale, skew, and a translated ancestor all remain in the projection', () => {
  const shape = { width: 160, height: 80, rect: { left: 70, top: 110, width: 260, height: 140 }, transform: 'matrix(1.5, 0.5, -0.25, 0.75, 36, -19)', transformOrigin: '25% 80%' };
  const projection = projectShape(shape, { left: 100, top: 120, width: 180, height: 100 });
  close(projection.matrix, [2.4, 0.8, -0.2, 0.6, -10, -10]);
  close(point(projection.matrix, 100, 0), [230, 70]);
  close(point(projection.matrix, 0, 100), [-30, 50]);
});

test('touching edges and zero-area targets need no white overlay; overlapping paths do', () => {
  const shape = { width: 100, height: 100, rect: { left: 100, top: 100, width: 100, height: 100 } };
  assert.equal(projectShape(shape, { left: 200, top: 120, width: 20, height: 20 }), null);
  assert.equal(projectShape(shape, { left: 110, top: 110, width: 0, height: 20 }), null);
  assert.equal(projectShape(shape, { left: 0, top: 0, width: 50, height: 50 }), null);
  assert.ok(projectShape(shape, { left: 199, top: 120, width: 20, height: 20 }));
});

test('CSS matrix3d uses the same 2D coefficients and alpha masks have a transparent background', () => {
  close(parseTransform('matrix3d(0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 80, 90, 0, 1)'), [0, 1, -1, 0, 80, 90]);
  const svg = maskSvg(80, 40, [{ path: SMALL_CLOVER_PATH, matrix: [1, 0, 0, 1, -10, 5] }]);
  assert.ok(svg.includes('viewBox="0 0 80 40"'));
  assert.ok(svg.includes(`fill="white" d="${SMALL_CLOVER_PATH}"`));
  assert.ok(svg.includes('transform="matrix(1 0 0 1 -10 5)"'));
  assert.ok(!svg.includes('<rect'));
  assert.ok(!svg.includes('black'));
  assert.equal((svg.match(/<path/g) || []).length, 1);
  assert.ok(!maskSvg(80, 40, []).includes('<path'));
});

test('an animated arrow clone resumes the source phase rather than restarting after refresh', () => {
  const arrow = { animationName: 'arrowNudge', currentTime: 725, startTime: 1200, playbackRate: 0.8, playState: 'running' };
  const fade = { animationName: 'fade', currentTime: 170, startTime: 1755, playbackRate: 1, playState: 'running' };
  const savedSource = { ...arrow };
  const clonedArrow = { animationName: 'arrowNudge', currentTime: 0, startTime: 1925, playbackRate: 1 };
  const clonedFade = { animationName: 'fade', currentTime: 0, startTime: 1925, playbackRate: 1 };
  let sourceReads = 0;
  let copyReads = 0;
  const source = { getAnimations(...args) { assert.equal(args.length, 0); sourceReads++; return [arrow, fade]; } };
  // An engine can return effects in another order; names establish the pairing.
  const clone = { getAnimations(...args) { assert.equal(args.length, 0); copyReads++; return [clonedFade, clonedArrow]; } };
  syncCloneAnimations([[source, clone]]);
  assert.equal(clonedArrow.currentTime, 725);
  assert.equal(clonedArrow.startTime, 1200);
  assert.equal(clonedArrow.playbackRate, 0.8);
  assert.equal(clonedFade.currentTime, 170);
  assert.equal(clonedFade.startTime, 1755);
  assert.deepEqual(arrow, savedSource);
  assert.equal(sourceReads, 1);
  assert.equal(copyReads, 1);
});

test('paused effects stay paused and absent/restricted animation APIs safely fall back', () => {
  let pauses = 0;
  const source = { getAnimations: () => [{ animationName: 'arrowNudge', currentTime: 420, startTime: null, playbackRate: 1, playState: 'paused' }] };
  const cloneAnimation = { animationName: 'arrowNudge', currentTime: 0, startTime: null, pause() { pauses++; } };
  // A rejected property assignment must not prevent the independent time sync.
  Object.defineProperty(cloneAnimation, 'playbackRate', { set() { throw new TypeError('read-only timeline'); } });
  assert.doesNotThrow(() => syncCloneAnimations([
    [{}, {}],
    [{ getAnimations() { throw new TypeError('unavailable'); } }, { getAnimations: () => [] }],
    [source, { getAnimations: () => [cloneAnimation] }],
  ]));
  assert.equal(pauses, 1);
  assert.equal(cloneAnimation.currentTime, 420);
  assert.equal(cloneAnimation.startTime, null);
});

test('intro-hidden clover groups cannot invert text until their ancestors become visible', () => {
  const scene = { parentElement: null };
  const group = { parentElement: scene };
  const first = { parentElement: group };
  const second = { parentElement: group };
  const styles = new Map([
    [scene, { display: 'block', visibility: 'visible', opacity: '1' }],
    [group, { display: 'block', visibility: 'visible', opacity: '0' }],
    [first, { display: 'block', visibility: 'visible', opacity: '1' }],
    [second, { display: 'block', visibility: 'visible', opacity: '1' }],
  ]);
  const reads = new Map();
  const readStyle = (node) => { reads.set(node, (reads.get(node) || 0) + 1); return styles.get(node); };
  const frameCache = new Map();
  assert.equal(isShapeVisible(first, scene, readStyle, frameCache), false);
  assert.equal(isShapeVisible(second, scene, readStyle, frameCache), false);
  assert.equal(reads.get(group), 1, 'shared ancestor styles are read once per paint');

  styles.set(group, { display: 'block', visibility: 'visible', opacity: '1' });
  assert.equal(isShapeVisible(first, scene, readStyle), true, 'next paint observes the reveal');
  styles.set(scene, { display: 'block', visibility: 'hidden', opacity: '1' });
  assert.equal(isShapeVisible(first, scene, readStyle), false, 'the scene itself is included');
  styles.set(scene, { display: 'none', visibility: 'visible', opacity: '1' });
  assert.equal(isShapeVisible(first, scene, readStyle), false);
});

test('combined low ancestor opacity delays the mask, even when every individual element is visible', () => {
  const scene = { parentElement: null };
  const wrapper = { parentElement: scene };
  const shape = { parentElement: wrapper };
  const styles = new Map([
    [scene, { opacity: '1' }],
    [wrapper, { opacity: '0.1' }],
    [shape, { opacity: '0.15' }],
  ]);
  assert.equal(isShapeVisible(shape, scene, (node) => styles.get(node)), false);
  styles.set(wrapper, { opacity: '0.5' });
  assert.equal(isShapeVisible(shape, scene, (node) => styles.get(node)), true);
});
