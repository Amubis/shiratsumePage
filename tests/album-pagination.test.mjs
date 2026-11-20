import test from 'node:test';
import assert from 'node:assert/strict';
import { paginateAlbumGroup } from '../src/album-pagination.js';

const pictures = (count, ratios = [9 / 16]) => Array.from({ length: count }, (_, index) => ({ id: `p${index}`, width: ratios[index % ratios.length] * 1600, height: 1600 }));
const dimensions = { width: 1450, height: 650 };

test('portrait-heavy months borrow consecutive photos beyond the old eight-photo cutoff', () => {
  const records = pictures(24, [9 / 16, 9 / 16, 9 / 16, 16 / 9]);
  const pages = paginateAlbumGroup(records, dimensions);
  assert.ok(pages[0].length > 8);
  assert.ok(pages.every(page => page.length <= 12));
  assert.deepEqual(pages.flat(), records);
});

test('aspect mix and actual presentation area influence page capacity', () => {
  const portrait = paginateAlbumGroup(pictures(36), dimensions);
  const landscape = paginateAlbumGroup(pictures(36, [16 / 9]), dimensions);
  const narrow = paginateAlbumGroup(pictures(36), { width: 680, height: 650 });
  assert.ok(portrait[0].length > landscape[0].length);
  assert.ok(portrait[0].length > narrow[0].length);
});

test('a popular large print can move the chronological tail to the following sheet', () => {
  const records = pictures(24, [16 / 9]);
  const ordinary = paginateAlbumGroup(records, dimensions);
  const popular = paginateAlbumGroup(records, { ...dimensions, likes: { p0: 1000, p1: 1000 } });
  assert.ok(popular[0].length < ordinary[0].length);
  assert.deepEqual(popular.flat(), records);
  assert.deepEqual(paginateAlbumGroup(records, { ...dimensions, likes: new Map([['p0', 1000], ['p1', 1000]]) }), popular);
});

test('unknown dimensions and mobile retain bounded readable pages', () => {
  const records = pictures(30);
  for (const options of [{}, { ...dimensions, mobile: true }]) {
    assert.deepEqual(paginateAlbumGroup(records, options).map(page => page.length), [8, 8, 8, 6]);
    assert.deepEqual(paginateAlbumGroup(records, { ...options, view: 'year' }).map(page => page.length), [12, 12, 6]);
  }
});

test('small tails are balanced without duplicating, dropping or reordering records', () => {
  for (const count of [1, 4, 13, 25, 101]) {
    const records = pictures(count);
    const pages = paginateAlbumGroup(records, dimensions);
    assert.deepEqual(pages.flat(), records);
    assert.ok(pages.every(page => page.length > 0 && page.length <= 12));
    if (count === 13) assert.ok(pages.at(-1).length >= 4);
  }
});

test('year density has its own finite upper limit and pagination is deterministic', () => {
  const records = pictures(65);
  const options = { ...dimensions, view: 'year' };
  const pages = paginateAlbumGroup(records, options);
  assert.ok(pages[0].length > paginateAlbumGroup(records, dimensions)[0].length);
  assert.ok(pages.every(page => page.length <= 18));
  assert.deepEqual(pages.flat(), records);
  assert.deepEqual(paginateAlbumGroup(records, options), pages);
  assert.deepEqual(paginateAlbumGroup([], options), []);
});
