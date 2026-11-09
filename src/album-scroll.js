const clamp = (value, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value));

export const ALBUM_SCROLL_INPUT = Object.freeze({
  distance: 260, maxDelta: 120, followDuration: 120, gestureGap: 220,
  minBuffer: 180, settleDelay: 140, snapThreshold: .35, previewLimit: .24,
  snapDuration: 820, returnDuration: 260, maxFrameStep: 64,
});
export const ALBUM_SCROLL_HANDOFF = Object.freeze({ enter: .5, exit: .5 });

/**
 * Wheel input previews the chapter boundary, then a clear gesture snaps.
 * Leaving the album first awaits its autonomous actor exit; only then can the
 * dot timeline begin. A small or reversed gesture quietly returns.
 */
export function createAlbumScroll({ transition, navigate, reducedMotion = () => false, window: win = globalThis.window, onHandoff = () => {}, onComplete = () => {} } = {}) {
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
  const smooth = (value) => { const t = clamp(value); return t * t * (3 - 2 * t); };
  const detail = (operation) => ({ kind: operation.kind, direction: operation.direction, from: operation.start, to: operation.end });
  const threshold = (operation) => ALBUM_SCROLL_HANDOFF[operation.kind];
  const desiredChapter = (operation) => operation.progress >= threshold(operation) ? operation.end : operation.start;
  const paint = (operation) => {
    const options = detail(operation);
    if (operation.kind === 'exit' && !operation.waveStarted) {
      transition.previewExit?.(operation.progress, options);
      return;
    }
    if (typeof transition.seekBoundary === 'function') transition.seekBoundary(operation.progress, options);
    else transition[operation.kind === 'enter' ? 'seekEnter' : 'seekExit'](operation.progress, options);
  };

  function cancel() {
    const previous = active;
    serial += 1;
    cancelFrame();
    active = null;
    cooling = false;
    lastWheelAt = -Infinity;
    previous?.exitController?.abort();
    if (previous?.kind === 'exit') transition.previewExit?.(0, detail(previous));
    transition.cancel();
  }

  function completeIfAtEnd(operation) {
    if (active !== operation || operation.jumping || ![0, 1].includes(operation.progress)) return;
    if (operation.progress === 0 ? operation.mode !== 'return' : operation.mode !== 'snap') return;
    if (operation.current !== desiredChapter(operation)) return;
    cancelFrame();
    active = null;
    cooling = true;
    lastWheelAt = now();
    if (operation.progress === 1) onComplete(detail(operation));
    else transition.cancel();
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
    // A slow layout or navigation must not consume the incoming reveal while
    // the old chapter is still under the cover. Resume from this boundary only
    // after the destination has actually arrived.
    operation.progress = threshold(operation);
    const generation = serial;
    transition.holdCover();
    let result;
    try {
      onHandoff({ ...detail(operation), from: operation.current, to: targetChapter, progress: operation.progress });
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
      operation.origin = operation.progress;
      operation.startedAt = now();
      operation.duration = ALBUM_SCROLL_INPUT.snapDuration * (1 - operation.progress);
      operation.elapsed = 0;
      operation.lastFrameAt = operation.startedAt;
      reconcile(operation);
      if (active === operation && frame === null) frame = requestFrame(tick);
    }, () => {
      if (active === operation && serial === generation) cancel();
    });
  }

  function prepareExit(operation) {
    operation.mode = 'pre-exit';
    operation.progress = 0;
    transition.previewExit?.(0, detail(operation));
    const generation = serial;
    const controller = new AbortController();
    operation.exitController = controller;
    let result;
    try { result = transition.beforeExit?.(detail(operation), { signal: controller.signal }); }
    catch { cancel(); return; }
    Promise.resolve(result).then((completed) => {
      if (destroyed || active !== operation || serial !== generation) return;
      if (completed === false || reducedMotion()) { cancel(); return; }
      operation.exitController = null;
      operation.waveStarted = true;
      // Time spent withdrawing paper never consumes the visible dot wave.
      settle(operation, 1, now());
      paint(operation);
      if (frame === null) frame = requestFrame(tick);
    }, () => {
      if (active === operation && serial === generation) cancel();
    });
  }

  function settle(operation, destination, timestamp) {
    if (destination === 1 && operation.kind === 'exit' && !operation.waveStarted) {
      prepareExit(operation);
      return;
    }
    operation.mode = destination === 1 ? 'snap' : 'return';
    operation.origin = operation.progress;
    operation.target = destination;
    operation.startedAt = timestamp;
    operation.duration = destination === 1 ? ALBUM_SCROLL_INPUT.snapDuration : ALBUM_SCROLL_INPUT.returnDuration;
    operation.elapsed = 0;
    operation.lastFrameAt = timestamp;
  }

  function tick(timestamp) {
    frame = null;
    const operation = active;
    if (!operation || destroyed) return;
    if (reducedMotion()) { cancel(); return; }
    if (operation.mode === 'pre-exit') return;
    if (operation.mode === 'buffer') {
      const amount = clamp((timestamp - operation.startedAt) / ALBUM_SCROLL_INPUT.followDuration);
      operation.progress = amount >= 1 ? operation.target : operation.origin + (operation.target - operation.origin) * eased(amount);
      reconcile(operation);
      if (active !== operation) return;
      const intent = operation.intent >= ALBUM_SCROLL_INPUT.snapThreshold;
      const quiet = timestamp - lastWheelAt >= ALBUM_SCROLL_INPUT.settleDelay;
      if (timestamp - operation.createdAt >= ALBUM_SCROLL_INPUT.minBuffer && (intent || quiet)) settle(operation, intent ? 1 : 0, timestamp);
      if (active !== operation || operation.mode === 'pre-exit') return;
    } else {
      // Keep several real painted steps even if an expensive composite delays
      // a frame. A single late frame cannot skip the whole dot reveal.
      operation.elapsed += clamp(timestamp - operation.lastFrameAt, 0, ALBUM_SCROLL_INPUT.maxFrameStep);
      operation.lastFrameAt = timestamp;
      const amount = clamp(operation.elapsed / operation.duration);
      operation.progress = amount >= 1 ? operation.target : operation.origin + (operation.target - operation.origin) * smooth(amount);
      reconcile(operation);
      if (active !== operation || operation.jumping) return;
      if (amount >= 1) return;
    }
    if (active === operation) frame = requestFrame(tick);
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
      const adjacent = Number.isInteger(from) && Number.isInteger(destination) && Math.abs(destination - from) === 1;
      const direction = Math.sign(destination - from);
      const kind = adjacent && destination === 2 ? 'enter' : adjacent && from === 2 ? 'exit' : null;
      if (!kind || Math.sign(delta) !== direction) return false;
      serial += 1;
      active = { kind, direction, start: from, end: destination, current: from, progress: 0, intent: 0, target: 0, origin: 0, createdAt: time, startedAt: time, mode: 'buffer', jumping: false, waveStarted: kind !== 'exit', exitController: null };
      paint(active);
    }
    lastWheelAt = time;
    const operation = active;
    // Once the intent has snapped, wheel inertia cannot undo it or start a
    // second chapter. Before that point, opposite input reduces the preview.
    if (operation.mode === 'snap' || operation.mode === 'pre-exit') return true;
    if (operation.mode === 'return') {
      operation.mode = 'buffer';
      operation.createdAt = time;
      operation.intent = operation.progress;
    }
    operation.origin = operation.progress;
    operation.intent = clamp(operation.intent + clamp(delta * operation.direction, -ALBUM_SCROLL_INPUT.maxDelta, ALBUM_SCROLL_INPUT.maxDelta) / ALBUM_SCROLL_INPUT.distance);
    // A coarse mouse notch can signal a turn without visually jumping to the
    // covered midpoint. The remaining wave always receives its full duration.
    operation.target = Math.min(operation.intent, ALBUM_SCROLL_INPUT.previewLimit);
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
