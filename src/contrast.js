import { CLOVER_PATH, SMALL_CLOVER_PATH } from './scene.js';
import { createStableClip } from './stable-clip.js';

const IDREFS = new Set(['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-activedescendant', 'for', 'form', 'headers']);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const flag = (value) => typeof value === 'function' ? value() : value;
const xml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));

/** The 2D part of a computed CSS transform; no DOMMatrix dependency is needed. */
export function parseTransform(transform = 'none') {
  if (Array.isArray(transform)) return transform;
  const values = String(transform).match(/^matrix(3d)?\(([^)]+)\)$/);
  if (!values) return [1, 0, 0, 1, 0, 0];
  const numbers = values[2].split(',').map(Number);
  const result = values[1] ? [numbers[0], numbers[1], numbers[4], numbers[5], numbers[12], numbers[13]] : numbers;
  return result.length === 6 && result.every(Number.isFinite) ? result : [1, 0, 0, 1, 0, 0];
}

function originCoordinate(value, size) {
  if (String(value).endsWith('%')) return finite(parseFloat(value)) * size / 100;
  if (value === 'center') return size / 2;
  if (value === 'right' || value === 'bottom') return size;
  return finite(parseFloat(value));
}

/** Map a shape's untransformed CSS pixels into viewport coordinates.
 * Its bounding box locates the transformed corners; it is never used as the path.
 * Ancestors may translate, but must not rotate, scale or add perspective.
 */
export function shapeMatrix({ width, height, rect, transform = 'none', transformOrigin = '50% 50%' }) {
  const [a, b, c, d, e, f] = parseTransform(transform);
  const origins = String(transformOrigin).trim().split(/\s+/);
  const ox = originCoordinate(origins[0], width);
  const oy = originCoordinate(origins[1] ?? origins[0], height);
  const offsetX = ox - a * ox - c * oy + e;
  const offsetY = oy - b * ox - d * oy + f;
  const corners = [[0, 0], [width, 0], [0, height], [width, height]];
  const minimumX = Math.min(...corners.map(([x, y]) => a * x + c * y + offsetX));
  const minimumY = Math.min(...corners.map(([x, y]) => b * x + d * y + offsetY));
  return [a, b, c, d, rect.left - minimumX + offsetX, rect.top - minimumY + offsetY];
}

export function overlaps(a, b) {
  return a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0 &&
    a.left < b.left + b.width && a.left + a.width > b.left &&
    a.top < b.top + b.height && a.top + a.height > b.top;
}

/** Project the shared 100 × 100 artwork into a target's local CSS pixels. */
export function projectShape(shape, targetRect) {
  if (!overlaps(shape.rect, targetRect)) return null;
  const [a, b, c, d, e, f] = shape.matrix || shapeMatrix(shape);
  return {
    path: shape.variant === 'small' ? SMALL_CLOVER_PATH : CLOVER_PATH,
    matrix: [a * shape.width / 100, b * shape.width / 100, c * shape.height / 100, d * shape.height / 100, e - targetRect.left, f - targetRect.top],
  };
}

const number = (value) => Math.abs(value) < 0.0000005 ? '0' : String(Number(value.toFixed(6)));

/** Transparent canvas + opaque paths: CSS masks use alpha, not SVG luminance. */
export function maskSvg(width, height, projections) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${number(width)}" height="${number(height)}" viewBox="0 0 ${number(width)} ${number(height)}">${projections.filter(Boolean).map(({ path, matrix }) => `<path fill="white" d="${xml(path)}" transform="matrix(${matrix.map(number).join(' ')})"/>`).join('')}</svg>`;
}

/** A clover must be visible through every ancestor up to the scene itself.
 * The caller shares this style cache across shapes, then discards it each frame.
 */
export function isShapeVisible(element, scene, readStyle, cache = new Map()) {
  let opacity = 1;
  for (let node = element; node; node = node.parentElement) {
    if (!cache.has(node)) cache.set(node, readStyle(node));
    const style = cache.get(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    const value = parseFloat(style.opacity);
    opacity *= Number.isFinite(value) ? value : 1;
    if (opacity < 0.02) return false;
    if (node === scene) break;
  }
  return true;
}

function sanitizeClone(node) {
  if (node.nodeType !== 1) return;
  if (node.classList.contains('contrast-copy')) { node.remove(); return; }
  for (const { name } of Array.from(node.attributes)) {
    if (name === 'id' || name.startsWith('data-') || name.startsWith('on') || IDREFS.has(name)) node.removeAttribute(name);
  }
  if (node.matches('a, area')) node.removeAttribute('href');
  if (node.matches('a, area, button, input, select, textarea, summary, [tabindex], [contenteditable], audio[controls], video[controls]')) {
    node.setAttribute('tabindex', '-1');
    node.removeAttribute('contenteditable');
  }
  if (node.matches('button, input, select, textarea')) { node.disabled = true; node.removeAttribute('name'); }
  if (node.localName === 'svg') node.setAttribute('focusable', 'false');
  for (const child of Array.from(node.children)) sanitizeClone(child);
}

function pairCloneElements(source, clone, pairs) {
  if (source.nodeType !== 1 || source.classList.contains('contrast-copy')) return;
  pairs.push([source, clone]);
  const children = Array.from(clone.childNodes);
  Array.from(source.childNodes).forEach((child, index) => pairCloneElements(child, children[index], pairs));
}

const animationKey = (animation) => animation.animationName !== undefined ? `css:${animation.animationName}` :
  animation.transitionProperty !== undefined ? `transition:${animation.transitionProperty}` : `animation:${animation.id || ''}`;

/** Cloned CSS animations start anew. Align only each paired element's own effects.
 * This runs once after insertion, without changing the source or adding a timer.
 */
export function syncCloneAnimations(pairs) {
  const attempt = (action) => { try { action(); } catch { /* Older/inactive timelines can reject a timing assignment. */ } };
  for (const [source, clone] of pairs) {
    if (typeof source.getAnimations !== 'function' || typeof clone.getAnimations !== 'function') continue;
    attempt(() => {
      const copies = clone.getAnimations();
      for (const original of source.getAnimations()) {
        const index = copies.findIndex((candidate) => animationKey(candidate) === animationKey(original));
        if (index < 0) continue;
        const copy = copies.splice(index, 1)[0];
        if (original.playState === 'paused') attempt(() => copy.pause());
        attempt(() => { copy.playbackRate = original.playbackRate; });
        if (original.currentTime !== null) attempt(() => { copy.currentTime = original.currentTime; });
        if (original.startTime !== null) attempt(() => { copy.startTime = original.startTime; });
      }
    });
  }
}

const LAYOUT_PROPERTIES = ['display', 'flexDirection', 'flexWrap', 'alignItems', 'justifyContent', 'alignContent', 'columnGap', 'rowGap', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'textAlign', 'lineHeight', 'letterSpacing', 'whiteSpace', 'textTransform', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle'];

/** Add a purely visual white copy, clipped by the exact animated clover paths.
 * Video pixels are never read. refresh() also rebuilds copies after localization.
 */
export function createContrastLayer({ scene, targets, reducedMotion = false, isActive = true } = {}) {
  if (!scene?.ownerDocument) throw new TypeError('A scene element is required.');
  const doc = scene.ownerDocument;
  const win = doc.defaultView;
  let records = [];
  let frame = 0;
  let destroyed = false;
  let lastPaint = -Infinity;

  const stop = () => { if (frame) win.cancelAnimationFrame(frame); frame = 0; };
  const hide = () => records.forEach(({ copy }) => { copy.style.visibility = 'hidden'; });
  const active = () => !destroyed && !doc.hidden && flag(isActive);
  const schedule = () => {
    if (!frame && active() && !flag(reducedMotion)) frame = win.requestAnimationFrame(tick);
  };

  function paint() {
    if (!active()) { hide(); return; }
    // Read every layout/computed style before changing any mask or visibility.
    const styleCache = new Map();
    const readStyle = (element) => win.getComputedStyle(element);
    const shapes = Array.from(scene.querySelectorAll('[data-contrast-shape]')).flatMap((element) => {
      if (!isShapeVisible(element, scene, readStyle, styleCache)) return [];
      const style = styleCache.get(element);
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const rect = element.getBoundingClientRect();
      if (!width || !height) return [];
      const shape = { width, height, rect, transform: style.transform, transformOrigin: style.transformOrigin, variant: element.dataset.shapeVariant };
      shape.matrix = shapeMatrix(shape);
      return [shape];
    });
    const layouts = records.map(({ copy, clip }) => ({ copy, clip, rect: copy.getBoundingClientRect() }));
    const updates = layouts.map(({ copy, clip, rect }) => {
      const projections = shapes.map((shape) => projectShape(shape, rect)).filter(Boolean);
      return { copy, clip, projections };
    });
    for (const { copy, clip, projections } of updates) {
      // The local SVG resource and CSS URL stay the same for the copy's lifetime.
      // Only path geometry changes, avoiding WebKit's asynchronous image decode.
      clip.update(projections);
      copy.style.visibility = projections.length ? 'visible' : 'hidden';
    }
  }

  function tick(timestamp) {
    frame = 0;
    if (!active()) { hide(); return; }
    if (timestamp - lastPaint >= 1000 / 30) {
      lastPaint = timestamp;
      paint();
    }
    schedule();
  }

  function refresh() {
    if (destroyed) return;
    stop();
    records.forEach(({ copy, clip }) => { copy.remove(); clip.destroy(); });
    const elements = Array.from(targets || scene.querySelectorAll('[data-contrast]')).filter((target) => target.isConnected && !target.closest('.contrast-copy'));
    const animationPairs = [];
    // Read styles and clone content before appending anything that affects selectors.
    const layouts = elements.map((target) => ({ target, style: win.getComputedStyle(target) }));
    records = layouts.map(({ target, style }) => {
      const copy = doc.createElement('span');
      copy.className = 'contrast-copy';
      copy.setAttribute('aria-hidden', 'true');
      copy.setAttribute('inert', '');
      copy.inert = true;
      copy.style.cssText = 'position:absolute;inset:0;box-sizing:border-box;pointer-events:none;user-select:none;visibility:hidden;';
      const clip = createStableClip({ document: doc, prefix: 'contrast' });
      copy.style.clipPath = clip.url;
      copy.style.webkitClipPath = clip.url;
      for (const property of LAYOUT_PROPERTIES) copy.style[property] = style[property];
      for (const node of Array.from(target.childNodes)) {
        const clone = node.cloneNode(true);
        if (clone.nodeType === 1 && clone.classList.contains('contrast-copy')) continue;
        pairCloneElements(node, clone, animationPairs);
        sanitizeClone(clone);
        copy.append(clone);
      }
      return { target, copy, clip };
    });
    records.forEach(({ target, copy }) => target.append(copy));
    syncCloneAnimations(animationPairs);
    lastPaint = -Infinity;
    paint();
    schedule();
  }

  const resume = () => { stop(); lastPaint = -Infinity; paint(); schedule(); };
  win.addEventListener('resize', refresh);
  doc.addEventListener('visibilitychange', resume);
  refresh();
  return {
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      win.removeEventListener('resize', refresh);
      doc.removeEventListener('visibilitychange', resume);
      records.forEach(({ copy, clip }) => { copy.remove(); clip.destroy(); });
      records = [];
    },
  };
}
