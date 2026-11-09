const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

/** One short water-like spring step. Positions are CSS pixels, never percentages. */
export function advanceWaterPush(state, seconds) {
  const dt = clamp(Number(seconds) || 1 / 60, 1 / 240, 1 / 30);
  let { x = 0, y = 0, vx = 0, vy = 0 } = state;
  vx += (-40 * x - 12 * vx) * dt;
  vy += (-40 * y - 12 * vy) * dt;
  x += vx * dt;
  y += vy * dt;
  const length = Math.hypot(x, y);
  if (length > 18) { x *= 18 / length; y *= 18 / length; vx *= .45; vy *= .45; }
  const settled = Math.hypot(x, y) < .025 && Math.hypot(vx, vy) < .08;
  return settled ? { x: 0, y: 0, vx: 0, vy: 0, settled: true } : { x, y, vx, vy, settled: false };
}

/** Share the water push across scenes; the hero can also supply one semantic CTA. */
export function createHeroInteractions({ hero, exploreButton, exploreWrap, reducedMotion = () => false, isActive = () => true } = {}) {
  if (!hero?.ownerDocument || Boolean(exploreButton) !== Boolean(exploreWrap)) throw new TypeError('A scene and, optionally, its complete exploration control are required.');
  const doc = hero.ownerDocument;
  const win = doc.defaultView;
  const records = new Map();
  const cleanups = [];
  let frame = null;
  let lastPaint = null;
  let lastPointer = null;
  let impulse = null;
  let destroyed = false;
  let hovered = false;
  let focused = false;
  const bind = (target, event, handler, options) => {
    target.addEventListener(event, handler, options);
    cleanups.push(() => target.removeEventListener(event, handler, options));
  };
  const canMove = () => !destroyed && !doc.hidden && !reducedMotion() && isActive();
  const updateCTA = () => exploreWrap?.classList.toggle('is-explore-hovered', !destroyed && isActive() && (hovered || focused));
  const clearProperties = (node) => {
    node.style.removeProperty('--pointer-push-x');
    node.style.removeProperty('--pointer-push-y');
  };
  function reset() {
    if (frame !== null) win.cancelAnimationFrame(frame);
    frame = null;
    lastPaint = null;
    lastPointer = null;
    impulse = null;
    records.forEach((_, node) => clearProperties(node));
    records.clear();
  }
  function schedule() {
    if (frame === null && canMove()) frame = win.requestAnimationFrame(tick);
  }
  function tick(time) {
    frame = null;
    if (!canMove()) { reset(); return; }
    if (lastPaint !== null && time - lastPaint < 1000 / 30) { schedule(); return; }
    const dt = lastPaint === null ? 1 / 30 : (time - lastPaint) / 1000;
    lastPaint = time;
    if (impulse) {
      for (const node of hero.querySelectorAll('.scene-clover')) {
        const rect = node.getBoundingClientRect();
        const dx = Math.max(rect.left - impulse.x, 0, impulse.x - rect.right);
        const dy = Math.max(rect.top - impulse.y, 0, impulse.y - rect.bottom);
        const influence = Math.max(0, 1 - Math.hypot(dx, dy) / 75);
        if (!influence) continue;
        const state = records.get(node) || { x: 0, y: 0, vx: 0, vy: 0 };
        state.vx = clamp(state.vx + impulse.vx * influence * .08, -140, 140);
        state.vy = clamp(state.vy + impulse.vy * influence * .08, -140, 140);
        records.set(node, state);
      }
      impulse = null;
    }
    let moving = false;
    for (const [node, state] of records) {
      if (node.isConnected === false) { clearProperties(node); records.delete(node); continue; }
      const next = advanceWaterPush(state, dt);
      if (next.settled) { clearProperties(node); records.delete(node); continue; }
      records.set(node, next);
      node.style.setProperty('--pointer-push-x', `${next.x.toFixed(3)}px`);
      node.style.setProperty('--pointer-push-y', `${next.y.toFixed(3)}px`);
      moving = true;
    }
    if (moving) schedule(); else lastPaint = null;
  }
  bind(hero, 'pointermove', (event) => {
    if (event.pointerType === 'touch' || !canMove() || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      reset(); return;
    }
    const time = win.performance?.now() ?? Date.now();
    if (lastPointer) {
      const dt = Math.max(1 / 120, Math.min(.1, (time - lastPointer.time) / 1000));
      impulse = { x: event.clientX, y: event.clientY,
        vx: clamp((event.clientX - lastPointer.x) / dt, -1800, 1800),
        vy: clamp((event.clientY - lastPointer.y) / dt, -1800, 1800) };
      schedule();
    }
    lastPointer = { x: event.clientX, y: event.clientY, time };
  }, { passive: true });
  bind(hero, 'pointerleave', () => { lastPointer = null; impulse = null; });
  if (exploreButton) {
    bind(exploreButton, 'pointerenter', (event) => { if (event.pointerType !== 'touch') { hovered = true; updateCTA(); } });
    bind(exploreButton, 'pointerleave', () => { hovered = false; updateCTA(); });
    bind(exploreButton, 'focus', () => { focused = true; updateCTA(); });
    bind(exploreButton, 'blur', () => { focused = false; updateCTA(); });
  }
  bind(doc, 'visibilitychange', reset);
  bind(win, 'resize', reset, { passive: true });
  bind(win, 'scroll', reset, { passive: true });
  bind(win, 'pagehide', reset);
  return {
    refresh() { reset(); updateCTA(); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      reset();
      cleanups.splice(0).forEach((dispose) => dispose());
      exploreWrap?.classList.toggle('is-explore-hovered', false);
    },
  };
}
