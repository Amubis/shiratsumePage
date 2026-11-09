const clamp = (value, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value));

export const ALBUM_SCROLL_INPUT = Object.freeze({
  distance: 300, maxDelta: 120, followDuration: 95, gestureGap: 240,
  minBuffer: 80, settleDelay: 280, snapThreshold: .6, previewLimit: .48,
  intentWindow: 420, flowDistance: 90, flowDuration: 60, flowSpeed: .55,
  reverseDistance: 48, singlePreviewLimit: .18,
  snapDuration: 820, returnDuration: 220, maxFrameStep: 64,
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
  let arrivalPending = false;
  let completedDirection = 0;
  let queuedReverse = null;
  let lastWheelAt = -Infinity;
  const requestFrame = (callback) => win.requestAnimationFrame(callback);
  const cancelFrame = () => { if (frame !== null) win.cancelAnimationFrame(frame); frame = null; };
  const eased = (value) => 1 - (1 - clamp(value)) ** 3;
  const smooth = (value) => { const t = clamp(value); return t * t * (3 - 2 * t); };
  const detail = (operation) => ({ kind: operation.kind, direction: operation.direction, from: operation.start, to: operation.end });
  const threshold = (operation) => ALBUM_SCROLL_HANDOFF[operation.kind];
  const routeFor = (from, destination, delta) => {
    if (!Number.isInteger(from) || !Number.isInteger(destination) || Math.abs(destination - from) !== 1) return null;
    const direction = Math.sign(destination - from);
    const kind = destination === 2 ? 'enter' : from === 2 ? 'exit' : null;
    return kind && Math.sign(delta) === direction ? { kind, direction, start: from, end: destination } : null;
  };
  const sameRoute = (a, b) => a && b && a.start === b.start && a.end === b.end;
  function intentFor(samples, timestamp) {
    const recent = samples.filter(sample => timestamp - sample.time <= ALBUM_SCROLL_INPUT.intentWindow);
    const distance = recent.reduce((sum, sample) => sum + sample.amount, 0);
    const duration = recent.length > 1 ? recent.at(-1).time - recent[0].time : 0;
    const speed = duration > 0 ? distance / duration : 0;
    const confirmed = recent.length >= 2 && (distance >= ALBUM_SCROLL_INPUT.distance * ALBUM_SCROLL_INPUT.snapThreshold
      || (distance >= ALBUM_SCROLL_INPUT.flowDistance && duration >= ALBUM_SCROLL_INPUT.flowDuration && speed >= ALBUM_SCROLL_INPUT.flowSpeed));
    return { samples: recent, distance, duration, confirmed };
  }
  function addSample(samples, amount, timestamp) {
    samples.push({ amount: clamp(amount, 0, ALBUM_SCROLL_INPUT.maxDelta), time: timestamp });
    return intentFor(samples, timestamp);
  }
  function trackReversal(route, amount, timestamp) {
    if (!sameRoute(queuedReverse, route)) queuedReverse = { ...route, samples: [] };
    const intent = addSample(queuedReverse.samples, amount, timestamp);
    queuedReverse.samples = intent.samples;
    queuedReverse.confirmed = intent.confirmed;
    queuedReverse.clear = intent.distance >= ALBUM_SCROLL_INPUT.reverseDistance
      && (intent.samples.length >= 2 || amount >= 80);
    return queuedReverse.clear;
  }
  function updateIntent(operation, timestamp) {
    const intent = intentFor(operation.samples, timestamp);
    operation.samples = intent.samples;
    operation.intent = intent.distance / ALBUM_SCROLL_INPUT.distance;
    operation.confirmed = intent.confirmed;
    const limit = intent.samples.length < 2 ? ALBUM_SCROLL_INPUT.singlePreviewLimit : ALBUM_SCROLL_INPUT.previewLimit;
    operation.target = Math.min(intent.distance / (ALBUM_SCROLL_INPUT.distance * ALBUM_SCROLL_INPUT.snapThreshold), 1) * ALBUM_SCROLL_INPUT.previewLimit;
    operation.target = Math.min(operation.target, limit);
  }
  function startOperation(route, timestamp, samples = []) {
    serial += 1;
    active = { ...route, current: route.start, progress: 0, intent: 0, target: 0, origin: 0,
      createdAt: samples[0]?.time ?? timestamp, startedAt: timestamp, mode: 'buffer', jumping: false,
      waveStarted: route.kind !== 'exit', exitController: null, samples: [...samples], confirmed: false };
    updateIntent(active, timestamp);
    paint(active);
    if (frame === null) frame = requestFrame(tick);
    return active;
  }
  function resumeReversal() {
    const queued = queuedReverse;
    if (!queued?.clear || (!queued.confirmed && now() - queued.samples.at(-1).time > ALBUM_SCROLL_INPUT.intentWindow)) return;
    queuedReverse = null;
    cooling = false;
    // A confirmed opposite gesture survives the paper performance, without
    // making its visitor repeat the same intent after the final paper lands.
    const timestamp = now();
    const shift = timestamp - queued.samples.at(-1).time;
    const operation = startOperation(queued, timestamp, queued.samples.map(sample => ({ ...sample, time: sample.time + shift })));
    // This gesture was already confirmed while the papers were arriving.
    // Start its withdrawal now rather than imposing another preview/frame wait.
    if (queued.confirmed) settle(operation, 1, timestamp);
  }
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
    arrivalPending = false;
    completedDirection = 0;
    queuedReverse = null;
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
    cooling = operation.progress === 1;
    lastWheelAt = now();
    if (operation.progress === 1) {
      completedDirection = operation.direction;
      // The wave settles before the papers arrive. Await that separate
      // performance so a trailing wheel packet cannot immediately withdraw it.
      let arrival;
      try { arrival = onComplete(detail(operation)); }
      catch { return; }
      if (arrival && typeof arrival.then === 'function') {
        arrivalPending = true;
        const generation = serial;
        const release = () => {
          if (destroyed || serial !== generation) return;
          arrivalPending = false;
          resumeReversal();
        };
        Promise.resolve(arrival).then(release, release);
      } else resumeReversal();
    } else { queuedReverse = null; transition.cancel(); }
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
      const intent = operation.confirmed;
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

  function wheel({ delta, from, destination, timeStamp } = {}) {
    if (destroyed) return false;
    delta = Number(delta);
    if (!Number.isFinite(delta) || delta === 0) return false;
    if (reducedMotion()) { if (active || arrivalPending) cancel(); return false; }
    const time = now();
    // Queued native events retain the visitor's timing even when a busy frame
    // delays their handlers. Older epoch-based timestamps fall back safely.
    const inputAt = Number.isFinite(timeStamp) && timeStamp >= Math.max(0, time - 2000) && timeStamp <= time + 1 ? timeStamp : time;
    const route = routeFor(from, destination, delta);
    const amount = Math.min(Math.abs(delta), ALBUM_SCROLL_INPUT.maxDelta);
    if (cooling) {
      const gap = time - lastWheelAt;
      // Native reading in a tall final chapter must not be trapped behind an
      // album gesture, even while a decorative arrival is still running.
      if (destination === null) return false;
      lastWheelAt = time;
      if (route && route.direction !== completedDirection) {
        if (trackReversal(route, amount, inputAt) && !arrivalPending) resumeReversal();
        return true;
      }
      queuedReverse = null;
      if (arrivalPending || (Math.sign(delta) === completedDirection && gap < ALBUM_SCROLL_INPUT.gestureGap)) return true;
      cooling = false;
    }
    if (!active) {
      if (!route) return false;
      startOperation(route, time);
    }
    lastWheelAt = time;
    const operation = active;
    // Finish a committed wave on its own clock. A clear reversal after its
    // handoff may queue the next route; it cannot fast-forward the current one.
    if (operation.mode === 'snap' || operation.mode === 'pre-exit') {
      if (route && from === operation.end && route.direction !== operation.direction) trackReversal(route, amount, inputAt);
      else queuedReverse = null;
      return true;
    }
    if (Math.sign(delta) !== operation.direction) {
      const oppositeRoute = route || { kind: null, direction: Math.sign(delta), start: from, end: destination };
      if (trackReversal(oppositeRoute, amount, inputAt)) {
        const samples = queuedReverse.samples;
        cancel();
        if (!route) return false;
        startOperation(route, time, samples);
        lastWheelAt = time;
        return true;
      }
      // Small direction noise reduces the preview without borrowing a debt
      // that a deliberate opposite gesture must later scroll back through.
      let remaining = amount;
      for (let index = operation.samples.length - 1; index >= 0 && remaining > 0; index--) {
        const sample = operation.samples[index];
        const remove = Math.min(sample.amount, remaining);
        sample.amount -= remove; remaining -= remove;
      }
    } else {
      queuedReverse = null;
      addSample(operation.samples, amount, inputAt);
    }
    if (operation.mode === 'return') operation.mode = 'buffer';
    operation.origin = operation.progress;
    updateIntent(operation, inputAt);
    operation.startedAt = time;
    if (frame === null) frame = requestFrame(tick);
    return true;
  }

  return {
    wheel, cancel,
    get busy() { return active !== null || arrivalPending; },
    get isArriving() { return arrivalPending; },
    get isHandoff() { return Boolean(active?.jumping); },
    get progress() { return active?.progress ?? null; },
    get kind() { return active?.kind ?? null; },
    destroy() { if (destroyed) return; cancel(); destroyed = true; },
  };
}
