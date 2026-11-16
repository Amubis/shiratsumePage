import { SMALL_CLOVER_PATH } from './scene.js';

const FLOATS = Object.freeze([
  { x: 110, y: 126, size: .38, turn: -14, delay: -4.5, duration: 7.8 },
  { x: 332, y: 192, size: .78, turn: 19, delay: -1.2, duration: 9.4 },
  { x: 584, y: 103, size: .32, turn: -9, delay: -6.3, duration: 8.5 },
  { x: 858, y: 176, size: .59, turn: -18, delay: -3.4, duration: 10.1 },
  { x: 1156, y: 118, size: .4, turn: 11, delay: -7.1, duration: 8.8 },
  { x: 1393, y: 232, size: 1.05, turn: 25, delay: -5.2, duration: 10.7 },
]);

/** A small, fixed SVG scene marks the real end of the owner page. */
export function waterFooterSVG() {
  const leaves = FLOATS.map(({ x, y, size, turn, delay, duration }, index) => {
    const radius = Math.round(118 * size + 24), depth = Math.round(20 * size + 6);
    return `<g class="water-float" transform="translate(${x} ${y})" style="--water-delay:${delay}s;--water-duration:${duration}s">
      <ellipse class="water-ring water-ring-outer" cx="0" cy="9" rx="${radius}" ry="${depth}"/>
      <ellipse class="water-ring water-ring-inner" cx="0" cy="9" rx="${Math.round(radius * .71)}" ry="${Math.round(depth * .7)}"/>
      <ellipse class="water-ring water-ring-travel" cx="0" cy="9" rx="${radius}" ry="${depth}"/>
      <g class="water-leaf-drift"><g transform="rotate(${turn}) scale(${size} ${size * .68}) translate(-50 -50)">
        <path class="water-leaf-shadow" d="${SMALL_CLOVER_PATH}" transform="translate(5 7)"/>
        <path class="water-leaf water-leaf-${index % 3}" d="${SMALL_CLOVER_PATH}"/>
      </g></g>
    </g>`;
  }).join('');
  return `<svg class="water-footer-scene" viewBox="0 0 1440 260" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
    <ellipse class="water-plane" cx="730" cy="270" rx="960" ry="178"/>
    <path class="water-horizon" d="M-80 199 C160 118 328 199 536 159 S996 122 1520 169"/>
    <path class="water-contour" d="M-80 224 C151 161 357 231 555 191 S1049 165 1520 208"/>
    <path class="water-contour water-contour-faint" d="M-80 263 C221 186 378 273 708 224 S1143 202 1520 244"/>
    ${leaves}
  </svg>`;
}

/** CSS owns the slow motion; no animation loop, images or network requests. */
export function createWaterFooter({ container, reducedMotion = () => false } = {}) {
  if (!container?.ownerDocument) throw new TypeError('A water footer container is required.');
  let destroyed = false;
  const refresh = () => {
    if (destroyed) return;
    const reduced = typeof reducedMotion === 'function' ? reducedMotion() : reducedMotion;
    container.classList.toggle('is-water-still', Boolean(reduced));
  };
  container.classList.add('personal-water-footer');
  container.setAttribute('aria-hidden', 'true');
  container.innerHTML = waterFooterSVG();
  refresh();
  return {
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      container.replaceChildren();
      container.classList.remove('is-water-still');
    },
  };
}
