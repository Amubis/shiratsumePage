const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

/** The video follows the bar's viewport edge until the bar has left the view. */
export function getTopbarDockState({ height = 64, scroll = 0, active = true, focused = false } = {}) {
  height = Math.max(1, Number(height) || 64);
  scroll = Math.max(0, Number(scroll) || 0);
  if (!active) return { offset: -height, space: 0, collapsed: true, tracking: false };
  if (focused) return { offset: 0, space: height + scroll, collapsed: false, tracking: true };
  const travelled = clamp(scroll, 0, height);
  return {
    offset: -travelled,
    space: scroll <= height ? height : Math.max(0, 2 * height - scroll),
    collapsed: travelled >= height,
    tracking: scroll > 0,
  };
}

/** Owns dock geometry only; the chapter navigator retains focus/inert and input. */
export function createTopbarDock({ topbar, hero, reducedMotion = () => false } = {}) {
  if (!topbar?.ownerDocument || !hero) throw new TypeError('The opening navigation and hero are required.');
  const doc = topbar.ownerDocument;
  const win = doc.defaultView;
  const root = doc.documentElement;
  const body = doc.body;
  const media = hero.querySelector('.hero-media');
  const cleanups = [];
  const properties = ['--topbar-offset', '--topbar-space'];
  const saved = properties.map(name => ({ name, value: root.style.getPropertyValue(name) }));
  let frame = null;
  let destroyed = false;
  let locked = false;
  let last = {};
  const bind = (target, event, callback, options) => {
    target.addEventListener(event, callback, options);
    cleanups.push(() => target.removeEventListener(event, callback, options));
  };
  function apply(state) {
    for (const name of ['offset', 'space']) {
      const value = `${Number(state[name].toFixed(3))}px`;
      if (last[name] !== value) { root.style.setProperty(`--topbar-${name}`, value); last[name] = value; }
    }
    root.classList.toggle('is-topbar-dock-collapsed', state.collapsed);
    root.classList.toggle('is-topbar-dock-tracking', state.tracking);
  }
  function refresh() {
    if (destroyed) return;
    const atHome = body.classList.contains('on-home');
    const watching = body.classList.contains('watch-mode');
    const revealing = body.classList.contains('watch-reveal-animating');
    // Freeze the actual in-flight pose, not its transition endpoint. The stable
    // circular erase can then read unchanged rectangles until it completes.
    if (atHome && revealing && !watching) {
      if (!locked) {
        const barRect = topbar.getBoundingClientRect();
        const heroRect = hero.getBoundingClientRect();
        const mediaRect = media?.getBoundingClientRect();
        apply({ offset: barRect.top, space: mediaRect ? Math.max(0, mediaRect.top - heroRect.top) : 0, collapsed: false, tracking: false });
        root.classList.add('is-topbar-dock-locked');
        locked = true;
      }
      return;
    }
    if (locked) { locked = false; root.classList.remove('is-topbar-dock-locked'); }
    const phase = root.dataset.phase;
    const active = atHome && !watching && !root.classList.contains('is-booting') && ['controls', 'ready'].includes(phase);
    const rect = hero.getBoundingClientRect();
    const height = topbar.getBoundingClientRect().height || 64;
    const focusedNode = doc.activeElement;
    const focused = active && topbar.contains(focusedNode)
      && (typeof focusedNode?.matches !== 'function' || focusedNode.matches(':focus-visible'));
    root.classList.toggle('is-topbar-dock-instant', Boolean(typeof reducedMotion === 'function' ? reducedMotion() : reducedMotion));
    apply(getTopbarDockState({ height, scroll: -rect.top, active, focused }));
  }
  const schedule = () => {
    if (destroyed || frame !== null) return;
    frame = win.requestAnimationFrame(() => { frame = null; refresh(); });
  };
  root.classList.add('has-topbar-dock');
  bind(win, 'scroll', schedule, { passive: true });
  bind(win, 'resize', schedule, { passive: true });
  bind(win, 'pageshow', schedule);
  bind(topbar, 'focusin', refresh);
  bind(topbar, 'focusout', schedule);
  const motion = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  if (motion?.addEventListener) bind(motion, 'change', schedule);
  if (typeof win.MutationObserver === 'function') {
    const observer = new win.MutationObserver(schedule);
    observer.observe(root, { attributes: true, attributeFilter: ['data-phase', 'class'] });
    observer.observe(body, { attributes: true, attributeFilter: ['class'] });
    cleanups.push(() => observer.disconnect());
  }
  refresh();
  return {
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (frame !== null) win.cancelAnimationFrame(frame);
      frame = null;
      cleanups.splice(0).forEach(dispose => dispose());
      for (const { name, value } of saved) {
        if (value) root.style.setProperty(name, value); else root.style.removeProperty(name);
      }
      root.classList.remove('has-topbar-dock', 'is-topbar-dock-collapsed', 'is-topbar-dock-tracking', 'is-topbar-dock-locked', 'is-topbar-dock-instant');
    },
  };
}
