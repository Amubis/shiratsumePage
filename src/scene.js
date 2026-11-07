// Small artwork is a simple, rounded four-petal cross. The larger version adds
// shallow heart notches without narrowing the petals or disconnecting the core.
export const SMALL_CLOVER_PATH = 'M50 6 C64 6 70 17 65 33 C81 28 94 36 94 50 C94 64 81 72 65 67 C70 83 64 94 50 94 C36 94 30 83 35 67 C19 72 6 64 6 50 C6 36 19 28 35 33 C30 17 36 6 50 6 Z';
export const CLOVER_PATH = 'M50 10 C43 1 30 5 29 17 C28 24 34 33 39 39 C33 34 24 28 17 29 C5 30 1 43 10 50 C1 57 5 70 17 71 C24 72 33 66 39 61 C34 67 28 76 29 83 C30 95 43 99 50 90 C57 99 70 95 71 83 C72 76 66 67 61 61 C67 66 76 72 83 71 C95 70 99 57 90 50 C99 43 95 30 83 29 C76 28 67 34 61 39 C66 33 72 24 71 17 C70 5 57 1 50 10 Z';

// Percent positions and vmin sizes are shared with the screen-space text mask.
// A single overlapping cluster leaves the center and upper half quiet.
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
  let destroyed = false;

  function render() {
    elements.splice(0).forEach((element) => element.remove());
    const random = seededRandom(seed);
    const fragment = container.ownerDocument.createDocumentFragment();
    SCENE_LAYOUT.forEach(({ id, x, y, size, rotation, variant, colorVariant }) => {
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

/** Edge density comes from dot size, not a color/opacity gradient. */
export function createHalftoneSVG({ width = 1440, height = 900, spacing = 34, maxRadius = 17 } = {}) {
  width = Math.max(1, Number(width) || 1440);
  height = Math.max(1, Number(height) || 900);
  spacing = clamp(Number(spacing) || 34, 32, 36);
  maxRadius = clamp(Number(maxRadius) || 17, 14, 18);
  const dots = [];
  for (let y = 0; y <= height + spacing; y += spacing) {
    for (let x = 0; x <= width + spacing; x += spacing) {
      const distance = Math.hypot((x - width / 2) / (width / 2), (y - height / 2) / (height / 2));
      const amount = clamp((distance - 0.24) / 0.76, 0, 1);
      const radius = maxRadius * amount ** 2;
      if (radius < 0.18) continue;
      dots.push(`<circle cx="${x}" cy="${y}" r="${radius.toFixed(2)}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" class="halftone-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" fill="currentColor" opacity=".58">${dots.join('')}</svg>`;
}

let shadowSequence = 0;
/** A solid large clover over a crisp, right/down offset dot-pattern silhouette. */
export function halftoneShadowSVG({ id, className = 'clover-svg', color = 'currentColor', shadowColor = 'currentColor', offsetX = 6, offsetY = 7, dotRadius = 2.3, spacing = 7, opacity = 0.5 } = {}) {
  const key = `clover-shadow-${String(id ?? ++shadowSequence).replace(/[^\w-]/g, '-')}`;
  offsetX = clamp(Number(offsetX) || 0, 0, 20);
  offsetY = clamp(Number(offsetY) || 0, 0, 20);
  spacing = clamp(Number(spacing) || 7, 5, 12);
  dotRadius = clamp(Number(dotRadius) || 2.3, 1, spacing / 2 - 0.2);
  opacity = clamp(Number(opacity), 0, 1);
  const extent = 100 + Math.max(offsetX, offsetY);
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${escapeAttribute(className)}" viewBox="0 0 100 100" overflow="visible" aria-hidden="true" stroke="none"><defs><pattern id="${key}-dots" patternUnits="userSpaceOnUse" width="${spacing}" height="${spacing}"><circle cx="${spacing / 2}" cy="${spacing / 2}" r="${dotRadius}" fill="${escapeAttribute(shadowColor)}"/></pattern><clipPath id="${key}-clip" clipPathUnits="userSpaceOnUse"><path d="${CLOVER_PATH}" transform="translate(${offsetX} ${offsetY})"/></clipPath></defs><g clip-path="url(#${key}-clip)" opacity="${opacity}"><rect width="${extent}" height="${extent}" fill="url(#${key}-dots)"/></g><path d="${CLOVER_PATH}" fill="${escapeAttribute(color)}"/></svg>`;
}
