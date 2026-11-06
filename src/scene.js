// One continuous, rounded four-heart silhouette, shared by visible art and masks.
export const CLOVER_PATH = 'M50 18 C43 2 21 6 24 23 C25 31 36 40 43 46 C34 41 26 27 18 26 C2 22 -1 43 15 50 C-1 57 2 78 18 74 C26 73 34 59 43 54 C36 60 25 69 24 77 C21 94 43 98 50 82 C57 98 79 94 76 77 C75 69 64 60 57 54 C66 59 74 73 82 74 C98 78 101 57 85 50 C101 43 98 22 82 26 C74 27 66 41 57 46 C64 40 75 31 76 23 C79 6 57 2 50 18 Z';

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

export function cloverSVG({ className = '', color = 'currentColor', title = '', ...attributes } = {}) {
  const extra = Object.entries(attributes).filter(([key]) => /^(width|height|role|aria-[\w-]+|data-[\w-]+)$/.test(key))
    .map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="${escapeAttribute(className)}" fill="${escapeAttribute(color)}" stroke="none"${title ? ' role="img"' : ' aria-hidden="true"'}${extra}>${title ? `<title>${escapeAttribute(title)}</title>` : ''}<path d="${CLOVER_PATH}"/></svg>`;
}

export function createCloverScene({ container, seed = 'shiratsume', theme = '#B7BB5A', reducedMotion = () => false }) {
  const elements = [];
  let destroyed = false;
  const positions = [
    [11, 26, 24, -18], [88, 23, 32, 14], [19, 78, 23, 27],
    [82, 79, 29, -12], [54, 94, 15, 5],
  ];

  function render() {
    elements.splice(0).forEach((element) => element.remove());
    const random = seededRandom(seed);
    const fragment = container.ownerDocument.createDocumentFragment();
    positions.forEach(([x, y, size, rotation], index) => {
      const color = index % 2 === 0 ? theme : hslToHex(randomThemeColor(theme, random));
      const element = container.ownerDocument.createElement('div');
      element.className = 'scene-clover';
      element.setAttribute('aria-hidden', 'true');
      element.style.pointerEvents = 'none';
      const variables = {
        '--x': `${x}%`, '--y': `${y}%`, '--size': `${size}vmin`,
        '--rotation': `${rotation}deg`, '--sway': `${(0.9 + random() * 1.8).toFixed(2)}deg`,
        '--duration': `${(4 + random() * 3).toFixed(2)}s`, '--delay': `${(-random() * 7).toFixed(2)}s`,
      };
      Object.entries(variables).forEach(([name, value]) => element.style.setProperty(name, value));
      if (reducedMotion()) element.style.animation = 'none';
      element.innerHTML = cloverSVG({ className: 'clover-svg', color });
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

/** Sparse at the center, gradually larger/darker near the frame. No filters. */
export function createHalftoneSVG() {
  const dots = [];
  for (let y = 10; y <= 910; y += 40) {
    for (let x = 0; x <= 1440; x += 40) {
      const distance = Math.hypot((x - 720) / 720, (y - 450) / 450) / Math.SQRT2;
      const amount = clamp((distance - 0.31) / 0.69, 0, 1);
      if (amount < 0.04) continue;
      dots.push(`<circle cx="${x}" cy="${y}" r="${(0.6 + amount * 4.5).toFixed(2)}" opacity="${(0.05 + amount * 0.47).toFixed(3)}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" class="halftone-svg" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" fill="currentColor">${dots.join('')}</svg>`;
}
