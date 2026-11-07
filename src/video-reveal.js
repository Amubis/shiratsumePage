import { createStableClip } from './stable-clip.js';

const CLIP_PROPERTIES = ['clip-path', '-webkit-clip-path'];
const REVEAL_PROPERTIES = [...CLIP_PROPERTIES, 'overflow', 'overflow-x', 'overflow-y'];
const SHRINK_MS = 120;
const GROW_MS = 660;
const START_RADIUS = 22;
const MIN_RADIUS = 7;
const flag = (value) => typeof value === 'function' ? value() : value;
const clamp = (value) => Math.max(0, Math.min(1, value));
const ease = (value) => value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;
const number = (value) => String(Number((Number.isFinite(value) ? value : 0).toFixed(3)));

export function videoCoverRadius(center, { width, height }, margin = 32) {
  return Math.max(...[[0, 0], [width, 0], [0, height], [width, height]].map(([x, y]) => Math.hypot(x - center.x, y - center.y))) + margin;
}

/** Keep the little background disc small while its transparent opening expands. */
export function videoRevealFrame(elapsed, coverRadius) {
  if (elapsed < SHRINK_MS) {
    const radius = START_RADIUS + (MIN_RADIUS - START_RADIUS) * ease(clamp(elapsed / SHRINK_MS));
    return { radius, discScale: radius / START_RADIUS, complete: false };
  }
  const progress = clamp((elapsed - SHRINK_MS) / GROW_MS);
  return {
    radius: MIN_RADIUS + (coverRadius - MIN_RADIUS) * ease(progress),
    discScale: MIN_RADIUS / START_RADIUS + (1 - MIN_RADIUS / START_RADIUS) * ease(clamp((elapsed - SHRINK_MS) / 180)),
    complete: progress === 1,
  };
}

/** Rectangle minus a circular opening, in target-local pixels. */
export function inverseCirclePath(rect, center, radius) {
  const width = Math.max(0, rect.width);
  const height = Math.max(0, rect.height);
  const x = center.x - rect.left;
  const y = center.y - rect.top;
  const r = Math.max(0, radius);
  const opening = r ? ` M${number(x + r)} ${number(y)} a${number(r)} ${number(r)} 0 1 0 ${number(-2 * r)} 0 a${number(r)} ${number(r)} 0 1 0 ${number(2 * r)} 0 Z` : '';
  return `M0 0 H${number(width)} V${number(height)} H0 Z${opening}`;
}

/** Compatibility helper for geometry consumers; animation uses stable clips. */
export function inverseCircleMask(rect, center, radius) {
  const width = Math.max(0, rect.width);
  const height = Math.max(0, rect.height);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${number(width)}" height="${number(height)}" viewBox="0 0 ${number(width)} ${number(height)}"><path fill="white" fill-rule="evenodd" d="${inverseCirclePath(rect, center, radius)}"/></svg>`;
}

const remember = (element, properties) => ({ element, values: properties.map((name) => ({ name, value: element.style.getPropertyValue(name), priority: element.style.getPropertyPriority(name) })) });
const restore = ({ element, values }) => values.forEach(({ name, value, priority }) => value ? element.style.setProperty(name, value, priority) : element.style.removeProperty(name));

export function createVideoReveal({ hero, button, targets = [], reducedMotion = false, onStart, onComplete } = {}) {
  if (!hero?.ownerDocument || !button) throw new TypeError('The hero and video button are required.');
  const doc = hero.ownerDocument;
  const win = doc.defaultView;
  const body = doc.body;
  const elements = [...new Set(Array.from(targets).filter(Boolean))];
  let current = null;
  let destroyed = false;

  function release(session, completed) {
    if (current !== session) return;
    current = null;
    if (session.frame) win.cancelAnimationFrame(session.frame);
    session.listeners.forEach(([target, name, listener, options]) => target.removeEventListener(name, listener, options));
    session.saved.forEach(restore);
    session.clips.forEach(({ clip }) => clip.destroy());
    session.heroClip?.destroy();
    if (!session.hadClass) body.classList.remove('watch-reveal-animating');
    session.resolve(completed);
  }

  function paint(session, frame) {
    // Read all geometry first, then mutate existing paths without replacing URLs.
    const layouts = session.clips.map(({ element, clip }) => ({ clip, rect: element.getBoundingClientRect() }));
    const heroRect = hero.getBoundingClientRect();
    for (const { clip, rect } of layouts) clip.update([{ path: inverseCirclePath(rect, session.center, frame.radius), rule: 'evenodd' }]);
    session.heroClip.update([{ path: inverseCirclePath(heroRect, session.center, frame.radius), rule: 'evenodd' }]);
    if (session.disc) session.disc.style.setProperty('transform', `scale(${number(frame.discScale)})`);
  }

  function complete(session) {
    if (current !== session) return;
    try {
      onComplete?.();
      if (current !== session) return;
      // Commit watch-mode's opacity:0 while transition:none is still active.
      // Otherwise removing the clips in the same task could expose an old frame.
      elements.forEach((element) => { void win.getComputedStyle(element).opacity; });
      void win.getComputedStyle(hero, '::after').opacity;
      release(session, true);
    } catch { release(session, false); }
  }

  const cancel = () => { if (current) release(current, false); };

  return {
    get active() { return current !== null; },
    enter() {
      if (destroyed) return Promise.resolve(false);
      if (current) return current.promise;
      let resolve;
      const promise = new Promise((done) => { resolve = done; });
      const disc = button.querySelector('.control-disc');
      const session = {
        promise, resolve, disc, frame: 0, listeners: [], clips: [], heroClip: null,
        hadClass: body.classList.contains('watch-reveal-animating'),
        saved: [...elements.map((element) => remember(element, REVEAL_PROPERTIES)), remember(hero, ['--video-reveal-clip']), ...(disc ? [remember(disc, ['transform'])] : [])],
      };
      current = session;
      body.classList.add('watch-reveal-animating');
      try { onStart?.(); } catch { release(session, false); return promise; }
      if (current !== session) return promise;
      if (flag(reducedMotion)) { complete(session); return promise; }

      try {
        const bounds = button.getBoundingClientRect();
        session.center = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
        session.coverRadius = videoCoverRadius(session.center, { width: win.innerWidth, height: win.innerHeight });
        session.startTime = win.performance.now();
        for (const element of elements) {
          const clip = createStableClip({ document: doc, prefix: 'video-target' });
          session.clips.push({ element, clip });
          for (const property of CLIP_PROPERTIES) element.style.setProperty(property, clip.url);
          // The inverse circle also has geometry outside this rectangle. The old
          // SVG image viewport clipped it; keep overflowing descendants bounded
          // for this session without changing their normal page presentation.
          element.style.setProperty('overflow', 'hidden', 'important');
        }
        session.heroClip = createStableClip({ document: doc, prefix: 'video-hero' });
        hero.style.setProperty('--video-reveal-clip', session.heroClip.url);
        paint(session, videoRevealFrame(0, session.coverRadius));
      } catch { release(session, false); return promise; }
      const listen = (target, name, listener, options) => {
        target.addEventListener(name, listener, options);
        session.listeners.push([target, name, listener, options]);
      };
      listen(win, 'resize', cancel);
      listen(doc, 'visibilitychange', () => { if (doc.hidden) cancel(); });
      listen(doc, 'keydown', (event) => { if (event.key === 'Escape') cancel(); });
      for (const event of ['wheel', 'touchstart', 'touchmove']) listen(win, event, cancel, { passive: true, capture: true });
      const tick = (timestamp) => {
        if (current !== session) return;
        session.frame = 0;
        try {
          const frame = videoRevealFrame(timestamp - session.startTime, session.coverRadius);
          paint(session, frame);
          if (frame.complete) complete(session);
          else session.frame = win.requestAnimationFrame(tick);
        } catch { release(session, false); }
      };
      session.frame = win.requestAnimationFrame(tick);
      return promise;
    },
    cancel,
    destroy() { if (!destroyed) { destroyed = true; cancel(); } },
  };
}
