import { albumPhotoProminence, planAlbumLayout } from './album-layout.js';

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const aspectOf = item => {
  const width = finite(item?.width, 0), height = finite(item?.height, 0);
  return width > 0 && height > 0 ? width / height : 16 / 9;
};
const likesOf = (item, likes) => Math.max(0, finite(likes instanceof Map ? likes.get(item.id) : likes?.[item.id], finite(item?.likeCount, 0)));

/**
 * Paginate ONE already sorted month/year. Capacity measures the real sheet,
 * image ratios and bounded popularity footprint, rather than fixed chunks.
 * The caller owns period boundaries and chronological sorting; this function
 * only moves a consecutive tail forward and never borrows across a period.
 */
export function paginateAlbumGroup(items = [], { width = 0, height = 0, mobile = false, view = 'month', paper = {}, likes = {} } = {}) {
  if (!Array.isArray(items) || !items.length) return [];
  const base = view === 'year' ? 12 : 8;
  const w = Math.max(0, finite(width, 0)), h = Math.max(0, finite(height, 0));
  if (mobile || w < 120 || h < 120) {
    return Array.from({ length: Math.ceil(items.length / base) }, (_, index) => items.slice(index * base, (index + 1) * base));
  }
  const limit = view === 'year' ? 18 : 12;
  const targetHeight = clamp(h * (view === 'year' ? .29 : .36), 100, view === 'year' ? 230 : 310);
  const budget = w * h * .85 / (targetHeight * targetHeight);
  // Include the white frame so many narrow portraits do not become free space.
  const weights = items.map(item => (clamp(aspectOf(item), .25, 3.2) + .10) * albumPhotoProminence(likesOf(item, likes)) ** 2);
  const pages = [];
  let offset = 0;
  while (offset < items.length) {
    let count = 0, weight = 0;
    const remaining = items.length - offset;
    while (count < Math.min(limit, remaining)) {
      const next = weights[offset + count];
      if (count >= 3 && weight + next > budget) break;
      weight += next; count++;
    }
    count = Math.max(1, count);
    // Avoid one or two orphaned prints after a generously filled sheet. This
    // only moves the chronological tail; a short period itself remains short.
    const tail = remaining - count;
    const minimumTail = view === 'year' ? 5 : 4;
    if (tail > 0 && tail < minimumTail && count >= minimumTail + 2) count -= minimumTail - tail;
    // The area estimate is cheap for long archives. Check the selected actual
    // composition and trim only when a panorama/hero makes ordinary prints tiny.
    for (let attempt = 0; attempt < 3 && count > 3; attempt++) {
      const batch = items.slice(offset, offset + count);
      const plan = planAlbumLayout({ aspects: batch.map(aspectOf), likes: batch.map(item => likesOf(item, likes)), width: w, height: h, view, paper });
      if (plan.items.length === count && plan.minimumImageHeight >= targetHeight * .72) break;
      count--;
    }
    pages.push(items.slice(offset, offset + count));
    offset += count;
  }
  return pages;
}
