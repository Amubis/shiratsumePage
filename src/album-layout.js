const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Pack ordered photographs at a shared image height instead of leaving narrow
 * portraits in landscape-sized cells. Rows may overlap a little on dense pages.
 * The outer envelope reserves the existing ten-percent scale, tilt and jitter;
 * the returned item boxes are the untransformed paper rectangles.
 */
export function planAlbumLayout({ aspects = [], width = 1000, height = 600, mobile = false, view = 'month', paper = {} } = {}) {
  const ratios = (Array.isArray(aspects) ? aspects : []).map(value => {
    const ratio = finite(value, 16 / 9);
    return ratio > 0 ? ratio : 16 / 9;
  });
  const stageWidth = Math.max(0, finite(width, 0));
  const stageHeight = Math.max(0, finite(height, 0));
  const defaults = mobile ? { left: 5, right: 5, top: 5, bottom: 20 } : { left: 8, right: 8, top: 8, bottom: 25 };
  const border = Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, Math.max(0, finite(paper[key], fallback))]));
  const horizontalBorder = border.left + border.right, verticalBorder = border.top + border.bottom;
  const paddingX = Math.min(stageWidth * .035, mobile ? 12 : 24), paddingY = mobile ? 10 : Math.min(stageHeight * .035, 18);
  const availableWidth = Math.max(0, stageWidth - paddingX * 2), availableHeight = Math.max(0, stageHeight - paddingY * 2);
  const density = clamp((ratios.length - 5) / 7, 0, 1);
  const gapX = mobile ? 6 : 12 - density * 24;
  const gapY = mobile ? 14 : 18 - density * 28;
  const jitter = ratios.length < 5 ? .03 : ratios.length < 8 ? .05 : .07;
  const angle = 5.5 * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
  const empty = { width: stageWidth, height: mobile ? 0 : stageHeight, photoHeight: 0, imageHeight: 0, rowCount: 0, rows: [], items: [], padding: { x: paddingX, y: paddingY }, gapX, gapY, paper: border };
  if (!ratios.length || availableWidth <= horizontalBorder || (!mobile && availableHeight <= verticalBorder)) return empty;

  function metrics(imageHeight) {
    const photoHeight = imageHeight + verticalBorder;
    const widths = ratios.map(ratio => imageHeight * ratio + horizontalBorder);
    const extraX = widths.map(photoWidth => Math.max(0, 1.1 * (photoWidth * cosine + photoHeight * sine) + 2 * jitter * photoWidth - photoWidth));
    const extraY = Math.max(...widths.map(photoWidth => Math.max(0, 1.1 * (photoHeight * cosine + photoWidth * sine) + 2 * jitter * photoHeight - photoHeight)));
    const rows = new Map();
    function row(start, end) {
      const key = `${start}:${end}`;
      if (rows.has(key)) return rows.get(key);
      let x = 0, min = Infinity, max = -Infinity;
      const offsets = [];
      for (let index = start; index < end; index++) {
        offsets.push(x); min = Math.min(min, x - extraX[index] / 2); max = Math.max(max, x + widths[index] + extraX[index] / 2);
        x += widths[index] + gapX;
      }
      const result = { start, end, min, width: max - min, offsets };
      rows.set(key, result); return result;
    }
    return { photoHeight, widths, extraY, row };
  }

  function partition(imageHeight, maxItems = ratios.length) {
    const measure = metrics(imageHeight), best = [{ count: 0, cost: 0, groups: [] }];
    for (let end = 1; end <= ratios.length; end++) {
      let chosen = null;
      for (let start = Math.max(0, end - maxItems); start < end; start++) {
        if (!best[start]) continue;
        const group = measure.row(start, end);
        if (group.width > availableWidth + .001) continue;
        const count = best[start].count + 1;
        const cost = best[start].cost + (1 - group.width / availableWidth) ** 2 + (end - start === 1 && ratios.length > 3 ? .12 : 0);
        if (!chosen || count < chosen.count || (count === chosen.count && cost < chosen.cost)) chosen = { count, cost, groups: [...best[start].groups, group] };
      }
      best[end] = chosen;
    }
    const result = best[ratios.length];
    if (!result) return null;
    return { ...result, measure, usedHeight: result.count * measure.photoHeight + (result.count - 1) * gapY + measure.extraY };
  }

  let imageHeight = 0, selected = null;
  if (!mobile) {
    let low = 0, high = Math.max(0, Math.min(availableHeight - verticalBorder, availableWidth / Math.max(...ratios)));
    for (let step = 0; step < 42; step++) {
      const middle = (low + high) / 2, candidate = partition(middle);
      if (candidate && candidate.usedHeight <= availableHeight) low = middle;
      else high = middle;
    }
    imageHeight = Math.max(0, low - .002); selected = partition(imageHeight);
  } else {
    // Narrow pages may grow vertically. Start with readable prints and compare
    // the useful two-print row breakpoints, rather than squeezing into a fixed
    // desktop height or always forcing two landscapes into tiny cells.
    const target = clamp(stageWidth * .48, 105, 210) * (view === 'year' ? .86 : 1);
    const candidates = new Set([target]);
    for (let start = 0; start < ratios.length; start++) for (let end = start + 1; end <= Math.min(ratios.length, start + 2); end++) {
      let low = 0, high = target;
      for (let step = 0; step < 32; step++) {
        const middle = (low + high) / 2;
        if (metrics(middle).row(start, end).width <= availableWidth) low = middle; else high = middle;
      }
      candidates.add(Math.max(0, low - .002));
    }
    let score = -Infinity;
    for (const value of candidates) {
      const candidate = partition(value, 2);
      if (!candidate) continue;
      const nextScore = value / target - candidate.count * .18 - candidate.cost * .035;
      if (nextScore > score) { score = nextScore; imageHeight = value; selected = candidate; }
    }
  }
  if (!selected || imageHeight <= 0) return empty;

  const actualHeight = mobile ? selected.usedHeight + paddingY * 2 : stageHeight;
  const top = paddingY + (mobile ? 0 : Math.max(0, availableHeight - selected.usedHeight) * .42) + selected.measure.extraY / 2;
  const items = [], rows = selected.groups.map((group, rowIndex) => {
    const x = paddingX + (availableWidth - group.width) / 2;
    const y = top + rowIndex * (selected.measure.photoHeight + gapY);
    const indices = [];
    for (let index = group.start; index < group.end; index++) {
      indices.push(index);
      items.push({ index, row: rowIndex, x: x - group.min + group.offsets[index - group.start], y, width: selected.measure.widths[index], height: selected.measure.photoHeight });
    }
    return { indices, x, y, width: group.width, height: selected.measure.photoHeight, gap: gapX };
  });
  return { width: stageWidth, height: actualHeight, photoHeight: selected.measure.photoHeight, imageHeight, rowCount: rows.length, rows, items, padding: { x: paddingX, y: paddingY }, gapX, gapY, paper: border };
}
