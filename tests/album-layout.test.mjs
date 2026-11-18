import test from 'node:test';
import assert from 'node:assert/strict';
import { planAlbumLayout } from '../src/album-layout.js';

function assertContained(plan) {
  assert.ok(Number.isFinite(plan.width) && Number.isFinite(plan.height));
  for (const item of plan.items) {
    assert.ok([item.x, item.y, item.width, item.height].every(Number.isFinite));
    assert.ok(item.width > 0 && item.height > 0);
    assert.ok(item.x >= 0 && item.y >= 0);
    assert.ok(item.x + item.width <= plan.width + .01);
    assert.ok(item.y + item.height <= plan.height + .01);
  }
}

test('four or five portrait prints share a compact desktop row instead of empty landscape cells', () => {
  for (const count of [4, 5]) {
    const plan = planAlbumLayout({ aspects: Array(count).fill(9 / 16), width: 1000, height: 580 });
    assert.equal(plan.rowCount, 1);
    assert.deepEqual(plan.rows[0].indices, Array.from({ length: count }, (_, index) => index));
    assert.ok(plan.photoHeight > 290, 'portraits should remain prominent');
    assert.ok(plan.rows[0].gap <= 12, 'narrow prints must not retain landscape-sized cells');
    assertContained(plan);
  }
});

test('mixed orientations retain their proportions at one shared image height', () => {
  const aspects = [16 / 9, 9 / 16, 4 / 3, 2 / 3, 16 / 9];
  const plan = planAlbumLayout({ aspects, width: 1000, height: 580 });
  assert.equal(plan.items.length, aspects.length);
  for (const item of plan.items) {
    assert.equal(item.height, plan.photoHeight);
    const imageWidth = item.width - plan.paper.left - plan.paper.right;
    assert.ok(Math.abs(imageWidth / plan.imageHeight - aspects[item.index]) < .00001);
  }
  assertContained(plan);
});

test('dense pages can overlap their paper edges while preserving every ordered photograph', () => {
  const plan = planAlbumLayout({ aspects: Array(12).fill(16 / 9), width: 1000, height: 580 });
  assert.deepEqual(plan.items.map(item => item.index), Array.from({ length: 12 }, (_, index) => index));
  assert.ok(plan.gapX < 0 && plan.gapY < 0);
  assert.ok(plan.photoHeight > 140);
  assertContained(plan);
});

test('mobile photographs stay readable and the page grows rather than squeezing into desktop height', () => {
  const plan = planAlbumLayout({ aspects: Array(5).fill(9 / 16), width: 300, height: 180, mobile: true });
  assert.ok(plan.rows.every(row => row.indices.length <= 2));
  assert.ok(plan.imageHeight >= 100);
  assert.ok(plan.height > 180);
  assertContained(plan);
});

test('real paper padding and borders are included in the calculated photograph rectangles', () => {
  const paper = { left: 9, right: 9, top: 9, bottom: 26 };
  const plan = planAlbumLayout({ aspects: [9 / 16, 16 / 9], width: 900, height: 500, paper });
  for (const item of plan.items) {
    assert.ok(Math.abs(item.height - plan.imageHeight - 35) < .00001);
    assert.ok(Math.abs(item.width - plan.imageHeight * [9 / 16, 16 / 9][item.index] - 18) < .00001);
  }
  assertContained(plan);
});

test('empty or unusably small stages return a finite empty layout', () => {
  for (const options of [{ aspects: [] }, { aspects: [1], width: 0 }, { aspects: [1], height: 0 }, { aspects: [1], width: 10 }]) {
    const plan = planAlbumLayout(options);
    assert.equal(plan.items.length, 0);
    assert.equal(plan.rowCount, 0);
    assertContained(plan);
  }
});

test('layout is deterministic and stays within compact, wide and tall presentation areas', () => {
  for (const [width, height, mobile] of [[1000, 580, false], [720, 420, false], [340, 300, true]]) {
    for (const count of [1, 3, 5, 8, 12]) {
      const aspects = Array.from({ length: count }, (_, index) => [9 / 16, 16 / 9, 1, 3][index % 4]);
      const options = { aspects, width, height, mobile };
      const plan = planAlbumLayout(options);
      assert.deepEqual(planAlbumLayout(options), plan);
      assert.equal(plan.items.length, count);
      assertContained(plan);
    }
  }
});
