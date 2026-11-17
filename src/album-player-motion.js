const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export const ALBUM_PLAYER_TIMING = Object.freeze({ charge: 120, open: 600, close: 180, return: 480, chrome: 130 });

/** Locate the visible bitmap when object-fit: contain leaves letterbox space. */
export function albumPlayerPictureRect(image) {
  const box = image?.getBoundingClientRect?.();
  if (!box || !(box.width > 0 && box.height > 0)) return null;
  const ratio = image.naturalWidth > 0 && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : box.width / box.height;
  const width = Math.min(box.width, box.height * ratio), height = width / ratio;
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
}

/** End at the destination print's real box, without a lingering scale or turn. */
export function albumPlayerReturnFrames({ sourceRect, targetRect } = {}) {
  const dx = targetRect.left + targetRect.width / 2 - sourceRect.left - sourceRect.width / 2;
  const dy = targetRect.top + targetRect.height / 2 - sourceRect.top - sourceRect.height / 2;
  const sx = targetRect.width / sourceRect.width, sy = targetRect.height / sourceRect.height;
  const pose = (x, y, xScale, yScale, turn, tilt) => `perspective(1400px) translate(${x.toFixed(2)}px,${y.toFixed(2)}px) scale(${xScale.toFixed(5)},${yScale.toFixed(5)}) rotateY(${turn}deg) rotateZ(${tilt}deg)`;
  return [
    { opacity: 1, transform: pose(0, 0, 1, 1, 0, 0), offset: 0 },
    { opacity: 1, transform: pose(0, -12, 1.025, 1.025, -7, -.7), offset: .17 },
    { opacity: 1, transform: pose(dx * .86, dy * .86, sx + (1 - sx) * .14, sy + (1 - sy) * .14, 67, -1.5), offset: .72 },
    { opacity: 0, transform: pose(dx, dy, sx, sy, 0, 0), offset: 1 },
  ];
}

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
export function createAlbumPlayerMotion({ dialog, reducedMotion = () => false, onRequestClose } = {}) {
  if (!dialog?.ownerDocument) throw new TypeError('A photo player dialog is required.');
  const doc = dialog.ownerDocument;
  const win = doc.defaultView;
  const classes = ['album-player-motion-charging', 'album-player-motion-opening', 'album-player-motion-closing', 'album-player-motion-returning'];
  const bindings = [];
  let operation = null;
  let destroyed = false;
  const instant = () => Boolean(reducedMotion() || doc.hidden || typeof dialog.animate !== 'function');
  const bind = (target, name, handler) => { target.addEventListener(name, handler); bindings.push(() => target.removeEventListener(name, handler)); };
  const defaultHide = () => { if (dialog.open) dialog.close(); };
  function clean(current) {
    current.animations.forEach((animation) => animation.cancel());
    current.source?.classList.remove('album-photo-charging');
    current.target?.classList.remove('album-photo-return-target');
    current.plane?.remove();
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
    if (operation !== current) return;
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
  function returnPrint(current, target, image, style) {
    if (image?.complete === false || (typeof image?.naturalWidth === 'number' && image.naturalWidth <= 0)) return false;
    const picture = albumPlayerPictureRect(image), targetRect = target?.getBoundingClientRect?.();
    const sourceURL = image?.src || image?.currentSrc;
    if (target?.isConnected === false || !targetRect || !(targetRect.width > 0 && targetRect.height > 0) || !picture || !sourceURL || !doc.createElement || !dialog.append) return false;
    if (win.getComputedStyle(target).visibility === 'hidden') return false;
    const parent = dialog.getBoundingClientRect();
    // Keep border proportions tied to the visible photograph, not the dialog
    // or the empty portion of a contain-fitted image element.
    const border = Math.min(10, picture.width * .025), foot = border * 2.5;
    const sourceRect = { left: picture.left - border, top: picture.top - border, width: picture.width + border * 2, height: picture.height + border + foot };
    const plane = doc.createElement('div'); plane.className = 'album-player-return-print'; plane.setAttribute('aria-hidden', 'true');
    for (const [name, value] of Object.entries({ left: sourceRect.left - parent.left, top: sourceRect.top - parent.top, width: sourceRect.width, height: sourceRect.height, '--return-border': border, '--return-foot': foot })) plane.style.setProperty(name, `${value}px`);
    const pictureNode = doc.createElement('img'); pictureNode.src = sourceURL; pictureNode.alt = ''; pictureNode.draggable = false;
    plane.append(pictureNode);
    current.target = target; current.plane = plane;
    current.scrollPosition = { x: win.scrollX || 0, y: win.scrollY || 0 };
    const children = Array.from(dialog.children || []);
    dialog.append(plane); target.classList.add('album-photo-return-target');
    dialog.classList.add('album-player-motion-returning');
    for (const child of children) if (typeof child.animate === 'function') play(current, child,
      [{ opacity: Number(win.getComputedStyle(child).opacity) || 1 }, { opacity: 0 }],
      { duration: ALBUM_PLAYER_TIMING.chrome, easing: 'cubic-bezier(.4,0,.6,1)' }, () => {});
    play(current, dialog, [{ backgroundColor: style.backgroundColor, boxShadow: style.boxShadow }, { backgroundColor: 'transparent', boxShadow: 'none' }],
      { duration: ALBUM_PLAYER_TIMING.chrome, easing: 'cubic-bezier(.4,0,.6,1)' }, () => {});
    if (operation !== current) return true;
    play(current, plane, albumPlayerReturnFrames({ sourceRect, targetRect }),
      { duration: ALBUM_PLAYER_TIMING.return, easing: 'cubic-bezier(.3,0,.2,1)' }, () => end(current, true));
    return true;
  }
  function close({ target, image, hide = defaultHide } = {}) {
    if (destroyed) return Promise.resolve(false);
    if (operation?.kind === 'close') return operation.promise;
    const charging = operation?.kind === 'open' && operation.phase === 'charging';
    if (!dialog.open || charging || instant()) {
      const current = begin('close', { hide });
      end(current, true); return current.promise;
    }
    const style = win.getComputedStyle(dialog);
    const opacity = Number(style.opacity);
    const transform = style.transform || 'none';
    const opening = operation?.kind === 'open';
    const backdropOpacity = win.getComputedStyle(dialog, '::backdrop').opacity || '1';
    const current = begin('close', { hide });
    current.backdropStyle = [dialog.style.getPropertyValue('--album-player-backdrop-from'), dialog.style.getPropertyPriority('--album-player-backdrop-from')];
    dialog.style.setProperty('--album-player-backdrop-from', backdropOpacity);
    dialog.classList.add('album-player-motion-closing');
    // An incomplete opening keeps its exact current pose; a settled photograph
    // can return to its newly resolved thumbnail on another album page.
    if (!opening && returnPrint(current, target, image, style)) return current.promise;
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
  bind(win, 'scroll', () => {
    const position = operation?.scrollPosition;
    if (position && ((win.scrollX || 0) !== position.x || (win.scrollY || 0) !== position.y)) settle();
  });
  bind(doc, 'visibilitychange', () => { if (doc.hidden) settle(); });
  bind(dialog, 'close', () => { if (operation) end(operation, false); });
  bind(dialog, 'cancel', (event) => { event.preventDefault(); if (typeof onRequestClose === 'function') onRequestClose(); else void close(); });
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
