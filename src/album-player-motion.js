const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export const ALBUM_PLAYER_TIMING = Object.freeze({ charge: 120, open: 600, close: 180 });

/** One spring rises from the clicked print, turns beyond its rest angle, then settles. */
export function albumPlayerOpenFrames({ sourceRect, dialogRect } = {}) {
  const target = dialogRect || { left: 0, top: 0, width: 1000, height: 700 };
  const source = sourceRect || target;
  const dx = source.left + source.width / 2 - target.left - target.width / 2;
  const dy = source.top + source.height / 2 - target.top - target.height / 2;
  const scale = clamp(Math.min(source.width / Math.max(1, target.width), source.height / Math.max(1, target.height)), .16, .55);
  return [
    { opacity: 0, transform: `perspective(1400px) translate(${dx.toFixed(2)}px,${(dy + 8).toFixed(2)}px) scale(${scale.toFixed(4)}) rotateY(-76deg) rotateZ(-3deg)`, offset: 0 },
    { opacity: 1, transform: 'perspective(1400px) translate(0px,-22px) scale(1.035) rotateY(7deg) rotateZ(.7deg)', offset: .68 },
    { opacity: 1, transform: 'perspective(1400px) translate(0px,4px) scale(.995) rotateY(-1.5deg) rotateZ(-.2deg)', offset: .88 },
    { opacity: 1, transform: 'none', offset: 1 },
  ];
}

/** Native dialog supplies the focus trap; this controller owns decoration only. */
export function createAlbumPlayerMotion({ dialog, reducedMotion = () => false } = {}) {
  if (!dialog?.ownerDocument) throw new TypeError('A photo player dialog is required.');
  const doc = dialog.ownerDocument;
  const win = doc.defaultView;
  const classes = ['album-player-motion-charging', 'album-player-motion-opening', 'album-player-motion-closing'];
  const bindings = [];
  let operation = null;
  let destroyed = false;
  const instant = () => Boolean(reducedMotion() || doc.hidden || typeof dialog.animate !== 'function');
  const bind = (target, name, handler) => { target.addEventListener(name, handler); bindings.push(() => target.removeEventListener(name, handler)); };
  const defaultHide = () => { if (dialog.open) dialog.close(); };
  function clean(current) {
    current.animations.forEach((animation) => animation.cancel());
    current.source?.classList.remove('album-photo-charging');
    classes.forEach((name) => dialog.classList.remove(name));
    if (current.backdropStyle) {
      const [value, priority] = current.backdropStyle;
      if (value) dialog.style.setProperty('--album-player-backdrop-from', value, priority);
      else dialog.style.removeProperty('--album-player-backdrop-from');
    }
  }
  function end(current, completed, error) {
    if (operation !== current) return;
    operation = null;
    clean(current);
    if (completed && current.kind === 'close') {
      try { current.hide(); } catch (failure) { current.reject(failure); return; }
    }
    if (error) current.reject(error); else current.resolve(completed);
  }
  function begin(kind, properties = {}) {
    if (operation) end(operation, false);
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const current = { kind, phase: kind, animations: [], resolve, reject, promise, ...properties };
    operation = current;
    return current;
  }
  function play(current, node, frames, options, done) {
    let animation;
    try {
      animation = node.animate(frames, { ...options, fill: 'both' });
      current.animations.push(animation);
    } catch (error) { end(current, false, error); return; }
    animation.finished.then(() => { if (operation === current) done(); }).catch(() => {
      if (operation === current) end(current, false);
    });
  }
  function open({ source, image, show } = {}) {
    if (destroyed) return Promise.resolve(false);
    const alreadyOpen = dialog.open;
    const current = begin('open', { source });
    const showPlayer = typeof show === 'function' ? show : () => { if (!dialog.open) dialog.showModal(); };
    const bounds = image?.getBoundingClientRect?.() || source?.getBoundingClientRect?.();
    // Reserve the top layer immediately with a transparent dialog. The print
    // below remains visible while charging, and a wheel cannot turn chapters.
    if (!instant() && !alreadyOpen) dialog.classList.add('album-player-motion-charging');
    try { showPlayer(); }
    catch (error) { end(current, false, error); defaultHide(); return current.promise; }
    if (operation !== current) return current.promise;
    if (instant() || alreadyOpen) { end(current, true); return current.promise; }
    function reveal() {
      if (operation !== current) return;
      if (instant()) { end(current, true); return; }
      current.phase = 'revealing';
      dialog.classList.remove('album-player-motion-charging');
      dialog.classList.add('album-player-motion-opening');
      play(current, dialog, albumPlayerOpenFrames({ sourceRect: bounds, dialogRect: dialog.getBoundingClientRect() }),
        { duration: ALBUM_PLAYER_TIMING.open, easing: 'cubic-bezier(.18,.7,.25,1)' }, () => end(current, true));
    }
    if (!source?.animate) { reveal(); return current.promise; }
    current.phase = 'charging';
    source.classList.add('album-photo-charging');
    // Individual scale composes with the card's inspection tilt and rotation.
    play(current, source, [{ scale: 1 }, { scale: .94 }],
      { duration: ALBUM_PLAYER_TIMING.charge, easing: 'cubic-bezier(.4,0,.65,1)' }, () => {
        if (operation !== current) return;
        current.animations.forEach((animation) => animation.cancel());
        current.animations = [];
        source.classList.remove('album-photo-charging');
        reveal();
      });
    return current.promise;
  }
  function close({ hide = defaultHide } = {}) {
    if (destroyed) return Promise.resolve(false);
    const charging = operation?.kind === 'open' && operation.phase === 'charging';
    if (!dialog.open || charging || instant()) {
      const current = begin('close', { hide });
      end(current, true); return current.promise;
    }
    const style = win.getComputedStyle(dialog);
    const opacity = Number(style.opacity);
    const transform = style.transform || 'none';
    const backdropOpacity = win.getComputedStyle(dialog, '::backdrop').opacity || '1';
    const current = begin('close', { hide });
    current.backdropStyle = [dialog.style.getPropertyValue('--album-player-backdrop-from'), dialog.style.getPropertyPriority('--album-player-backdrop-from')];
    dialog.style.setProperty('--album-player-backdrop-from', backdropOpacity);
    dialog.classList.add('album-player-motion-closing');
    // Even if interrupted mid-flip, exit keeps that exact pose and only fades.
    play(current, dialog, [{ opacity: Number.isFinite(opacity) ? opacity : 1, transform }, { opacity: 0, transform }],
      { duration: ALBUM_PLAYER_TIMING.close, easing: 'ease-out' }, () => end(current, true));
    return current.promise;
  }
  function cancel({ hide } = {}) {
    if (operation) end(operation, false);
    if (typeof hide === 'function') hide();
  }
  function settle() { if (operation) end(operation, true); }
  bind(win, 'resize', settle);
  bind(doc, 'visibilitychange', () => { if (doc.hidden) settle(); });
  bind(dialog, 'close', () => { if (operation) end(operation, false); });
  bind(dialog, 'cancel', (event) => { event.preventDefault(); void close(); });
  bind(dialog, 'keydown', (event) => { if (event.key === 'Tab' && operation?.kind === 'open') settle(); });
  return {
    open, close, cancel,
    get busy() { return operation !== null; },
    get phase() { return operation?.phase || 'idle'; },
    destroy() {
      if (destroyed) return;
      cancel({ hide: defaultHide }); destroyed = true;
      bindings.splice(0).forEach((remove) => remove());
    },
  };
}
