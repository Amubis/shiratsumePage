const clamp = (value, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value));

export const ALBUM_SCROLL_INPUT = Object.freeze({ distance: 1100, maxDelta: 150, followDuration: 90, gestureGap: 220 });
export const ALBUM_SCROLL_HANDOFF = Object.freeze({ enter: .36, exit: .62 });

/**
 * Wheel input owns the timeline. Frames only soften the latest input, never
 * finish an incomplete turn automatically. Navigation happens under a held
 * full cover, and reversing input can bring the previous chapter back.
 */
export function createAlbumScroll({ transition, navigate, reducedMotion = () => false, window: win = globalThis.window, onHandoff = () => {} } = {}) {
  if (!transition || typeof navigate !== 'function' || !win?.requestAnimationFrame) throw new TypeError('Album transition, navigation and a browser window are required.');
  const now = () => win.performance?.now?.() ?? Date.now();
  let active = null;
  let frame = null;
  let serial = 0;
  let destroyed = false;
  let cooling = false;
  let lastWheelAt = -Infinity;
  const requestFrame = (callback) => win.requestAnimationFrame(callback);
  const cancelFrame = () => { if (frame !== null) win.cancelAnimationFrame(frame); frame = null; };
  const eased = (value) => 1 - (1 - clamp(value)) ** 3;
  const threshold = (operation) => ALBUM_SCROLL_HANDOFF[operation.kind];
  const desiredChapter = (operation) => operation.progress >= threshold(operation) ? operation.end : operation.start;
  const paint = (operation) => transition[operation.kind === 'enter' ? 'seekEnter' : 'seekExit'](operation.progress);

  function cancel() {
    serial += 1;
    cancelFrame();
    active = null;
    cooling = false;
    lastWheelAt = -Infinity;
    transition.cancel();
  }

  function completeIfAtEnd(operation) {
    if (active !== operation || operation.jumping || operation.progress !== operation.target || ![0, 1].includes(operation.progress)) return;
    if (operation.current !== desiredChapter(operation)) return;
    cancelFrame();
    active = null;
    cooling = true;
    lastWheelAt = now();
  }

  function reconcile(operation) {
    if (active !== operation || operation.jumping) return;
    const targetChapter = desiredChapter(operation);
    if (operation.current === targetChapter) {
      paint(operation);
      completeIfAtEnd(operation);
      return;
    }
    operation.jumping = true;
    const generation = serial;
    transition.holdCover();
    let result;
    try {
      onHandoff({ from: operation.current, to: targetChapter, kind: operation.kind, progress: operation.progress });
      result = navigate(targetChapter);
    } catch {
      cancel();
      return;
    }
    Promise.resolve(result).then((completed) => {
      if (destroyed || active !== operation || serial !== generation) return;
      operation.jumping = false;
      if (completed === false) { cancel(); return; }
      operation.current = targetChapter;
      // Input may have crossed the handoff again while navigation was pending.
      // Keep the cover held until the actual chapter matches the latest input.
      reconcile(operation);
    }, () => {
      if (active === operation && serial === generation) cancel();
    });
  }

  function tick(timestamp) {
    frame = null;
    const operation = active;
    if (!operation || destroyed) return;
    if (reducedMotion()) { cancel(); return; }
    const amount = clamp((timestamp - operation.startedAt) / ALBUM_SCROLL_INPUT.followDuration);
    operation.progress = amount >= 1 ? operation.target : operation.origin + (operation.target - operation.origin) * eased(amount);
    reconcile(operation);
    if (active === operation && amount < 1) frame = requestFrame(tick);
  }

  function wheel({ delta, from, destination } = {}) {
    if (destroyed) return false;
    delta = Number(delta);
    if (!Number.isFinite(delta) || delta === 0) return false;
    if (reducedMotion()) { if (active) cancel(); return false; }
    const time = now();
    if (cooling) {
      const gap = time - lastWheelAt;
      lastWheelAt = time;
      if (gap < ALBUM_SCROLL_INPUT.gestureGap) return true;
      cooling = false;
    }
    if (!active) {
      const kind = from === 1 && destination === 2 && delta > 0 ? 'enter'
        : from === 2 && destination === 3 && delta > 0 ? 'exit' : null;
      if (!kind) return false;
      serial += 1;
      active = { kind, start: from, end: destination, current: from, progress: 0, target: 0, origin: 0, startedAt: time, jumping: false };
      paint(active);
    }
    lastWheelAt = time;
    const operation = active;
    operation.origin = operation.progress;
    operation.target = clamp(operation.target + clamp(delta, -ALBUM_SCROLL_INPUT.maxDelta, ALBUM_SCROLL_INPUT.maxDelta) / ALBUM_SCROLL_INPUT.distance);
    operation.startedAt = time;
    if (frame === null) frame = requestFrame(tick);
    return true;
  }

  return {
    wheel, cancel,
    get busy() { return active !== null; },
    get isHandoff() { return Boolean(active?.jumping); },
    get progress() { return active?.progress ?? null; },
    get kind() { return active?.kind ?? null; },
    destroy() { if (destroyed) return; cancel(); destroyed = true; },
  };
}
