import test from 'node:test';
import assert from 'node:assert/strict';
import { albumNeighborOffsets } from '../src/album-neighbors.js';

const paper = (x, y, width = 200, height = 140) => ({ x, y, width, height });
const magnitude = vector => Math.hypot(vector.x, vector.y);

test('a single row pushes nearby papers away from the active center', () => {
  const offsets = albumNeighborOffsets([paper(-220, 0), paper(0, 0), paper(220, 0), paper(660, 0)], 1);
  assert.ok(offsets[0].x < 0 && offsets[2].x > 0);
  assert.equal(offsets[0].y, 0); assert.equal(offsets[2].y, 0);
  assert.deepEqual(offsets[1], { x: 0, y: 0 });
  assert.deepEqual(offsets[3], { x: 0, y: 0 });
});

test('a lower-row first paper affects the paper above instead of its remote preceding array entry', () => {
  const rectangles = [paper(0, 0), paper(220, 0), paper(440, 0), paper(0, 180), paper(220, 180), paper(440, 180)];
  const offsets = albumNeighborOffsets(rectangles, 3);
  assert.ok(offsets[0].y < 0, 'the visually adjacent upper paper moves upward');
  assert.equal(offsets[0].x, 0);
  assert.ok(offsets[4].x > 0, 'the lower-row right paper moves right');
  assert.deepEqual(offsets[2], { x: 0, y: 0 }, 'the remote last paper of the previous row is outside the ripple');
  assert.ok(offsets[1].x > 0 && offsets[1].y < 0, 'diagonal neighbors move radially');
});

test('the circular influence decreases with distance and treats both axes equally', () => {
  const offsets = albumNeighborOffsets([paper(0, 0), paper(90, 0), paper(270, 0), paper(0, 270), paper(500, 0)], 0);
  assert.ok(magnitude(offsets[1]) > magnitude(offsets[2]));
  assert.ok(magnitude(offsets[2]) > 0);
  assert.ok(Math.abs(magnitude(offsets[2]) - magnitude(offsets[3])) < 1e-10);
  assert.deepEqual(offsets[4], { x: 0, y: 0 });
});

test('visual layout determines the ripple independently of record order without mutating it', () => {
  const rectangles = [paper(0, 0), paper(220, 0), paper(0, 180), paper(220, 180)];
  const snapshot = structuredClone(rectangles);
  const original = albumNeighborOffsets(rectangles, 2);
  const order = [3, 2, 0, 1], permuted = albumNeighborOffsets(order.map(index => rectangles[index]), 1);
  order.forEach((index, nextIndex) => assert.deepEqual(permuted[nextIndex], original[index]));
  assert.deepEqual(rectangles, snapshot);
  assert.deepEqual(albumNeighborOffsets(rectangles, -1), rectangles.map(() => ({ x: 0, y: 0 })));
});
