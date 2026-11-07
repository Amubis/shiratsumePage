import { shapeMatrix, projectShape, maskSvg } from './contrast.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const IDREFS = new Set(['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-activedescendant', 'aria-details', 'aria-errormessage', 'for', 'form', 'headers', 'list', 'popovertarget', 'commandfor']);
const FOCUSABLE = new Set(['a', 'area', 'button', 'input', 'select', 'textarea', 'summary', 'iframe', 'audio', 'video']);
let snapshotSerial = 0;

function elements(root) {
  const result = [];
  const visit = (element) => {
    result.push(element);
    for (const child of Array.from(element.children)) visit(child);
  };
  visit(root);
  return result;
}

function svgRoot(element) {
  for (let node = element; node; node = node.parentElement) if (node.localName === 'svg') return node;
  return null;
}

/** Update fragment-only SVG references; external URLs and global icons stay intact. */
export function rewriteSvgReferences(value, ids) {
  return String(value).replace(/url\(\s*(['"]?)#([^\s'"()]+)\1\s*\)/g, (match, quote, id) => ids.has(id) ? `url(#${ids.get(id)})` : match);
}

/** Sanitize an already-cloned subtree. It stays visually identical and inert.
 * Decorative SVG definitions receive new IDs together with all local references.
 */
export function sanitizePageClone(root, { prefix = `wipe-snapshot-${++snapshotSerial}` } = {}) {
  const nodes = elements(root);
  const globalIds = new Map();
  const localIds = new Map();
  let idSerial = 0;
  for (const node of nodes) {
    const id = node.getAttribute('id');
    if (id === null) continue;
    if (!id) { node.removeAttribute('id'); continue; }
    const svg = svgRoot(node);
    if (!svg && node.namespaceURI !== SVG_NS) { node.removeAttribute('id'); continue; }
    const replacement = `${prefix}-${++idSerial}`;
    node.setAttribute('id', replacement);
    if (!globalIds.has(id)) globalIds.set(id, replacement);
    if (svg) {
      if (!localIds.has(svg)) localIds.set(svg, new Map());
      if (!localIds.get(svg).has(id)) localIds.get(svg).set(id, replacement);
    }
  }
  for (const node of nodes) {
    const svg = svgRoot(node);
    const ids = new Map(globalIds);
    for (const [id, replacement] of localIds.get(svg) || []) ids.set(id, replacement);
    for (const { name, value } of Array.from(node.attributes)) {
      if (name.startsWith('data-') || name.startsWith('on') || IDREFS.has(name) || name === 'autofocus') {
        node.removeAttribute(name);
        continue;
      }
      if ((name === 'href' || name === 'xlink:href') && !svg) { node.removeAttribute(name); continue; }
      let updated = rewriteSvgReferences(value, ids);
      if ((name === 'href' || name === 'xlink:href') && updated.startsWith('#') && ids.has(updated.slice(1))) updated = `#${ids.get(updated.slice(1))}`;
      if (updated !== value) node.setAttribute(name, updated);
    }
    if (node.localName === 'style' && svg) node.textContent = rewriteSvgReferences(node.textContent, ids);
    if (FOCUSABLE.has(node.localName) || node.hasAttribute('tabindex') || node.hasAttribute('contenteditable')) {
      node.setAttribute('tabindex', '-1');
      node.removeAttribute('contenteditable');
    }
    if (node.localName === 'svg') node.setAttribute('focusable', 'false');
    if (node.localName === 'img') { node.setAttribute('loading', 'eager'); node.loading = 'eager'; }
  }
  return root;
}

const maskImage = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

/** A static DOM snapshot of the incoming section, revealed by the wipe's path.
 * CSS positions the wrapper and section at the viewport origin; root owns opacity.
 */
export function createPageReveal({ container, shape, section } = {}) {
  if (!container?.ownerDocument || !shape || !section) throw new TypeError('A container, wipe shape and incoming section are required.');
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  const element = doc.createElement('div');
  element.className = 'wipe-page-preview';
  element.setAttribute('aria-hidden', 'true');
  element.setAttribute('inert', '');
  element.inert = true;
  element.style.cssText = 'visibility:hidden;pointer-events:none;user-select:none;mask-repeat:no-repeat;mask-size:100% 100%;-webkit-mask-repeat:no-repeat;-webkit-mask-size:100% 100%;';
  const transparent = maskImage(maskSvg(1, 1, []));
  element.style.maskImage = transparent;
  element.style.webkitMaskImage = transparent;
  element.append(sanitizePageClone(section.cloneNode(true)));
  container.append(element);

  let frame = 0;
  let started = false;
  let sealed = false;
  let destroyed = false;
  let lastPaint = -Infinity;
  const stop = () => { if (frame) win.cancelAnimationFrame(frame); frame = 0; };

  function paint() {
    const width = Math.max(1, win.innerWidth || doc.documentElement.clientWidth || 1);
    const height = Math.max(1, win.innerHeight || doc.documentElement.clientHeight || 1);
    const style = win.getComputedStyle(shape);
    const descriptor = {
      width: shape.offsetWidth,
      height: shape.offsetHeight,
      rect: shape.getBoundingClientRect(),
      transform: style.transform,
      transformOrigin: style.transformOrigin,
      variant: 'large',
    };
    descriptor.matrix = shapeMatrix(descriptor);
    const projected = projectShape(descriptor, { left: 0, top: 0, width, height });
    const image = maskImage(maskSvg(width, height, projected ? [projected] : []));
    element.style.maskImage = image;
    element.style.webkitMaskImage = image;
    element.style.visibility = 'visible';
  }

  function tick(timestamp) {
    frame = 0;
    if (destroyed || sealed) return;
    if (timestamp - lastPaint >= 1000 / 60) { paint(); lastPaint = timestamp; }
    frame = win.requestAnimationFrame(tick);
  }

  return {
    element,
    start() {
      if (started || sealed || destroyed) return;
      started = true;
      paint();
      lastPaint = win.performance?.now?.() ?? -Infinity;
      frame = win.requestAnimationFrame(tick);
    },
    seal() {
      if (sealed || destroyed) return;
      sealed = true;
      stop();
      element.style.maskImage = 'none';
      element.style.webkitMaskImage = 'none';
      element.style.visibility = 'visible';
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      element.remove();
    },
  };
}
