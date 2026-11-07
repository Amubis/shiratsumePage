const SVG_NS = 'http://www.w3.org/2000/svg';
let clipSerial = 0;
const number = (value) => String(Number(value.toFixed(6)));

/** One persistent document resource: animation updates geometry, never an image URL. */
export function createStableClip({ document: doc, prefix = 'shape' } = {}) {
  const host = doc?.body || doc?.documentElement;
  if (!host || typeof doc.createElementNS !== 'function') throw new TypeError('A document with SVG support is required.');
  const id = `live-clip-${String(prefix).replace(/[^a-zA-Z0-9_-]/g, '-')}-${++clipSerial}`;
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('data-stable-clip', '');
  // Safari still needs the definitions in the render tree. Never hide this SVG
  // with display:none or visibility:hidden; zero dimensions keep it unobtrusive.
  svg.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;';
  const defs = doc.createElementNS(SVG_NS, 'defs');
  const clip = doc.createElementNS(SVG_NS, 'clipPath');
  clip.setAttribute('id', id);
  clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
  defs.append(clip);
  svg.append(defs);
  host.append(svg);
  const paths = [];
  let destroyed = false;
  const set = (node, name, value) => {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  };

  return {
    id,
    url: `url("#${id}")`,
    update(projections = []) {
      if (destroyed) return;
      const entries = projections.filter(Boolean);
      // Validate before touching the live definition, so a bad update cannot
      // leave a half-written clip or briefly expose the whole white copy.
      const values = entries.map(({ path, matrix, rule }) => {
        if (typeof path !== 'string') throw new TypeError('A clip path string is required.');
        if (matrix && (matrix.length !== 6 || !Array.from(matrix).every(Number.isFinite))) throw new TypeError('A clip transform requires six finite numbers.');
        return { path, transform: matrix ? `matrix(${Array.from(matrix, number).join(' ')})` : null, rule: rule === 'evenodd' ? 'evenodd' : 'nonzero' };
      });
      values.forEach(({ path, transform, rule }, index) => {
        let node = paths[index];
        if (!node) {
          node = doc.createElementNS(SVG_NS, 'path');
          paths.push(node);
          clip.append(node);
        }
        set(node, 'd', path);
        set(node, 'clip-rule', rule);
        set(node, 'fill-rule', rule);
        if (transform) set(node, 'transform', transform);
        else if (node.getAttribute('transform') !== null) node.removeAttribute('transform');
      });
      while (paths.length > values.length) paths.pop().remove();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      svg.remove();
      paths.length = 0;
    },
  };
}
