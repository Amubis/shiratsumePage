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
    const plan = planAlbumLayout({ aspects: Array(count).fill(9 / 16), width: 1000, height: 580, view: 'month' });
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
  const plan = planAlbumLayout({ aspects: Array(12).fill(16 / 9), width: 1000, height: 580, view: 'year' });
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
      const options = { aspects, width, height, mobile, view: count > 8 ? 'year' : 'month' };
      const plan = planAlbumLayout(options);
      assert.deepEqual(planAlbumLayout(options), plan);
      assert.equal(plan.items.length, count);
      assertContained(plan);
    }
  }
});

test('eight mostly portrait prints use the sheet height instead of a single narrow strip', () => {
  for (const aspects of [Array(8).fill(9 / 16), [9 / 16, 9 / 16, 9 / 16, 16 / 9, 9 / 16, 9 / 16, 9 / 16, 9 / 16]]) {
    const plan = planAlbumLayout({ aspects, width: 1450, height: 650 });
    assert.equal(plan.items.length, 8);
    assert.equal(plan.rowCount, 2);
    const top = Math.min(...plan.items.map(item => item.y));
    const bottom = Math.max(...plan.items.map(item => item.y + item.height));
    assert.ok(bottom - top > 650 * .72, 'use both the upper and lower part of the interaction area');
    assert.ok(plan.items.every(item => item.imageHeight > 170));
    assertContained(plan);
  }
});

test('mixed rows can share a tall side print without isolating it across a large central gap', () => {
  const aspects = [9 / 16, 9 / 16, 9 / 16, 16 / 9, 9 / 16, 9 / 16, 9 / 16, 9 / 16];
  const plan = planAlbumLayout({ aspects, width: 1450, height: 650 });
  assert.equal(plan.kind, 'feature-left');
  const feature = plan.items.find(item => item.featured);
  assert.ok(feature.height > Math.max(...plan.items.filter(item => !item.featured).map(item => item.height)) * 1.3);
  assert.ok(feature.z < 0, 'supporting oversized print sits behind the other papers');
  for (const row of plan.rows) assert.ok(Math.abs(row.x - (feature.x + feature.width)) < feature.width * .4);
  for (const item of plan.items) {
    const imageWidth = item.width - plan.paper.left - plan.paper.right;
    assert.ok(Math.abs(imageWidth / item.imageHeight - aspects[item.index]) < .00001);
  }
  assertContained(plan);
});

test('popular photographs gain bounded size and foreground depth without changing item order', () => {
  const options = { aspects: Array(8).fill(16 / 9), width: 1450, height: 650 };
  const ordinary = planAlbumLayout(options);
  const popular = planAlbumLayout({ ...options, likes: [1000] });
  assert.ok(popular.items[0].height > ordinary.items[0].height * 1.1);
  assert.ok(popular.items[0].height > popular.items[1].height);
  assert.ok(popular.items[0].z >= 12 && popular.items[0].z <= 38);
  assert.deepEqual(popular.items.map(item => item.index), ordinary.items.map(item => item.index));
  assertContained(popular);
  const extreme = planAlbumLayout({ ...options, likes: [Number.MAX_SAFE_INTEGER] });
  assert.deepEqual(extreme, popular, 'popularity saturates instead of producing an unbounded photograph');
});

test('a handful of votes remains a subtle accent, and a tall featured portrait can still grow', () => {
  const options = { aspects: [9 / 16, 9 / 16, 9 / 16, 16 / 9, 9 / 16, 9 / 16, 9 / 16, 9 / 16], width: 1450, height: 650 };
  const ordinary = planAlbumLayout(options), oneVote = planAlbumLayout({ ...options, likes: [1] }), popular = planAlbumLayout({ ...options, likes: [1000] });
  assert.ok(oneVote.items[0].height < ordinary.items[0].height * 1.02);
  assert.ok(popular.items[0].height > ordinary.items[0].height * 1.1);
  assert.ok(popular.items[0].z >= 25);
  assertContained(popular);
});

test('landscape-heavy groups stay close to their side portrait on either side of the sheet', () => {
  const sequence = [9 / 16, 16 / 9, 16 / 9, 16 / 9, 16 / 9, 16 / 9, 16 / 9, 9 / 16, 16 / 9, 16 / 9, 16 / 9, 16 / 9];
  const paper = { left: 9, right: 9, top: 9, bottom: 41 };
  for (const [width, height] of [[900, 480], [1240, 590], [1450, 650]]) for (const mirrored of [false, true]) {
    const aspects = mirrored ? sequence.toReversed() : sequence;
    const plan = planAlbumLayout({ aspects, width, height, paper });
    assert.equal(plan.kind, mirrored ? 'feature-right' : 'feature-left');
    const support = plan.items.find(item => item.featured);
    const rows = plan.rows.map(row => row.indices.map(index => plan.items[index]));
    const gaps = rows.map(items => mirrored
      ? support.x - Math.max(...items.map(item => item.x + item.width))
      : Math.min(...items.map(item => item.x)) - support.x - support.width);
    assert.ok(Math.min(...gaps) >= 13.9, 'support and foreground paper remain distinct');
    assert.ok(Math.max(...gaps) <= 36, 'conservative tilt envelopes must not isolate the supporting photograph');
    const area = plan.items.reduce((sum, item) => sum + item.imageHeight ** 2 * aspects[item.index], 0);
    const center = plan.items.reduce((sum, item) => sum + (item.x + item.width / 2) * item.imageHeight ** 2 * aspects[item.index], 0) / area;
    assert.ok(Math.abs(center - width / 2) <= width * .045 + .01, 'the actual image area stays visually balanced');
    assert.deepEqual(plan.items.map(item => item.index), aspects.map((_, index) => index));
    for (const item of plan.items) assert.ok(Math.abs((item.width - paper.left - paper.right) / item.imageHeight - aspects[item.index]) < .00001);
    assertContained(plan);
  }
});

test('ordinary rows retain their centered alignment instead of receiving side-feature corrections', () => {
  for (const mobile of [false, true]) {
    const plan = planAlbumLayout({ aspects: Array(12).fill(16 / 9), width: mobile ? 340 : 1450, height: 650, mobile });
    assert.equal(plan.kind, 'rows');
    for (const row of plan.rows) assert.ok(Math.abs(row.x + row.width / 2 - plan.width / 2) < .00001);
    assertContained(plan);
  }
});

test('narrow mobile rows grow separately so a portrait footer stays readable beside landscapes', () => {
  const paper = { left: 6, right: 6, top: 6, bottom: 43 };
  for (const width of [211, 220, 270]) for (const aspects of [[9 / 16, 16 / 9], Array.from({ length: 8 }, (_, index) => index % 2 ? .4 : 3)]) {
    const plan = planAlbumLayout({ aspects, width, height: 504, mobile: true, paper });
    assert.equal(plan.items.length, aspects.length);
    assert.ok(plan.items.every(item => item.width >= 79.99), 'keep room for the unchanged heart and multi-digit count');
    assert.ok(plan.items.filter(item => aspects[item.index] < 1).every(item => item.imageHeight >= 100));
    assert.ok(plan.rowCount > Math.ceil(aspects.length / 2), 'break mixed rows instead of shrinking the portrait');
    if (aspects.length === 8) assert.ok(plan.height > 504, 'allow native vertical scrolling');
    for (const item of plan.items) assert.ok(Math.abs((item.width - paper.left - paper.right) / item.imageHeight - aspects[item.index]) < .00001);
    assertContained(plan);
  }
});

test('extreme mobile aspect ratios use a single-print physical fit rather than an impossible minimum', () => {
  const plan = planAlbumLayout({ aspects: [.05, 12, .1], width: 211, height: 504, mobile: true, paper: { left: 6, right: 6, top: 6, bottom: 43 } });
  assert.equal(plan.items.length, 3);
  assertContained(plan);
});
