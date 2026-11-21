export const LANGUAGE_TRANSITION_TIMING = Object.freeze({ close: 220, open: 280 });

const TEXT_SELECTORS = [
  '[data-language-text]', '[data-i18n]', '#language-label', '.language-other', '.top-links small',
  '#mobile-current', '#video-message', '#video-retry', '#video-open', '.outfit-empty',
  '.hero-copy > .eyebrow', '#model-heading', '.model-intro-eyebrow', '#hello-heading',
  '.model-intro-reading', '.model-intro-lead', '.model-intro-description', '.section-footer > span',
  '.album-title', '.album-cover-note', '.album-filter-tab', '.album-sort-tab', '.album-tab', '.album-group-count', '.album-empty',
  '.album-source-note', '.album-player-description', '.album-player-caption',
  '.owner-name', '.owner-bio', '.owner-contacts-heading', '.owner-contact-link', '.owner-empty',
  '.personal-eyebrow', '.personal-name', '.personal-bio', '.personal-social-label',
  '.personal-journal-heading', '.personal-journal-entry', '.personal-journal-note',
  '.personal-journal-more', '.personal-journal-title', '.personal-journal-body',
  '.personal-journal-date', '.personal-post-comments-summary',
  '.comments-heading', '.comments-note', '.comments-load-state', '.comments-label-text', '.comments-retry', '.comments-more',
  '.comments-submit', '.comments-submit-state', '.comments-count', '.comments-cancel-reply',
  '.comments-reply-target > span', '.comment-owner', '.comment-date', '.comment-reply-button', '.comment-delete-button',
  '.owner-tools-manage', '.owner-tools-logout', '.owner-tools-heading', '.owner-tools-status', '.owner-tools-save', '.owner-tools-field > span',
].join(',');

function visible(node, win, requireText = true) {
  if (!node || node.isConnected === false || requireText && !String(node.textContent || '').trim()) return false;
  if (node.closest?.('[hidden], [aria-hidden="true"], .sr-only, dialog:not([open])')) return false;
  const style = win?.getComputedStyle?.(node);
  if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)) return false;
  const rect = node.getBoundingClientRect?.();
  if (!rect) return true;
  return rect.width > 2 && rect.height > 2 && rect.bottom > 0 && rect.right > 0
    && rect.top < (win?.innerHeight || Infinity) && rect.left < (win?.innerWidth || Infinity);
}

/** Keep backgrounds, icons and native control hit areas outside the TV effect. */
function textParts(node) {
  const tag = (node.localName || node.tagName || '').toLowerCase();
  if (['input', 'select', 'textarea', 'option', 'svg', 'img'].includes(tag)) return [];
  if (!['button', 'a', 'summary'].includes(tag) && !node.querySelector?.('svg, img, input, select, textarea')) return [node];
  const parts = [];
  for (const child of Array.from(node.childNodes || [])) {
    if (child.nodeType === 3 && child.textContent.trim()) {
      const span = node.ownerDocument.createElement('span');
      span.className = 'language-text-fragment';
      child.replaceWith(span); span.append(child); parts.push(span);
    } else if (child.nodeType === 1 && !child.matches?.('svg, img, input, select, textarea, .icon, [aria-hidden="true"]')
      && !child.querySelector?.('svg, img, input, select, textarea')) parts.push(child);
  }
  return parts;
}

export function languageTextTargets(root) {
  const win = root?.ownerDocument?.defaultView;
  const candidates = Array.from(root?.querySelectorAll?.(TEXT_SELECTORS) || []).filter(node => visible(node, win)).flatMap(textParts);
  const nodes = [...new Set(candidates)].filter(node => visible(node, win));
  return nodes.filter(node => !nodes.some(parent => parent !== node && parent.contains?.(node)));
}

/** Native placeholders cannot scale independently of their input's border and value. */
function placeholderTargets(root, entries) {
  const doc = root.ownerDocument, win = doc.defaultView;
  if (!doc.createElement || !doc.body || !win?.getComputedStyle) return [];
  const fields = Array.from(root.querySelectorAll?.('input[placeholder], textarea[placeholder]') || []);
  return fields.flatMap(field => {
    if (field.value || !String(field.placeholder || '').trim() || !visible(field, win, false)) return [];
    const rect = field.getBoundingClientRect?.();
    if (!rect) return [];
    const style = win.getComputedStyle(field), placeholder = win.getComputedStyle(field, '::placeholder');
    const number = value => Number.parseFloat(value) || 0;
    const left = number(style.borderLeftWidth) + number(style.paddingLeft);
    const right = number(style.borderRightWidth) + number(style.paddingRight);
    const top = number(style.borderTopWidth) + number(style.paddingTop);
    const bottom = number(style.borderBottomWidth) + number(style.paddingBottom);
    const overlay = doc.createElement('span');
    overlay.className = 'language-placeholder-fragment';
    overlay.textContent = field.placeholder;
    overlay.setAttribute('aria-hidden', 'true');
    Object.assign(overlay.style, {
      position: 'fixed', left: `${rect.left + left}px`, top: `${rect.top + top}px`,
      width: `${Math.max(0, rect.width - left - right)}px`, maxHeight: `${Math.max(0, rect.height - top - bottom)}px`,
      fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight,
      fontStyle: style.fontStyle, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing,
      textAlign: style.textAlign, textTransform: style.textTransform, direction: style.direction,
      color: placeholder.color || style.color, opacity: placeholder.opacity || '1',
      whiteSpace: field.localName === 'textarea' ? 'pre-wrap' : 'pre', overflowWrap: style.overflowWrap || 'break-word',
    });
    const wasHidden = field.classList.contains('language-placeholder-hidden');
    field.classList.add('language-placeholder-hidden');
    (field.closest?.('dialog[open]') || doc.body).append(overlay);
    entries.push({ field, overlay, wasHidden });
    return [overlay];
  });
}

function scaleOf(style) {
  const values = String(style?.scale || '').split(/\s+/).map(Number);
  const x = Number.isFinite(values[0]) && values[0] > 0 ? values[0] : 1;
  return [x, Number.isFinite(values[1]) && values[1] > 0 ? values[1] : x];
}

export function languageTextFrames(kind = 'close', { scale = [1, 1], opacity = 1 } = {}) {
  const at = (x, y, alpha, offset) => ({ scale: `${scale[0] * x} ${scale[1] * y}`, opacity: opacity * alpha, offset });
  return kind === 'close' ? [
    at(1, 1, 1, 0), at(1.025, .25, .95, .38), at(1.08, .065, .55, .76), at(1.16, .015, 0, 1),
  ] : [
    at(1.16, .015, 0, 0), at(1.07, .18, .8, .3), at(.997, 1.025, 1, .82), at(1, 1, 1, 1),
  ];
}

/** The text swap commits once at the closed frame, then discovers the new DOM. */
export function createLanguageTransition({ root, reducedMotion = () => false, getTargets = () => languageTextTargets(root) } = {}) {
  if (!root?.ownerDocument) throw new TypeError('A language transition root is required.');
  const doc = root.ownerDocument, win = doc.defaultView;
  let operation = null, destroyed = false, phase = 'idle';
  const listeners = [];
  const reduced = () => typeof reducedMotion === 'function' ? Boolean(reducedMotion()) : Boolean(reducedMotion);
  const bind = (node, name, handler) => {
    if (!node?.addEventListener) return;
    node.addEventListener(name, handler); listeners.push(() => node.removeEventListener(name, handler));
  };
  const status = value => { phase = value; root.setAttribute?.('data-language-phase', value); };
  function release(current) {
    current.animations.splice(0).forEach(animation => animation.cancel());
    current.nodes.splice(0).forEach(({ node, motion, inline }) => {
      if (!motion) node.classList.remove('language-text-motion');
      if (!inline) node.classList.remove('language-text-motion-inline');
    });
    current.placeholders.splice(0).forEach(({ field, overlay, wasHidden }) => {
      if (!wasHidden) field.classList.remove('language-placeholder-hidden');
      overlay.remove();
    });
  }
  function commit(current) {
    if (current.committed) return;
    current.committed = true; current.commit();
  }
  function end(current, completed, commitPending = false, error) {
    if (operation !== current) return;
    operation = null;
    if (current.frame !== null) win?.cancelAnimationFrame?.(current.frame);
    release(current); status('idle');
    try { if (commitPending) commit(current); }
    catch (failure) { error = failure; }
    if (error) current.reject(error); else current.resolve(completed);
  }
  function finish() { if (operation) end(operation, true, true); }
  function cancel({ commitPending = false } = {}) { if (operation) end(operation, Boolean(commitPending), Boolean(commitPending)); }
  function monitor(current) {
    if (!win?.requestAnimationFrame || operation !== current) return;
    current.frame = win.requestAnimationFrame(() => {
      current.frame = null;
      if (operation !== current) return;
      if (doc.hidden || reduced()) finish(); else monitor(current);
    });
  }
  async function animate(current, kind, targets) {
    status(kind === 'close' ? 'collapsing' : 'expanding');
    const promises = targets.map(node => {
      const style = win?.getComputedStyle?.(node) || {};
      const entry = { node, motion: node.classList.contains('language-text-motion'), inline: node.classList.contains('language-text-motion-inline') };
      current.nodes.push(entry);
      node.classList.add('language-text-motion');
      if (style.display === 'inline') node.classList.add('language-text-motion-inline');
      const opacity = Number(style.opacity);
      const animation = node.animate(languageTextFrames(kind, { scale: scaleOf(style), opacity: Number.isFinite(opacity) ? opacity : 1 }), {
        duration: LANGUAGE_TRANSITION_TIMING[kind],
        easing: kind === 'close' ? 'cubic-bezier(.16,.7,.26,1)' : 'cubic-bezier(.3,0,.18,1)', fill: 'both',
      });
      current.animations.push(animation);
      return animation.finished.catch(() => false);
    });
    await Promise.all(promises);
  }
  async function transition(current, targets) {
    try {
      await animate(current, 'close', targets);
      if (operation !== current) return;
      release(current); commit(current);
      const next = [...new Set([...(getTargets() || []), ...placeholderTargets(root, current.placeholders)])].filter(node => node?.isConnected !== false);
      if (doc.hidden || reduced() || !next.length || next.some(node => typeof node.animate !== 'function')) { end(current, true); return; }
      await animate(current, 'open', next);
      if (operation === current) end(current, true);
    } catch (error) { end(current, false, false, error); }
  }
  function run(nextCommit) {
    if (destroyed) return Promise.resolve(false);
    if (typeof nextCommit !== 'function') throw new TypeError('A language commit callback is required.');
    cancel();
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const current = { commit: nextCommit, committed: false, animations: [], nodes: [], placeholders: [], frame: null, resolve, reject, promise };
    operation = current;
    try {
      const targets = [...new Set([...(getTargets() || []), ...(!doc.hidden && !reduced() ? placeholderTargets(root, current.placeholders) : [])])].filter(node => node?.isConnected !== false);
      if (doc.hidden || reduced() || !targets.length || targets.some(node => typeof node.animate !== 'function')) { end(current, true, true); return promise; }
      monitor(current); void transition(current, targets);
    } catch (error) { end(current, false, false, error); }
    return promise;
  }
  bind(doc, 'visibilitychange', () => { if (doc.hidden) finish(); });
  bind(win, 'resize', finish);
  bind(win, 'scroll', finish);
  bind(root, 'input', finish);
  status('idle');
  return {
    run, finish, cancel,
    get busy() { return operation !== null; },
    get phase() { return phase; },
    destroy() { if (destroyed) return; cancel(); destroyed = true; listeners.splice(0).forEach(unbind => unbind()); },
  };
}
