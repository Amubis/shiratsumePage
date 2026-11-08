// Small artwork is a simple, rounded four-petal cross. The larger version adds
// shallow heart notches without narrowing the petals or disconnecting the core.
export const SMALL_CLOVER_PATH = 'M50 6 C64 6 70 17 65 33 C81 28 94 36 94 50 C94 64 81 72 65 67 C70 83 64 94 50 94 C36 94 30 83 35 67 C19 72 6 64 6 50 C6 36 19 28 35 33 C30 17 36 6 50 6 Z';
export const CLOVER_PATH = 'M50 10 C43 1 30 5 29 17 C28 24 34 33 39 39 C33 34 24 28 17 29 C5 30 1 43 10 50 C1 57 5 70 17 71 C24 72 33 66 39 61 C34 67 28 76 29 83 C30 95 43 99 50 90 C57 99 70 95 71 83 C72 76 66 67 61 61 C67 66 76 72 83 71 C95 70 99 57 90 50 C99 43 95 30 83 29 C76 28 67 34 61 39 C66 33 72 24 71 17 C70 5 57 1 50 10 Z';

// Percent positions and vmin sizes are shared with the screen-space text mask.
// Retained for the preview model. The primary model uses a per-visit layout.
export const SCENE_LAYOUT = Object.freeze([
  Object.freeze({ id: 'cluster-main', x: 11, y: 76, size: 54, rotation: -16, variant: 'large', colorVariant: 'theme' }),
  Object.freeze({ id: 'cluster-companion', x: 25, y: 84, size: 41, rotation: 18, variant: 'large', colorVariant: 'random' }),
  Object.freeze({ id: 'cluster-small', x: 3, y: 56, size: 22, rotation: 9, variant: 'small', colorVariant: 'theme' }),
]);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const escapeAttribute = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

/** A reproducible, non-cryptographic generator. No random work is done per frame. */
export function seededRandom(seed = 'shiratsume') {
  let state = 2166136261;
  for (const character of String(seed)) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Three asymmetric regions, with full silhouettes kept out of the title box. */
export function generateSceneLayout(seed) {
  const random = seededRandom(seed);
  const range = (minimum, maximum) => minimum + random() * (maximum - minimum);
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const sizes = [range(28, 46), range(28, 46), range(28, 38)];
    const upper = random() < 0.5;
    const candidates = [
      { id: 'scatter-left', x: range(3, 30 - sizes[0] / 2), y: range(16, 84), size: sizes[0], variant: 'large', colorVariant: 'theme' },
      { id: 'scatter-right', x: range(70 + sizes[1] / 2, 97), y: range(14, 88), size: sizes[1], variant: 'large', colorVariant: 'random' },
      { id: upper ? 'scatter-upper' : 'scatter-lower', x: range(34, 72), y: upper ? range(0, 23 - sizes[2] / 2) : range(67 + sizes[2] / 2, 99), size: sizes[2], variant: 'small', colorVariant: 'theme' },
    ];
    const spread = candidates.every((shape, index) => candidates.slice(index + 1).every((other) => Math.hypot(shape.x - other.x, shape.y - other.y) >= 38));
    if (!spread || Math.abs(candidates[0].y - candidates[1].y) < 18) continue;
    return Object.freeze(candidates.map((shape) => Object.freeze({ ...shape, rotation: range(-48, 48) })));
  }
  // A bounded deterministic fallback still obeys the same whitespace rules.
  return Object.freeze([
    Object.freeze({ id: 'scatter-left', x: 8, y: 30, size: 36, rotation: -17, variant: 'large', colorVariant: 'theme' }),
    Object.freeze({ id: 'scatter-right', x: 91, y: 78, size: 36, rotation: 23, variant: 'large', colorVariant: 'random' }),
    Object.freeze({ id: 'scatter-upper', x: 58, y: 4, size: 30, rotation: 8, variant: 'small', colorVariant: 'theme' }),
  ]);
}

/** Return hue in degrees and saturation/lightness in percentage points. */
export function hexToHsl(hex) {
  let value = String(hex).trim().replace(/^#/, '');
  if (/^[\da-f]{3}$/i.test(value)) value = [...value].map((digit) => digit + digit).join('');
  if (!/^[\da-f]{6}$/i.test(value)) throw new TypeError('Theme color must be a three- or six-digit hex color.');
  const [r, g, b] = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255);
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const difference = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  if (!difference) return { h: 0, s: 0, l: lightness * 100 };
  let hue;
  if (maximum === r) hue = ((g - b) / difference) % 6;
  else if (maximum === g) hue = (b - r) / difference + 2;
  else hue = (r - g) / difference + 4;
  return {
    h: ((hue * 60) + 360) % 360,
    s: (difference / (1 - Math.abs(2 * lightness - 1))) * 100,
    l: lightness * 100,
  };
}

export function hslToHex({ h, s, l }) {
  const hue = (((h % 360) + 360) % 360) / 60;
  const saturation = clamp(s, 0, 100) / 100;
  const lightness = clamp(l, 0, 100) / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs((hue % 2) - 1));
  const offset = lightness - chroma / 2;
  const sectors = [[chroma, secondary, 0], [secondary, chroma, 0], [0, chroma, secondary], [0, secondary, chroma], [secondary, 0, chroma], [chroma, 0, secondary]];
  return '#' + sectors[Math.floor(hue)].map((channel) => Math.round((channel + offset) * 255).toString(16).padStart(2, '0')).join('');
}

export function randomThemeColor(theme, random = Math.random) {
  const { h, s, l } = hexToHsl(theme);
  return {
    h: (h + (random() * 10 - 5) + 360) % 360,
    s: clamp(s + random() * 20 - 10, 0, 100),
    l: clamp(l + random() * 20 - 10, 0, 100),
  };
}

export function cloverSVG({ className = '', color = 'currentColor', title = '', variant = 'small', ...attributes } = {}) {
  const extra = Object.entries(attributes).filter(([key]) => /^(width|height|role|aria-[\w-]+|data-[\w-]+)$/.test(key))
    .map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`).join('');
  const path = variant === 'large' ? CLOVER_PATH : SMALL_CLOVER_PATH;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="${escapeAttribute(className)}" fill="${escapeAttribute(color)}" stroke="none"${title ? ' role="img"' : ' aria-hidden="true"'}${extra}>${title ? `<title>${escapeAttribute(title)}</title>` : ''}<path d="${path}"/></svg>`;
}

export function createCloverScene({ container, seed = 'shiratsume', theme = '#B7BB5A', reducedMotion = () => false }) {
  const elements = [];
  const visitSeed = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const layouts = new Map();
  let destroyed = false;

  function layoutFor(model) {
    if (model === 'preview') return SCENE_LAYOUT;
    if (!layouts.has(model)) layouts.set(model, generateSceneLayout(`${visitSeed}:${model}`));
    return layouts.get(model);
  }

  function render() {
    elements.splice(0).forEach((element) => element.remove());
    const random = seededRandom(seed);
    const fragment = container.ownerDocument.createDocumentFragment();
    layoutFor(seed).forEach(({ id, x, y, size, rotation, variant, colorVariant }) => {
      const color = colorVariant === 'theme' ? theme : hslToHex(randomThemeColor(theme, random));
      const element = container.ownerDocument.createElement('div');
      element.className = 'scene-clover';
      element.setAttribute('aria-hidden', 'true');
      element.setAttribute('data-contrast-shape', '');
      element.setAttribute('data-shape-variant', variant);
      element.setAttribute('data-scene-id', id);
      element.style.pointerEvents = 'none';
      const variables = {
        '--x': `${x}%`, '--y': `${y}%`, '--size': `${size}vmin`,
        '--rotation': `${rotation}deg`, '--sway': `${(0.9 + random() * 1.8).toFixed(2)}deg`,
        '--duration': `${(4 + random() * 3).toFixed(2)}s`, '--delay': `${(-random() * 7).toFixed(2)}s`,
      };
      Object.entries(variables).forEach(([name, value]) => element.style.setProperty(name, value));
      if (reducedMotion()) element.style.animation = 'none';
      element.innerHTML = cloverSVG({ className: 'clover-svg', color, variant });
      elements.push(element);
      fragment.append(element);
    });
    container.append(fragment);
  }
  render();
  return {
    setTheme(nextTheme, nextSeed = seed) {
      if (destroyed) return;
      hexToHsl(nextTheme);
      theme = nextTheme;
      seed = nextSeed;
      render();
    },
    destroy() {
      destroyed = true;
      elements.splice(0).forEach((element) => element.remove());
    },
  };
}

function halftoneGridMetrics(width, height, spacing, maxRadius) {
  const suppliedSpacing = Number(spacing);
  spacing = Number.isFinite(suppliedSpacing) && suppliedSpacing > 0 ? suppliedSpacing : Math.min(width, height) <= 600 ? 16 : 32;
  const suppliedRadius = Number(maxRadius);
  maxRadius = Math.max(Number.isFinite(suppliedRadius) && suppliedRadius > 0 ? suppliedRadius : spacing * 0.75, spacing / Math.SQRT2 + 0.5);
  return { spacing, maxRadius, featherWidth: spacing * 5 };
}

/** A rotated square lattice; only the positions rotate, not its ellipse field. */
export function generateTiltedGridDots({ width = 1440, height = 900, spacing, maxRadius } = {}) {
  width = Math.max(1, Number(width) || 1440);
  height = Math.max(1, Number(height) || 900);
  const metrics = halftoneGridMetrics(width, height, spacing, maxRadius);
  ({ spacing, maxRadius } = metrics);
  const { featherWidth } = metrics;
  const cx = width / 2;
  const cy = height / 2;
  const baseX = width * 0.45;
  const baseY = height * 0.435;
  const minimumAxis = Math.min(baseX, baseY);
  const angle = 8 * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const padding = Math.max(spacing, maxRadius + 1);
  // Inverse-transform the expanded screen, rather than rotating a grid clipped
  // to the original rectangle: that would leave bare triangles at its corners.
  const corners = [[-padding, -padding], [width + padding, -padding], [-padding, height + padding], [width + padding, height + padding]]
    .map(([x, y]) => ({ x: cosine * (x - cx) + sine * (y - cy), y: -sine * (x - cx) + cosine * (y - cy) }));
  const firstX = Math.floor(Math.min(...corners.map(({ x }) => x)) / spacing);
  const lastX = Math.ceil(Math.max(...corners.map(({ x }) => x)) / spacing);
  const firstY = Math.floor(Math.min(...corners.map(({ y }) => y)) / spacing);
  const lastY = Math.ceil(Math.max(...corners.map(({ y }) => y)) / spacing);
  const dots = [];
  for (let gridY = firstY; gridY <= lastY; gridY += 1) {
    for (let gridX = firstX; gridX <= lastX; gridX += 1) {
      const x = cx + cosine * gridX * spacing - sine * gridY * spacing;
      const y = cy + sine * gridX * spacing + cosine * gridY * spacing;
      if (x < -padding || x > width + padding || y < -padding || y > height + padding) continue;
      const edgeRho = Math.hypot((x - cx) / baseX, (y - cy) / baseY);
      // This conservative physical distance has a gradient of at most one:
      // feathering therefore spans at least five grid steps on either axis.
      const inwardDistance = (1 - edgeRho) * minimumAxis;
      const progress = clamp(1 - inwardDistance / featherWidth, 0, 1);
      const alpha = progress * progress * (3 - 2 * progress);
      const radius = maxRadius * alpha;
      if (radius < 0.18) continue;
      dots.push({ x, y, radius, alpha, progress, inwardDistance, featherWidth, gridX, gridY, rho: edgeRho, edgeRho });
    }
  }
  return dots;
}

/** Compatibility aliases for the previous internal helper names. */
export function generateEllipticalHalftoneDots(options) {
  return generateTiltedGridDots(options);
}

export function generateRadialHalftoneDots(options) {
  return generateTiltedGridDots(options);
}

/** Large outer dots merge into one frame; soft retains the previous grid. */
export function createHalftoneSVG({ width = 1440, height = 900, spacing, maxRadius, profile = 'solid' } = {}) {
  width = Math.max(1, Number(width) || 1440);
  height = Math.max(1, Number(height) || 900);
  const soft = profile === 'soft';
  if (!soft) {
    const metrics = halftoneGridMetrics(width, height, spacing, maxRadius);
    ({ spacing, maxRadius } = metrics);
    const { featherWidth } = metrics;
    const dots = generateTiltedGridDots({ width, height, spacing, maxRadius }).map(({ x, y, radius, alpha, progress, gridX, gridY, edgeRho }) => `<circle cx="${x.toFixed(3)}" cy="${y.toFixed(3)}" r="${radius.toFixed(2)}" opacity="${alpha.toFixed(6)}" data-progress="${progress.toFixed(6)}" data-grid-x="${gridX}" data-grid-y="${gridY}" data-rho="${edgeRho.toFixed(6)}"/>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" class="halftone-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" fill="currentColor" opacity="1" data-dot-spacing="${spacing}" data-max-radius="${maxRadius}" data-feather-width="${featherWidth}" data-feather-steps="5" data-profile="solid" data-layout="tilted-grid" data-angle="8">${dots.join('')}</svg>`;
  }
  spacing = clamp(Number(spacing) || 34, 32, 36);
  maxRadius = clamp(Number(maxRadius) || 17, 14, 18);
  const dots = [];
  const first = soft ? 0 : -spacing;
  for (let y = first; y <= height + spacing; y += spacing) {
    for (let x = first; x <= width + spacing; x += spacing) {
      const distance = Math.hypot((x - width / 2) / (width / 2), (y - height / 2) / (height / 2));
      const edgeDistance = Math.min(x, width - x, y, height - y);
      const taper = Math.max(1, Math.min(width, height) * 0.44 - spacing);
      const amount = soft ? clamp((distance - 0.24) / 0.76, 0, 1) : clamp(1 - Math.max(0, edgeDistance - spacing) / taper, 0, 1);
      const radius = maxRadius * amount ** (soft ? 2 : 2.5);
      if (radius < 0.18) continue;
      dots.push(`<circle cx="${x}" cy="${y}" r="${radius.toFixed(2)}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" class="halftone-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" fill="currentColor" opacity="${soft ? '.58' : '1'}" data-dot-spacing="${spacing}" data-max-radius="${maxRadius}" data-profile="${soft ? 'soft' : 'solid'}">${dots.join('')}</svg>`;
}

let shadowSequence = 0;
// Flatten the fixed, approved cubic outline once for a static shadow-distance
// field. This is upload/render-time geometry, with no video or animation reads.
const shadowOutline = (() => {
  const values = CLOVER_PATH.match(/-?\d+(?:\.\d+)?/g).map(Number);
  let [x, y] = values;
  const points = [[x, y]];
  for (let index = 2; index < values.length; index += 6) {
    const [x1, y1, x2, y2, x3, y3] = values.slice(index, index + 6);
    for (let step = 1; step <= 12; step += 1) {
      const t = step / 12;
      const u = 1 - t;
      points.push([u ** 3 * x + 3 * u ** 2 * t * x1 + 3 * u * t ** 2 * x2 + t ** 3 * x3, u ** 3 * y + 3 * u ** 2 * t * y1 + 3 * u * t ** 2 * y2 + t ** 3 * y3]);
    }
    [x, y] = [x3, y3];
  }
  return points;
})();

function outlineDistance(x, y) {
  let inside = false;
  let distance = Infinity;
  for (let index = 0, previous = shadowOutline.length - 1; index < shadowOutline.length; previous = index++) {
    const [ax, ay] = shadowOutline[previous];
    const [bx, by] = shadowOutline[index];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
    const dx = bx - ax;
    const dy = by - ay;
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    distance = Math.min(distance, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return { inside, distance };
}

/** A solid large clover over a crisp, right/down offset dot-pattern silhouette. */
export function halftoneShadowSVG({ id, className = 'clover-svg', color = 'currentColor', shadowColor = 'currentColor', offsetX = 6, offsetY = 7, dotRadius = 2.3, spacing = 7, opacity = 0.5, profile = 'solid' } = {}) {
  const key = `clover-shadow-${String(id ?? ++shadowSequence).replace(/[^\w-]/g, '-')}`;
  offsetX = clamp(Number(offsetX) || 0, 0, 20);
  offsetY = clamp(Number(offsetY) || 0, 0, 20);
  spacing = clamp(Number(spacing) || 7, 5, 12);
  const soft = profile === 'soft';
  dotRadius = clamp(Number(dotRadius) || 2.3, 1, spacing / 2 - 0.2);
  opacity = clamp(Number(opacity), 0, 1);
  const extent = 100 + Math.max(offsetX, offsetY);
  const maximum = Math.ceil((spacing / Math.SQRT2 + 0.8) * 100) / 100;
  const circles = [];
  if (!soft) {
    for (let y = -spacing; y <= extent + spacing; y += spacing) {
      for (let x = -spacing; x <= extent + spacing; x += spacing) {
        const front = outlineDistance(x, y);
        const back = outlineDistance(x - offsetX, y - offsetY);
        const progress = front.inside ? 0 : !back.inside ? 1 : front.distance / (front.distance + back.distance + 0.001);
        const amount = clamp(progress * 1.8, 0, 1) ** 1.5;
        const radius = dotRadius + (maximum - dotRadius) * amount;
        circles.push(`<circle cx="${x}" cy="${y}" r="${radius.toFixed(2)}"/>`);
      }
    }
  }
  const pattern = soft ? `<pattern id="${key}-dots" patternUnits="userSpaceOnUse" width="${spacing}" height="${spacing}"><circle cx="${spacing / 2}" cy="${spacing / 2}" r="${dotRadius}" fill="${escapeAttribute(shadowColor)}"/></pattern>` : '';
  const dots = soft ? `<rect width="${extent}" height="${extent}" fill="url(#${key}-dots)"/>` : circles.join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${escapeAttribute(className)}" viewBox="0 0 100 100" overflow="visible" aria-hidden="true" stroke="none" data-profile="${soft ? 'soft' : 'solid'}" data-dot-spacing="${spacing}" data-max-radius="${soft ? dotRadius : maximum}"><defs>${pattern}<clipPath id="${key}-clip" clipPathUnits="userSpaceOnUse"><path d="${CLOVER_PATH}" transform="translate(${offsetX} ${offsetY})"/></clipPath></defs><g clip-path="url(#${key}-clip)" opacity="${opacity}" fill="${escapeAttribute(shadowColor)}">${dots}</g><path d="${CLOVER_PATH}" fill="${escapeAttribute(color)}"/></svg>`;
}
