const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const mix = (a, b, amount) => a + (b - a) * amount;

export const OUTFIT_RAIL_FEEDBACK_TIMING = Object.freeze({ press: 125, release: 540 });

/** Visual offsets only: hit areas and the magnetic rail keep their original coordinates. */
export function outfitRailRipplePose(center, count, amount = 0) {
  const focus = Math.max(0, Math.min(Math.max(0, count - 1), Number(center) || 0));
  return {
    dots: Array.from({ length: count }, (_, index) => {
      const distance = focus - index;
      const influence = Math.exp(-Math.abs(distance) * .9);
      return { x: -Math.sign(distance) * 5 * influence * amount || 0, scale: 1 + .18 * influence * amount };
    }),
    clover: 1 + .18 * amount,
  };
}

function interpolatePose(from, to, amount) {
  return {
    dots: from.dots.map((dot, index) => ({ x: mix(dot.x, to.dots[index].x, amount), scale: mix(dot.scale, to.dots[index].scale, amount) })),
    clover: mix(from.clover, to.clover, amount),
  };
}

/** Restart each stroke from its visible pose, including a new press during a rebound. */
export function outfitRailFeedbackPose(progress, { from, center, count, phase = 'release' }) {
  const t = clamp(progress);
  const stops = phase === 'press'
    ? [{ at: 0, pose: from }, { at: 1, pose: outfitRailRipplePose(center, count, -1) }]
    : [{ at: 0, pose: from }, { at: .35, pose: outfitRailRipplePose(center, count, 1.05) }, { at: .72, pose: outfitRailRipplePose(center, count, -.13) }, { at: 1, pose: outfitRailRipplePose(center, count) }];
  const end = stops.findIndex(stop => stop.at >= t);
  if (end <= 0) return from;
  const a = stops[end - 1], b = stops[end];
  const local = (t - a.at) / (b.at - a.at);
  return interpolatePose(a.pose, b.pose, phase === 'press' ? 1 - (1 - local) ** 3 : smooth(local));
}

/** Separate ink wrappers let press/ripple feedback compose with the rolling clover. */
export function createOutfitRailFeedback({ root, buttons, circles, clover, pickIndex, isEnabled = () => true, reducedMotion = () => false } = {}) {
  if (!root?.ownerDocument || !buttons?.length || circles?.length !== buttons.length || !clover) throw new TypeError('An outfit rail and matching visual nodes are required.');
  const doc = root.ownerDocument, win = doc.defaultView;
  const listeners = [], handled = new WeakSet();
  const neutral = () => outfitRailRipplePose(0, buttons.length);
  let pose = neutral(), stroke = null, frame = null, held = null, activeOwner = null, releasedClick = null, destroyed = false;
  const reduce = () => typeof reducedMotion === 'function' ? Boolean(reducedMotion()) : Boolean(reducedMotion);
  const bind = (target, type, handler) => {
    if (!target?.addEventListener) return;
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener(type, handler));
  };
  function paint(next) {
    pose = next;
    circles.forEach((circle, index) => {
      circle.style.setProperty('--outfit-feedback-x', `${Number(next.dots[index].x.toFixed(4))}px`);
      circle.style.setProperty('--outfit-feedback-scale', String(Number(next.dots[index].scale.toFixed(5))));
    });
    clover.style.setProperty('--outfit-feedback-scale', String(Number(next.clover.toFixed(5))));
  }
  function stop() { if (frame !== null) win?.cancelAnimationFrame?.(frame); frame = null; stroke = null; }
  function cancel() { stop(); held = activeOwner = releasedClick = null; paint(neutral()); }
  function tick(time) {
    frame = null;
    if (destroyed || !stroke) return;
    if (reduce() || doc.hidden || !isEnabled()) { cancel(); return; }
    stroke.startedAt ??= time;
    const progress = clamp((time - stroke.startedAt) / OUTFIT_RAIL_FEEDBACK_TIMING[stroke.phase]);
    paint(outfitRailFeedbackPose(progress, { ...stroke, count: buttons.length }));
    if (progress < 1) frame = win.requestAnimationFrame(tick);
    else {
      const completed = stroke;
      stroke = null;
      if (completed.phase === 'press' && !held) animate('release', completed.center);
    }
  }
  function animate(phase, center) {
    stop();
    if (reduce() || doc.hidden || !isEnabled() || !win?.requestAnimationFrame) { paint(neutral()); return; }
    stroke = { phase, center, from: pose, startedAt: null };
    frame = win.requestAnimationFrame(tick);
  }
  function indexFor(event, fallback) {
    if (Number.isFinite(event.clientX) && (event.type !== 'click' || event.detail) && typeof pickIndex === 'function') return pickIndex(event.clientX);
    return fallback;
  }
  function valid(index) { return !destroyed && isEnabled() && Number.isInteger(index) && index >= 0 && index < buttons.length && !buttons[index].disabled; }
  function handleOnce(event) { if (handled.has(event)) return false; handled.add(event); return true; }
  function press(event, index, owner, key = null) {
    if (!valid(index) || (event.button ?? 0) !== 0 || event.isPrimary === false || event.repeat || !handleOnce(event)) return;
    held = { index, owner, pointerId: key ? null : event.pointerId, key };
    activeOwner = owner;
    releasedClick = null;
    animate('press', index);
  }
  function release(event) {
    if (!held || !handleOnce(event)) return;
    if (held.key ? event.key !== held.key : event.pointerId !== undefined && held.pointerId !== undefined && event.pointerId !== held.pointerId) return;
    const { index, key, clicked } = held;
    held = null; releasedClick = clicked ? null : key ? 'keyboard' : 'pointer';
    animate('release', index);
  }
  function bindInput(node, index = null) {
    bind(node, 'pointerdown', event => press(event, indexFor(event, index), node));
    bind(node, 'pointerup', release);
    bind(node, 'pointercancel', cancel);
    bind(node, 'lostpointercapture', () => { if (held?.owner === node) cancel(); });
    bind(node, 'click', event => {
      if (!handleOnce(event)) return;
      if (held) { held.clicked = true; return; } // Native Enter clicks before keyup.
      if (releasedClick) {
        const duplicate = releasedClick === 'pointer' ? Boolean(event.detail) : !event.detail;
        releasedClick = null;
        if (duplicate) return;
      }
      const target = indexFor(event, index);
      if (valid(target)) { activeOwner = node; animate('press', target); }
    });
    if (index === null) return;
    bind(node, 'keydown', event => { if ([' ', 'Spacebar', 'Enter'].includes(event.key)) press(event, index, node, event.key); });
    bind(node, 'keyup', release);
    bind(node, 'blur', () => { if (activeOwner === node) cancel(); });
  }
  buttons.forEach((button, index) => bindInput(button, index));
  bindInput(root);
  bind(win, 'pointerup', release);
  bind(win, 'pointercancel', cancel);
  bind(win, 'blur', cancel);
  bind(win, 'pagehide', cancel);
  bind(doc, 'visibilitychange', () => { if (doc.hidden) cancel(); });
  const media = win?.matchMedia?.('(prefers-reduced-motion: reduce)');
  bind(media, 'change', () => { if (media.matches || reduce()) cancel(); });
  paint(pose);
  return {
    cancel,
    destroy() { if (destroyed) return; cancel(); destroyed = true; listeners.splice(0).forEach(dispose => dispose()); },
  };
}
