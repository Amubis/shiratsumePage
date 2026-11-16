export const ALBUM_PAGE_MOTION_TIMING = Object.freeze({ peel: 200, stick: 260, stagger: 20, spread: 90 });

/** A print peels from its top edge; the inner card keeps its inspection pose. */
export function albumPagePhotoFrames(kind = 'stick', rest = 'none') {
  const base = rest && rest !== 'none' ? `${rest} ` : '';
  const at = (transform, opacity, offset) => ({ transform: transform ? `${base}perspective(850px) ${transform}` : rest, opacity, offset, transformOrigin: '50% 0%' });
  return kind === 'peel' ? [
    at('', 1, 0),
    at('translateY(-2px) rotateX(12deg) rotateZ(-1deg)', 1, .26),
    at('translateY(-14px) rotateX(28deg) rotateY(-7deg) rotateZ(-2deg)', 1, .68),
    at('translate(-4px,-48px) rotateX(52deg) rotateY(-12deg) scale(.96)', 0, 1),
  ] : [
    at('translateY(-18px) rotateX(-28deg) scale(1.04)', 0, 0),
    at('translateY(3px) rotateX(5deg) scale(.99)', 1, .48),
    at('translateY(-1px) rotateX(-2deg) scale(1.006)', 1, .78),
    at('', 1, 1),
  ];
}

/** Bound the total wait even for the densest twelve-photo page. */
export function albumPagePhotoDelay(index, count) {
  return Math.max(0, index) * Math.min(ALBUM_PAGE_MOTION_TIMING.stagger, ALBUM_PAGE_MOTION_TIMING.spread / Math.max(1, count - 1));
}

/** Owns page-change prints only. Chapter paper entrance has a separate clock. */
export function createAlbumPageMotion({ root, reducedMotion = () => false, isActive = () => true } = {}) {
  if (!root?.ownerDocument) throw new TypeError('An album page root is required.');
  const doc = root.ownerDocument, win = doc.defaultView;
  const bindings = [];
  const previousBusy = root.getAttribute?.('aria-busy');
  let operation = null, destroyed = false, state = 'idle';
  const reduced = () => typeof reducedMotion === 'function' ? Boolean(reducedMotion()) : Boolean(reducedMotion);
  const active = () => typeof isActive === 'function' ? Boolean(isActive()) : Boolean(isActive);
  const photos = () => Array.from(root.querySelectorAll?.('.album-photo') || []);
  const canAnimate = nodes => !destroyed && !doc.hidden && !reduced() && active() && nodes.length > 0 && nodes.every(node => typeof node.animate === 'function');
  const bind = (target, event, handler) => {
    if (!target?.addEventListener) return;
    target.addEventListener(event, handler); bindings.push(() => target.removeEventListener(event, handler));
  };
  function status(value) { state = value; root.setAttribute?.('data-page-motion', value); }
  function restoreBusy() {
    if (previousBusy === null || previousBusy === undefined) {
      if (root.removeAttribute) root.removeAttribute('aria-busy'); else root.setAttribute?.('aria-busy', 'false');
    } else root.setAttribute?.('aria-busy', previousBusy);
  }
  function clearAnimations(current) {
    current.animations.splice(0).forEach(animation => animation.cancel());
  }
  function commit(current) {
    if (current.committed) return;
    current.committed = true;
    current.commit();
  }
  function finish(current, completed, commitPending = false) {
    if (operation !== current) return;
    operation = null;
    if (current.frame !== null) win?.cancelAnimationFrame?.(current.frame);
    clearAnimations(current); restoreBusy(); status('idle');
    try { if (commitPending) commit(current); current.resolve(completed); }
    catch (error) { current.reject(error); }
  }
  function monitor(current) {
    if (operation !== current || !win?.requestAnimationFrame) return;
    current.frame = win.requestAnimationFrame(() => {
      current.frame = null;
      if (operation !== current) return;
      if (!active() || reduced() || doc.hidden) finish(current, true, true);
      else monitor(current);
    });
  }
  function batch(current, nodes, kind) {
    status(kind === 'peel' ? 'peeling' : 'sticking');
    const promises = nodes.map((node, index) => {
      const rest = win?.getComputedStyle?.(node)?.transform || 'none';
      const animation = node.animate(albumPagePhotoFrames(kind, rest), {
        duration: ALBUM_PAGE_MOTION_TIMING[kind], delay: albumPagePhotoDelay(index, nodes.length),
        easing: kind === 'peel' ? 'cubic-bezier(.4,0,.62,1)' : 'cubic-bezier(.2,.7,.3,1)', fill: 'both',
      });
      current.animations.push(animation);
      return animation.finished.catch(() => false);
    });
    return Promise.all(promises);
  }
  async function transition(current, oldPhotos) {
    try {
      await batch(current, oldPhotos, 'peel');
      if (operation !== current) return;
      // Keep the old fill in place until the synchronous DOM commit. Releasing
      // it before replacement could briefly show the old prints again.
      commit(current);
      clearAnimations(current);
      const nextPhotos = photos();
      if (!canAnimate(nextPhotos)) { finish(current, true); return; }
      await batch(current, nextPhotos, 'stick');
      if (operation === current) finish(current, true);
    } catch (error) {
      if (operation !== current) return;
      // A missing animation API must never discard a requested page change.
      finish(current, true, true);
    }
  }
  function cancel({ commitPending = true } = {}) {
    if (operation) finish(operation, Boolean(commitPending), Boolean(commitPending));
  }
  function run(nextCommit) {
    if (destroyed) return Promise.resolve(false);
    if (typeof nextCommit !== 'function') throw new TypeError('A synchronous page commit is required.');
    cancel({ commitPending: false });
    const oldPhotos = photos();
    if (!canAnimate(oldPhotos)) { nextCommit(); return Promise.resolve(true); }
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const current = { commit: nextCommit, committed: false, animations: [], frame: null, resolve, reject, promise };
    operation = current; root.setAttribute?.('aria-busy', 'true');
    monitor(current); void transition(current, oldPhotos);
    return promise;
  }
  const settleIfNeeded = () => { if (operation && (doc.hidden || reduced() || !active())) cancel(); };
  bind(doc, 'visibilitychange', settleIfNeeded);
  bind(win, 'pagehide', () => cancel());
  const media = win?.matchMedia?.('(prefers-reduced-motion: reduce)');
  bind(media, 'change', settleIfNeeded);
  status('idle');
  return {
    run, cancel, refresh: settleIfNeeded,
    get busy() { return Boolean(operation); },
    get state() { return state; },
    destroy() {
      if (destroyed) return;
      cancel({ commitPending: false }); destroyed = true;
      bindings.splice(0).forEach(dispose => dispose());
      root.removeAttribute?.('data-page-motion'); restoreBusy(); state = 'destroyed';
    },
  };
}
