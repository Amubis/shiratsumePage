const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** A few votes are a small accent; sustained interest earns a bounded boost. */
export function albumPhotoProminence(value = 0) {
  const count = Math.max(0, finite(value, 0));
  return 1 + .55 * clamp(Math.log1p(count / 12) / Math.log1p(1000 / 12), 0, 1);
}

/**
 * Compare complete row compositions rather than binary-searching across row
 * count changes (that feasibility curve is not monotonic). A tall edge print
 * may support the remaining rows, so a mixed page need not leave a large hole.
 * All positions are stable resting paper rectangles, before the existing tilt.
 */
export function planAlbumLayout({ aspects = [], likes = [], width = 1000, height = 600, mobile = false, view = 'month', paper = {} } = {}) {
  const ratios = (Array.isArray(aspects) ? aspects : []).map(value => { const ratio = finite(value, 16 / 9); return ratio > 0 ? ratio : 16 / 9; });
  const counts = ratios.map((_, index) => Math.max(0, finite(likes[index], 0)));
  const stageWidth = Math.max(0, finite(width, 0)), stageHeight = Math.max(0, finite(height, 0));
  const defaults = mobile ? { left: 5, right: 5, top: 5, bottom: 20 } : { left: 8, right: 8, top: 8, bottom: 25 };
  const border = Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, Math.max(0, finite(paper[key], fallback))]));
  const horizontalBorder = border.left + border.right, verticalBorder = border.top + border.bottom;
  const paddingX = Math.min(stageWidth * .035, mobile ? 12 : 24), paddingY = mobile ? 10 : Math.min(stageHeight * .035, 18);
  const availableWidth = Math.max(0, stageWidth - paddingX * 2), availableHeight = Math.max(0, stageHeight - paddingY * 2);
  const density = clamp((ratios.length - 5) / 9, 0, 1);
  const gapX = mobile ? 6 : 10 - density * 30, gapY = mobile ? 14 : 14 - density * 30;
  const jitter = ratios.length < 5 ? .03 : ratios.length < 8 ? .05 : .07;
  const angle = 5.5 * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
  const empty = { width: stageWidth, height: mobile ? 0 : stageHeight, photoHeight: 0, imageHeight: 0, rowCount: 0, rows: [], items: [], padding: { x: paddingX, y: paddingY }, gapX, gapY, paper: border, score: 0, coverage: 0, minimumImageHeight: 0, kind: 'rows' };
  if (!ratios.length || availableWidth <= horizontalBorder || (!mobile && availableHeight <= verticalBorder)) return empty;
  const factors = counts.map(albumPhotoProminence);
  const indices = ratios.map((_, index) => index);
  function envelope(index, imageHeight) {
    const h = imageHeight * factors[index], w = h * ratios[index] + horizontalBorder, height = h + verticalBorder;
    return { width: w, height, imageHeight: h,
      outerWidth: 1.1 * (w * cosine + height * sine) + 2 * jitter * w,
      outerHeight: 1.1 * (height * cosine + w * sine) + 2 * jitter * height };
  }

  function measureRows(list, areaWidth, imageHeight, rowCount, maxPerRow = list.length, materialize = true) {
    const groups = Array.from({ length: list.length }, () => []);
    const totalWeight = list.reduce((sum, index) => sum + ratios[index] * factors[index], 0);
    for (let start = 0; start < list.length; start++) {
      let rowWeight = 0;
      for (let end = start + 1; end <= Math.min(list.length, start + maxPerRow); end++) {
        const index = list[end - 1];
        rowWeight += ratios[index] * factors[index];
        const rowFactor = !mobile && ratios.length >= 6 ? clamp(Math.sqrt(totalWeight / rowCount / rowWeight), .84, 1.22) : 1;
        let offset = 0, left = Infinity, right = -Infinity, height = 0, extraY = 0;
        for (let slot = start; slot < end; slot++) {
          const index = list[slot], h = imageHeight * rowFactor * factors[index];
          const w = h * ratios[index] + horizontalBorder, paperHeight = h + verticalBorder;
          const outerWidth = 1.1 * (w * cosine + paperHeight * sine) + 2 * jitter * w;
          const outerHeight = 1.1 * (paperHeight * cosine + w * sine) + 2 * jitter * paperHeight;
          left = Math.min(left, offset - (outerWidth - w) / 2);
          right = Math.max(right, offset + w + (outerWidth - w) / 2);
          height = Math.max(height, paperHeight); extraY = Math.max(extraY, outerHeight - paperHeight);
          offset += w + gapX;
        }
        const outerWidth = right - left;
        if (outerWidth <= areaWidth + .001) groups[start].push({ start, end, width: outerWidth, height, left, rowFactor, extraY });
      }
    }
    const best = Array.from({ length: rowCount + 1 }, () => []);
    best[0][0] = { cost: 0, height: 0, groups: [] };
    for (let row = 1; row <= rowCount; row++) for (let start = row - 1; start < list.length; start++) {
      const previous = best[row - 1][start];
      if (!previous) continue;
      for (const group of groups[start]) {
        const height = previous.height + group.height + (row > 1 ? gapY : 0);
        // Height is the feasibility objective. Width balance breaks near ties.
        const cost = previous.cost + group.height + (row > 1 ? gapY : 0) + (1 - group.width / areaWidth) ** 2 * 12;
        const saved = best[row][group.end];
        if (!saved || cost < saved.cost) best[row][group.end] = { cost, height, groups: [...previous.groups, group] };
      }
    }
    const selected = best[rowCount][list.length];
    if (!selected) return null;
    if (materialize) for (const group of selected.groups) group.boxes = list.slice(group.start, group.end).map(index => envelope(index, imageHeight * group.rowFactor));
    const boxes = materialize ? selected.groups.flatMap(group => group.boxes) : [];
    const extraY = Math.max(0, ...selected.groups.map(group => group.extraY));
    return { ...selected, height: selected.height + extraY, extraY, boxes, list, imageHeight };
  }
  function bestRows(list, areaWidth, areaHeight, { grow = false, minRows = 1, maxRows = 4 } = {}) {
    let chosen = null;
    const max = Math.min(list.length, grow ? list.length : maxRows);
    for (let rows = minRows; rows <= max; rows++) {
      if (grow && rows < Math.ceil(list.length / 2)) continue;
      let low = 0, high = grow ? clamp(stageWidth * .48, 105, 210) * (view === 'year' ? .86 : 1) : areaHeight;
      for (let step = 0; step < 23; step++) {
        const value = (low + high) / 2, plan = measureRows(list, areaWidth, value, rows, grow ? 2 : list.length, false);
        if (plan && (grow || plan.height <= areaHeight)) low = value; else high = value;
      }
      const plan = measureRows(list, areaWidth, Math.max(0, low - .002), rows, grow ? 2 : list.length);
      if (!plan || plan.imageHeight <= 0) continue;
      const area = plan.boxes.reduce((sum, box, i) => sum + box.imageHeight ** 2 * ratios[list[i]], 0);
      const widths = plan.groups.map(group => group.width / areaWidth);
      // Image area rewards readable prints; envelope coverage prevents a narrow
      // centred strip winning merely because it contains one large landscape.
      const score = grow ? plan.imageHeight / 210 - rows * .14 : area / (areaWidth * areaHeight) + Math.min(1, plan.height / areaHeight) * .6 + Math.min(...widths) * .15;
      if (!chosen || score > chosen.score) chosen = { ...plan, score, area };
    }
    return chosen;
  }
  function placeRows(plan, left, top, areaWidth, areaHeight, rowOffset = 0, alignment = 'center') {
    const items = [], rows = [];
    let y = top + Math.max(0, areaHeight - plan.height) * .45 + plan.extraY / 2;
    for (const [rowIndex, group] of plan.groups.entries()) {
      const count = group.end - group.start;
      // Spread within a generous row, but do not return to landscape-sized cells.
      const extraGap = mobile || count < 2 ? 0 : Math.min(Math.max(0, areaWidth - group.width) / (count - 1), plan.imageHeight * .18);
      const usedWidth = group.width + extraGap * (count - 1);
      const rowLeft = left + (alignment === 'start' ? 0 : alignment === 'end' ? areaWidth - usedWidth : (areaWidth - usedWidth) / 2);
      let x = rowLeft - group.left;
      const rowIndices = [];
      for (let slot = group.start; slot < group.end; slot++) {
        const index = plan.list[slot], box = group.boxes[slot - group.start];
        const itemY = y + (group.height - box.height) / 2;
        items.push({ index, row: rowOffset + rowIndex, x, y: itemY, width: box.width, height: box.height, imageHeight: box.imageHeight, z: counts[index] >= 20 ? 12 + Math.round((factors[index] - 1) * 24) : Math.round((factors[index] - 1) * 12), featured: false });
        rowIndices.push(index); x += box.width + gapX + extraGap;
      }
      rows.push({ indices: rowIndices, x: rowLeft, y, width: usedWidth, height: group.height, gap: gapX + extraGap });
      y += group.height + gapY;
    }
    return { items, rows };
  }

  const regular = bestRows(indices, availableWidth, availableHeight, { grow: mobile });
  if (!regular) return empty;
  let actualHeight = mobile ? regular.height + paddingY * 2 : stageHeight;
  let placed = placeRows(regular, paddingX, paddingY, availableWidth, mobile ? regular.height : availableHeight);
  let selected = { ...regular, ...placed, kind: 'rows', referenceHeight: regular.imageHeight };
  if (!mobile && ratios.length >= 6 && availableWidth / availableHeight > 1.2) {
    const mostLiked = counts.reduce((best, value, index) => value > counts[best] ? index : best, 0);
    const candidates = new Set([0, ratios.length - 1]);
    if (counts[mostLiked] >= 20) candidates.add(mostLiked);
    for (const featureIndex of candidates) {
      if (ratios[featureIndex] > .9) continue;
      const featureFraction = .88 + .12 * (factors[featureIndex] - 1) / .55;
      const featureBaseHeight = availableHeight * featureFraction / (1.1 + jitter * 2 + ratios[featureIndex] * sine * 1.1) - verticalBorder;
      const feature = envelope(featureIndex, featureBaseHeight / factors[featureIndex]);
      const columnWidth = feature.outerWidth;
      const overlap = Math.min(24, columnWidth * .06);
      const remainingWidth = availableWidth - columnWidth + overlap;
      if (remainingWidth < availableWidth * .5) continue;
      const list = indices.filter(index => index !== featureIndex);
      const rest = bestRows(list, remainingWidth, availableHeight, { minRows: 2, maxRows: 3 });
      if (!rest) continue;
      const featureArea = feature.imageHeight ** 2 * ratios[featureIndex];
      const area = rest.area + featureArea;
      const combinedWidth = Math.min(...rest.groups.map(group => (columnWidth + group.width) / availableWidth));
      const score = area / (availableWidth * availableHeight) + .6 * featureFraction + .15 * combinedWidth - .025;
      if (score <= selected.score) continue;
      const isLeft = featureIndex < ratios.length / 2;
      const featureLeft = isLeft ? paddingX : stageWidth - paddingX - columnWidth;
      const rowLeft = isLeft ? paddingX + columnWidth - overlap : paddingX;
      placed = placeRows(rest, rowLeft, paddingY, remainingWidth, availableHeight, 0, isLeft ? 'start' : 'end');
      const featureItem = { index: featureIndex, row: 0, x: featureLeft + (columnWidth - feature.width) / 2,
        y: paddingY + (availableHeight - feature.height) / 2, width: feature.width, height: feature.height, imageHeight: feature.imageHeight,
        z: counts[featureIndex] >= 20 ? Math.min(38, 25 + Math.round((factors[featureIndex] - 1) * 24)) : -12, featured: true };
      selected = { ...rest, ...placed, items: [...placed.items, featureItem], score, area, kind: isLeft ? 'feature-left' : 'feature-right', referenceHeight: rest.imageHeight };
    }
  }
  selected.items.sort((a, b) => a.index - b.index);
  return { ...empty, height: actualHeight, photoHeight: selected.referenceHeight + verticalBorder,
    imageHeight: selected.referenceHeight, rowCount: selected.rows.length, rows: selected.rows, items: selected.items,
    score: selected.score, coverage: selected.area / (availableWidth * (mobile ? regular.height : availableHeight)),
    minimumImageHeight: Math.min(...selected.items.map(item => item.imageHeight)), kind: selected.kind };
}
