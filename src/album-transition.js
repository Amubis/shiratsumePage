const SVG_NS = 'http://www.w3.org/2000/svg';
const clamp = (value, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, Number(value) || 0));
const smooth = (value) => { const t = clamp(value); return t * t * (3 - 2 * t); };

export const ALBUM_TRANSITION_TIMING = Object.freeze({ cover: 680, reveal: 620, paperBack: 380, paperMiddle: 460, paperFront: 560 });
export const ALBUM_SCROLL_PHASE = Object.freeze({ enterHandoff: .36, exitHandoff: .62 });
export const ALBUM_STATIC_RADIUS_RATIO = .54;

/** Fixed centers, with an extra row/column outside the viewport for complete cover. */
export function createAlbumCircleGrid({ width = 1440, height = 900, spacing } = {}) {
  width = Math.max(1, Number(width) || 1440);
  height = Math.max(1, Number(height) || 900);
  const pitch = Number.isFinite(spacing) && spacing > 0 ? spacing : Math.max(96, Math.min(220, width / 8));
  const columns = Math.ceil(width / pitch) + 2;
  const rows = Math.ceil(height / pitch) + 2;
  const maxRadius = pitch / Math.SQRT2 + 1;
  const circles = [];
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    circles.push({ x: (column - .5) * pitch, y: (row - .5) * pitch, row, column, maxRadius });
  }
  return { width, height, pitch, columns, rows, maxRadius, circles };
}

/** The next row starts when the preceding row is close to its first crest. */
export function albumRowProgress(progress, row, rows) {
  const duration = 1 / (1 + Math.max(0, rows - 1) * .65);
  const delay = (rows - 1 - row) * duration * .65;
  return clamp((clamp(progress) - delay) / duration);
}

export function albumCircleScale(progress, row, rows, mode = 'grow') {
  const t = albumRowProgress(progress, row, rows);
  if (mode === 'shrink') return 1 - smooth(t);
  if (t <= .65) return smooth(t / .65) * 1.035;
  if (t <= .84) return 1.035 - smooth((t - .65) / .19) * .05;
  return .985 + smooth((t - .84) / .16) * .015;
}

/** The outer photo wrapper is reserved for entrance; its inner card owns inspection. */
export function createAlbumEnterPlan(photoCount = 4) {
  const count = Math.max(0, Math.floor(Number(photoCount) || 0));
  return [
    { selector: '.album-paper.layer-back', kind: 'paper-back', delay: 0, duration: 380 },
    { selector: '.album-paper.layer-middle', kind: 'paper-middle', delay: 70, duration: 460 },
    { selector: '.album-paper.layer-front', kind: 'paper-front', delay: 130, duration: 560 },
    { selector: '.album-cover', kind: 'cover', delay: 710, duration: 550 },
    ...Array.from({ length: count }, (_, index) => ({ selector: '.album-photo', index, kind: 'photo', delay: 850 + index * 58, duration: 380 })),
    ...['.album-heading', '.album-tabs', '.album-filter-tab', '.album-group-heading', '.album-page-status', '.album-source-note'].map((selector, index) => ({ selector, kind: 'ui', delay: 920 + index * 38, duration: 260 })),
  ];
}

export function createAlbumExitPlan(photoCount = 4) {
  const count = Math.max(0, Math.floor(Number(photoCount) || 0));
  const photoEnd = Math.max(0, count - 1) * 42 + 240;
  const coverDelay = Math.max(190, photoEnd - 110);
  const paperDelay = coverDelay + 90;
  return [
    ...['.album-heading', '.album-tabs', '.album-filter-tab', '.album-group-heading', '.album-page-status', '.album-source-note'].map((selector) => ({ selector, kind: 'ui', delay: 0, duration: 180 })),
    ...Array.from({ length: count }, (_, order) => ({ selector: '.album-photo', index: count - 1 - order, kind: 'photo', delay: order * 42, duration: 240 })),
    { selector: '.album-cover', kind: 'cover', delay: coverDelay, duration: 300 },
    { selector: '.album-paper.layer-front', kind: 'paper-front', delay: paperDelay, duration: 380 },
    { selector: '.album-paper.layer-middle', kind: 'paper-middle', delay: paperDelay + 80, duration: 360 },
    { selector: '.album-paper.layer-back', kind: 'paper-back', delay: paperDelay + 160, duration: 340 },
  ];
}

const ACTORS = '.album-paper, .album-cover, .album-photo, .album-heading, .album-tabs, .album-filter-tab, .album-group-heading, .album-page-status, .album-source-note';

/** Owns only decorative transitions; navigation and data remain with their controllers. */
export function createAlbumTransition({ section, previous, reducedMotion = () => false } = {}) {
  if (!section?.ownerDocument) throw new TypeError('An album section is required.');
  const doc = section.ownerDocument;
  const win = doc.defaultView;
  const overlay = doc.createElement('div');
  overlay.className = 'album-transition-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.setAttribute('inert', '');
  overlay.inert = true;
  overlay.hidden = true;
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('preserveAspectRatio', 'none');
  overlay.append(svg);
  (doc.body || doc.documentElement).append(overlay);
  const field = doc.createElement('div');
  field.className = 'album-static-field';
  field.setAttribute('aria-hidden', 'true');
  const fieldSVG = doc.createElementNS(SVG_NS, 'svg');
  fieldSVG.setAttribute('preserveAspectRatio', 'none');
  field.append(fieldSVG);
  section.prepend(field);
  section.classList.add('has-album-transition');
  let grid;
  let circleNodes = [];
  let progress = 0;
  let phase = 'idle';
  let enabled = true;
  let destroyed = false;
  let operation = null;
  let seeking = null;
  let deferredReset = null;
  let heldSignal = null;
  let heldAbort = null;
  const previousOpacity = new Map();
  const actorStyles = new Map();
  const deskStates = new Map();
  const instant = () => Boolean(reducedMotion() || doc.hidden);
  const now = () => win.performance?.now?.() ?? Date.now();
  const clearDeferred = () => { if (deferredReset !== null) win.cancelAnimationFrame(deferredReset); deferredReset = null; };
  const clearHeld = () => { heldSignal?.removeEventListener('abort', heldAbort); heldSignal = null; heldAbort = null; };
  const restorePrevious = () => { for (const [node, opacity] of previousOpacity) node.style.opacity = opacity; previousOpacity.clear(); };
  const outgoingNode = (node) => node?.querySelector?.('.primary-intro') || node;
  function fadePrevious(value, outgoing = previous) {
    const node = outgoingNode(outgoing);
    if (!node) return;
    if (!previousOpacity.has(node)) previousOpacity.set(node, node.style.opacity || '');
    node.style.opacity = String(1 - smooth(value));
  }
  function restoreActors() {
    section.classList.remove('album-entry-prepared', 'album-entry-playing', 'album-exit-playing');
    for (const [node, styles] of actorStyles) { node.style.opacity = styles.opacity; node.style.transform = styles.transform; }
    actorStyles.clear();
    for (const [node, inert] of deskStates) node.inert = inert;
    deskStates.clear();
  }
  function blockDesk() {
    const desk = section.querySelector('.album-desk');
    if (!desk) return;
    if (!deskStates.has(desk)) deskStates.set(desk, Boolean(desk.inert));
    desk.inert = true;
  }
  function prepareActors() {
    restoreActors();
    for (const node of section.querySelectorAll(ACTORS)) actorStyles.set(node, { opacity: node.style.opacity || '', transform: node.style.transform || '' });
    section.classList.add('album-entry-prepared');
    blockDesk();
  }
  function clearSeek() {
    if (!seeking) return;
    seeking.animations.forEach(({ animation }) => animation.cancel());
    seeking = null;
    restoreActors();
  }
  function prepare() {
    if (destroyed || !enabled) return;
    clearSeek();
    prepareActors();
  }
  function draw(value, mode = 'grow') {
    progress = clamp(value);
    grid.circles.forEach((circle, index) => {
      const radius = circle.maxRadius * albumCircleScale(progress, circle.row, grid.rows, mode);
      circleNodes[index].setAttribute('r', String(Number(radius.toFixed(3))));
    });
  }
  function measure() {
    grid = createAlbumCircleGrid({ width: win.innerWidth || doc.documentElement.clientWidth, height: win.innerHeight || doc.documentElement.clientHeight });
    svg.setAttribute('viewBox', `0 0 ${grid.width} ${grid.height}`);
    circleNodes = grid.circles.map((circle) => {
      const node = doc.createElementNS(SVG_NS, 'circle');
      node.setAttribute('cx', String(circle.x));
      node.setAttribute('cy', String(circle.y));
      node.setAttribute('r', '0');
      return node;
    });
    svg.replaceChildren(...circleNodes);
    const staticGrid = createAlbumCircleGrid({ width: grid.width, height: Math.max(grid.height, section.scrollHeight || 0, section.clientHeight || 0), spacing:Math.max(48,Math.min(120,grid.width/14)) });
    fieldSVG.setAttribute('viewBox', `0 0 ${staticGrid.width} ${staticGrid.height}`);
    fieldSVG.replaceChildren(...staticGrid.circles.map((circle) => {
      const node = doc.createElementNS(SVG_NS, 'circle');
      node.setAttribute('cx', String(circle.x));
      node.setAttribute('cy', String(circle.y));
      node.setAttribute('r', String(staticGrid.pitch * ALBUM_STATIC_RADIUS_RATIO));
      return node;
    }));
    draw(progress);
  }
  function hold(signal) {
    clearHeld();
    if (!signal) return;
    heldSignal = signal;
    heldAbort = () => cancel();
    signal.addEventListener('abort', heldAbort, { once: true });
    if (signal.aborted) cancel();
  }
  function clearVisuals() {
    overlay.hidden = true;
    progress = 0;
    draw(0);
    restorePrevious();
    restoreActors();
    phase = 'idle';
  }
  function cancel() {
    clearDeferred();
    clearHeld();
    clearSeek();
    operation?.end(false);
    clearVisuals();
  }
  function begin({ signal, finish, abort = clearVisuals } = {}) {
    clearDeferred();
    clearHeld();
    clearSeek();
    operation?.end(false);
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    const current = { frame: null, animations: [], end: null, promise };
    const abortHandler = () => current.end(false);
    current.end = (completed = true) => {
      if (operation !== current) return;
      operation = null;
      if (current.frame !== null) win.cancelAnimationFrame(current.frame);
      current.animations.forEach((animation) => animation.cancel());
      signal?.removeEventListener('abort', abortHandler);
      if (completed) finish?.(); else abort?.();
      resolve(completed);
    };
    operation = current;
    signal?.addEventListener('abort', abortHandler, { once: true });
    if (signal?.aborted) current.end(false);
    return current;
  }
  function animateField(target, mode, duration, options) {
    const from = progress;
    const current = begin(options);
    if (operation !== current) return current.promise;
    const startedAt = now();
    const tick = (time) => {
      if (operation !== current) return;
      const fraction = duration ? clamp((time - startedAt) / duration) : 1;
      draw(from + (target - from) * fraction, mode);
      options?.update?.(progress);
      if (fraction >= 1) current.end(true); else current.frame = win.requestAnimationFrame(tick);
    };
    if (instant() || duration <= 0) { draw(target, mode); options?.update?.(progress); current.end(true); }
    else current.frame = win.requestAnimationFrame(tick);
    return current.promise;
  }
  function setProgress(value) {
    if (destroyed || !enabled || operation || seeking || ['covered', 'active'].includes(phase)) return;
    if (!(value > 0)) {
      // goTo resets resistance immediately before calling cover(); one frame of
      // grace preserves that preview instead of flashing an empty field.
      clearDeferred();
      deferredReset = win.requestAnimationFrame(() => { deferredReset = null; if (!operation && phase === 'preview') clearVisuals(); });
      return;
    }
    clearDeferred();
    phase = 'preview';
    overlay.hidden = false;
    draw(value);
    fadePrevious(value);
  }
  function cover({ signal, fromProgress = progress, outgoing = previous, animate = true } = {}) {
    if (destroyed || !enabled) return Promise.resolve(false);
    operation?.end(false);
    clearHeld();
    clearDeferred();
    const start = clamp(fromProgress);
    prepare();
    phase = 'covering';
    overlay.hidden = false;
    draw(start);
    fadePrevious(start, outgoing);
    return animateField(1, 'grow', animate ? ALBUM_TRANSITION_TIMING.cover * (1 - start) : 0, {
      signal,
      update(value) { fadePrevious(value, outgoing); },
      finish() { phase = 'covered'; draw(1); fadePrevious(1, outgoing); hold(signal); },
    });
  }
  function actorFrames(node, kind, entering) {
    const rest = win.getComputedStyle(node).transform || 'none';
    const base = rest === 'none' ? '' : rest;
    if (kind.startsWith('paper')) {
      const angle = kind === 'paper-back' ? 16 : kind === 'paper-middle' ? -11 : 7;
      return entering ? [
        { transform: `translateX(${Math.max(500, grid.width * .8)}px) translateY(-50px) rotate(${angle}deg) ${base}`, opacity: 0 },
        { transform: rest, opacity: 1 },
      ] : [{ transform: rest, opacity: 1 }, { transform: `translateX(${Math.max(500, grid.width * .8)}px) translateY(-45px) rotate(${angle}deg) ${base}`, opacity: 0 }];
    }
    if (kind === 'cover') return entering ? [
      { transform: `translate(-28px,-150px) rotate(-6deg) ${base}`, opacity: 0 },
      { transform: `translateY(7px) rotate(1.5deg) ${base}`, opacity: 1, offset: .68 },
      { transform: `translateY(-3px) rotate(-.5deg) ${base}`, opacity: 1, offset: .86 },
      { transform: rest, opacity: 1 },
    ] : [{ transform: rest, opacity: 1 }, { transform: `translate(-28px,-140px) rotate(-6deg) ${base}`, opacity: 0 }];
    if (kind === 'photo') return entering ? [
      { transform: 'translateY(22px) scale(.8)', opacity: 0 },
      { transform: 'translateY(-6px) scale(1.035)', opacity: 1, offset: .65 },
      { transform: 'translateY(2px) scale(.995)', opacity: 1, offset: .85 },
      { transform: rest, opacity: 1 },
    ] : [{ transform: rest, opacity: 1 }, { transform: 'translateY(18px) scale(.82)', opacity: 0 }];
    return entering ? [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: rest }]
      : [{ opacity: 1, transform: rest }, { opacity: 0, transform: 'translateY(5px)' }];
  }
  function seekActors(direction, value) {
    const entering = direction === 'enter';
    if (seeking?.direction !== direction) {
      clearSeek();
      operation?.end(false);
      prepareActors();
      if (!entering) section.classList.remove('album-entry-prepared');
      section.classList.add(entering ? 'album-entry-playing' : 'album-exit-playing');
      const count = section.querySelectorAll('.album-photo').length;
      const plans = entering ? createAlbumEnterPlan(count) : createAlbumExitPlan(count);
      seeking = { direction, value: 0, animations: [], fallback: [], duration: Math.max(0, ...plans.map((plan) => plan.delay + plan.duration)) };
      for (const plan of plans) {
        const matches = Array.from(section.querySelectorAll(plan.selector));
        const nodes = plan.index === undefined ? matches : [matches[plan.index]].filter(Boolean);
        for (const node of nodes) {
          const keyframes = actorFrames(node, plan.kind, entering);
          if (instant() || typeof node.animate !== 'function') {
            seeking.fallback.push({ node, plan, keyframes });
            continue;
          }
          const animation = node.animate(keyframes, { duration: plan.duration, delay: plan.delay,
            easing: plan.kind.startsWith('paper') ? 'cubic-bezier(.12,.78,.18,1)' : 'cubic-bezier(.2,.65,.3,1)', fill: 'both' });
          // A paused WAAPI timeline renders exactly the input position; its
          // clock never progresses while the visitor stops scrolling.
          animation.finished.catch(() => {});
          animation.pause();
          seeking.animations.push({ animation, node, plan });
        }
      }
    }
    const time = clamp(value) * seeking.duration;
    seeking.animations.forEach(({ animation }) => { animation.currentTime = time; });
    seeking.fallback.forEach(({ node, plan, keyframes }) => {
      const local = smooth((time - plan.delay) / plan.duration);
      node.style.opacity = String(Number(keyframes[0].opacity) + (Number(keyframes.at(-1).opacity) - Number(keyframes[0].opacity)) * local);
      node.style.transform = entering ? keyframes.at(-1).transform : keyframes[0].transform;
    });
    return seeking;
  }
  function seekEnter(value) {
    if (destroyed || !enabled) return false;
    const amount = clamp(value);
    clearDeferred(); clearHeld();
    operation?.end(false);
    if (amount === 0 || amount === 1) {
      clearSeek();
      overlay.hidden = true; draw(0); restorePrevious();
      if (amount === 0) { prepareActors(); phase = 'idle'; }
      else { restoreActors(); phase = 'active'; }
      return true;
    }
    const actors = clamp((amount - ALBUM_SCROLL_PHASE.enterHandoff) / (1 - ALBUM_SCROLL_PHASE.enterHandoff));
    seekActors('enter', actors).value = amount;
    if (amount <= ALBUM_SCROLL_PHASE.enterHandoff) {
      overlay.hidden = false;
      draw(amount / ALBUM_SCROLL_PHASE.enterHandoff);
      fadePrevious(amount / ALBUM_SCROLL_PHASE.enterHandoff);
      phase = 'cover-seek';
    } else {
      overlay.hidden = true; draw(1); restorePrevious();
      phase = 'enter-seek';
    }
    return true;
  }
  function seekExit(value) {
    if (destroyed || !enabled) return false;
    const amount = clamp(value);
    clearDeferred(); clearHeld();
    operation?.end(false);
    if (amount === 0 || amount === 1) {
      clearSeek();
      overlay.hidden = true; draw(0); restorePrevious();
      if (amount === 0) { restoreActors(); phase = 'active'; }
      else { prepareActors(); phase = 'idle'; }
      return true;
    }
    seekActors('exit', amount / ALBUM_SCROLL_PHASE.exitHandoff).value = amount;
    restorePrevious();
    if (amount < ALBUM_SCROLL_PHASE.exitHandoff) {
      overlay.hidden = true; draw(1);
      phase = 'leave-seek';
    } else {
      overlay.hidden = false;
      draw((amount - ALBUM_SCROLL_PHASE.exitHandoff) / (1 - ALBUM_SCROLL_PHASE.exitHandoff), 'shrink');
      phase = 'reveal-seek';
    }
    return true;
  }
  function holdCover() {
    if (destroyed || !enabled) return false;
    clearDeferred(); clearHeld();
    operation?.end(false);
    overlay.hidden = false; draw(1); phase = 'covered';
    return true;
  }
  function runActors(entering, { signal } = {}) {
    if (destroyed || !enabled) return Promise.resolve(false);
    const current = begin({ signal,
      finish() {
        restoreActors();
        if (entering) { overlay.hidden = true; phase = 'active'; restorePrevious(); }
        else { overlay.hidden = false; draw(1); phase = 'covered'; hold(signal); }
      },
    });
    if (operation !== current) return current.promise;
    if (entering) {
      prepare();
      overlay.hidden = true;
      restorePrevious();
      section.classList.add('album-entry-playing');
      phase = 'entering';
    } else {
      restoreActors();
      blockDesk();
      section.classList.add('album-exit-playing');
      phase = 'leaving';
    }
    const count = section.querySelectorAll('.album-photo').length;
    const plans = entering ? createAlbumEnterPlan(count) : createAlbumExitPlan(count);
    for (const plan of plans) {
      const matches = Array.from(section.querySelectorAll(plan.selector));
      const nodes = plan.index === undefined ? matches : [matches[plan.index]].filter(Boolean);
      for (const node of nodes) {
        if (instant() || typeof node.animate !== 'function') continue;
        const animation = node.animate(actorFrames(node, plan.kind, entering), { duration: plan.duration, delay: plan.delay,
          easing: plan.kind.startsWith('paper') ? 'cubic-bezier(.12,.78,.18,1)' : 'cubic-bezier(.2,.65,.3,1)', fill: 'both' });
        current.animations.push(animation);
      }
    }
    if (!current.animations.length) current.end(true);
    else Promise.all(current.animations.map((animation) => animation.finished.catch(() => {}))).then(() => { if (operation === current) current.end(true); });
    return current.promise;
  }
  function enter(options = {}) { return runActors(true, options); }
  function leave(options = {}) { return runActors(false, options); }
  function reveal({ signal, animate = true } = {}) {
    if (destroyed || !enabled) return Promise.resolve(false);
    operation?.end(false);
    clearHeld();
    progress = 0;
    overlay.hidden = false;
    draw(0, 'shrink');
    phase = 'revealing';
    return animateField(1, 'shrink', animate ? ALBUM_TRANSITION_TIMING.reveal : 0, { signal,
      finish() { overlay.hidden = true; progress = 0; phase = 'idle'; restorePrevious(); restoreActors(); },
    });
  }
  const resize = () => {
    const seek = seeking && { direction: seeking.direction, value: seeking.value };
    const held = phase === 'covered';
    operation?.end(true);
    // Recreate spatial keyframes at the same input position after resizing.
    clearSeek(); measure();
    if (seek) {
      if (seek.direction === 'enter') seekEnter(seek.value); else seekExit(seek.value);
    }
    if (held || phase === 'covered') { overlay.hidden = false; draw(1); phase = 'covered'; }
  };
  const visibility = () => { if (doc.hidden) operation?.end(true); };
  win.addEventListener('resize', resize, { passive: true });
  doc.addEventListener('visibilitychange', visibility);
  measure();
  prepare();
  return {
    setProgress, cover, enter, leave, reveal, prepare, cancel, seekEnter, seekExit, holdCover,
    reset({ prepare: pending = false } = {}) { cancel(); if (pending) prepare(); },
    setEnabled(value) {
      enabled = Boolean(value);
      if (!enabled) cancel();
      field.hidden = !enabled;
      section.classList.toggle('has-album-transition', enabled);
    },
    get phase() { return phase; },
    get progress() { return progress; },
    get busy() { return operation !== null || seeking !== null; },
    destroy() {
      if (destroyed) return;
      cancel();
      destroyed = true;
      win.removeEventListener('resize', resize);
      doc.removeEventListener('visibilitychange', visibility);
      section.classList.remove('has-album-transition');
      overlay.remove(); field.remove();
    },
  };
}
