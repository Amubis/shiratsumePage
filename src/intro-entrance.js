const clamp = (value, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value));
const smooth = (value) => { const t = clamp(value); return t * t * (3 - 2 * t); };
const eased = (value) => 1 - (1 - clamp(value)) ** 3;
const flag = (value) => typeof value === 'function' ? value() : Boolean(value);

export const INTRO_ENTRANCE_TIMING = Object.freeze({
  waveDelay: 0, waveDuration: 420, waveSpread: 430,
  actorDelay: 140, actorDuration: 900,
  controlsDelay: 1120, controlsDuration: 320,
  textDelay: 1230, textStagger: 90, textDuration: 410,
  decorDelay: 2110, decorDuration: 420, total: 2530,
});

/** Radius-only bounce keeps circles round and retains the single group alpha mask. */
export function introPopScale(progress) {
  const t = clamp(progress);
  if (t < .54) return 1.12 * eased(t / .54);
  if (t < .82) return 1.12 + (.985 - 1.12) * smooth((t - .54) / .28);
  return .985 + .015 * smooth((t - .82) / .18);
}

export function introActorPose(progress) {
  const t = clamp(progress);
  const stops = [
    { t: 0, y: 82, scale: .83, rotation: -5, opacity: 0 },
    { t: .44, y: -24, scale: 1.045, rotation: 1.8, opacity: 1 },
    { t: .74, y: 7, scale: .992, rotation: -.6, opacity: 1 },
    { t: 1, y: 0, scale: 1, rotation: 0, opacity: 1 },
  ];
  const end = stops.findIndex((stop) => stop.t >= t);
  if (end <= 0) return { ...stops[0] };
  const before = stops[end - 1];
  const after = stops[end];
  const amount = end === 1 ? eased((t - before.t) / (after.t - before.t)) : smooth((t - before.t) / (after.t - before.t));
  return Object.fromEntries(['y', 'scale', 'rotation', 'opacity'].map((key) => [key, before[key] + (after[key] - before[key]) * amount]));
}

/**
 * One clock can paint the actual section and its clipped transition snapshot.
 * attach(snapshotSection) maps its circles to the source radii by DOM order,
 * so sanitizing a snapshot does not need to preserve data attributes or IDs.
 */
export function createIntroEntrance({ section, reducedMotion = () => false, isEnabled = () => true } = {}) {
  if (!section?.ownerDocument) throw new TypeError('An introduction section is required.');
  const doc = section.ownerDocument;
  const win = doc.defaultView;
  const scopes = new Map();
  const finalRadii = new WeakMap();
  const cleanups = [];
  let frame = null;
  let startedAt = 0;
  let elapsedTime = 0;
  let state = 'idle';
  let destroyed = false;
  let lastPaint = -Infinity;
  let completion = null;
  const now = () => win.performance?.now() ?? Date.now();
  const canAnimate = () => !destroyed && flag(isEnabled) && !flag(reducedMotion) && !doc.hidden;
  const query = (scope, selector) => scope.querySelector(selector);
  const all = (scope, selector) => Array.from(scope.querySelectorAll(selector));
  const bind = (target, name, handler) => { target.addEventListener(name, handler); cleanups.push(() => target.removeEventListener(name, handler)); };
  const set = (node, key, value) => node?.style.setProperty(key, String(value));
  const phase = (time, delay, duration) => clamp((time - delay) / duration);

  function collect(scope, source) {
    const circles = all(scope, '.intro-halftone-seam circle');
    const svg = query(scope, '.intro-halftone-seam svg');
    const viewBox = String(svg?.getAttribute('viewBox') || '0 0 1440 900').split(/\s+/).map(Number);
    const width = viewBox[2] || 1440;
    const height = viewBox[3] || 900;
    const spacing = Number(svg?.getAttribute('data-dot-spacing')) || 18;
    const angle = 8 * Math.PI / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const raw = circles.map((node, index) => {
      const original = source?.circles[index];
      const radius = original?.radius ?? finalRadii.get(node) ?? Number(node.getAttribute('r'));
      if (!source) finalRadii.set(node, radius);
      const x = Number(node.getAttribute('cx'));
      const y = Number(node.getAttribute('cy'));
      const band = original?.band || node.parentElement?.getAttribute('data-band') || (y < height / 2 ? 'top' : 'bottom');
      const row = original?.row ?? Math.round((-sin * (x - width / 2) + cos * (y - height / 2)) / spacing);
      return { node, radius, band, row };
    });
    const ranges = {};
    for (const band of ['top', 'bottom']) {
      const rows = raw.filter((circle) => circle.band === band).map((circle) => circle.row);
      ranges[band] = rows.length ? [Math.min(...rows), Math.max(...rows)] : [0, 0];
    }
    const result = {
      scope,
      stage: query(scope, '.outfit-pair') || query(scope, '.outfit-stage'), footer: query(scope, '.outfit-footer'),
      cue: query(scope, '.outfit-cue'), meta: query(scope, '.primary-intro > .section-footer'),
      texts: ['.model-intro-copy > .section-number', '.model-intro-title h2', '.model-intro-reading', '.model-intro-lead', '.model-intro-description', '.model-intro-copy > .text-link'].map((selector) => query(scope, selector)).filter(Boolean),
      decorations: all(scope, '.model-intro-title > span:first-child, .intro-quote-mark'),
      circles: raw.map((circle) => {
        const [minimum, maximum] = ranges[circle.band];
        const rank = circle.band === 'top' ? circle.row - minimum : maximum - circle.row;
        return { ...circle, delay: rank / Math.max(1, maximum - minimum) * INTRO_ENTRANCE_TIMING.waveSpread };
      }),
    };
    scopes.set(scope, result);
    return result;
  }

  function paintRecord(record, time) {
    const timing = INTRO_ENTRANCE_TIMING;
    const complete = time >= timing.total;
    const scope = record.scope;
    scope.classList.toggle('intro-enter-managed', true);
    scope.classList.toggle('intro-enter-playing', !complete);
    scope.classList.toggle('intro-float-ready', complete);
    for (const circle of record.circles) {
      const scale = complete ? 1 : introPopScale(phase(time, circle.delay, timing.waveDuration));
      const radius = circle.radius * scale;
      const value = complete ? String(circle.radius) : radius.toFixed(3);
      if (circle.node.getAttribute('r') !== value) circle.node.setAttribute('r', value);
    }
    const actor = introActorPose(phase(time, timing.actorDelay, timing.actorDuration));
    set(scope, '--intro-actor-y', `${actor.y.toFixed(3)}px`);
    set(scope, '--intro-actor-scale', actor.scale.toFixed(5));
    set(scope, '--intro-actor-rotation', `${actor.rotation.toFixed(3)}deg`);
    set(scope, '--intro-actor-alpha', actor.opacity.toFixed(5));
    const controls = smooth(phase(time, timing.controlsDelay, timing.controlsDuration));
    set(scope, '--intro-controls-alpha', controls.toFixed(5));
    set(scope, '--intro-controls-y', `${((1 - controls) * 8).toFixed(3)}px`);
    if (record.stage) record.stage.inert = !complete && time < timing.actorDelay + timing.actorDuration;
    if (record.footer) record.footer.inert = controls < .98;
    record.texts.forEach((node, index) => {
      const amount = eased(phase(time, timing.textDelay + index * timing.textStagger, timing.textDuration));
      set(node, '--intro-text-alpha', amount.toFixed(5));
      set(node, '--intro-text-x', `${(-28 * (1 - amount)).toFixed(3)}px`);
      set(node, '--intro-text-y', `${(4 * (1 - amount)).toFixed(3)}px`);
      if (node.localName === 'button' || node.localName === 'a') node.inert = amount < .98;
    });
    const decor = phase(time, timing.decorDelay, timing.decorDuration);
    set(scope, '--intro-decor-alpha', smooth(decor / .5).toFixed(5));
    set(scope, '--intro-decor-scale', introPopScale(decor).toFixed(5));
  }

  function paint(time) {
    for (const [scope, record] of scopes) {
      if (scope !== section && scope.isConnected === false) { scopes.delete(scope); continue; }
      paintRecord(record, time);
    }
  }
  function stop() { if (frame !== null) win.cancelAnimationFrame(frame); frame = null; }
  function resolveCompletion(value) { if (completion) { const resolve = completion; completion = null; resolve(value); } }
  function finish({ cancelled = false } = {}) {
    stop();
    elapsedTime = INTRO_ENTRANCE_TIMING.total;
    state = 'complete';
    paint(elapsedTime);
    resolveCompletion(!cancelled);
  }
  function prepare() {
    if (destroyed) return false;
    stop(); resolveCompletion(false);
    elapsedTime = 0;
    state = 'prepared';
    collect(section);
    if (!canAnimate()) { finish(); return false; }
    paint(0);
    return true;
  }
  function tick(time) {
    frame = null;
    if (!canAnimate()) { finish(); return; }
    elapsedTime = clamp(time - startedAt, 0, INTRO_ENTRANCE_TIMING.total);
    if (time - lastPaint >= 1000 / 60 || elapsedTime >= INTRO_ENTRANCE_TIMING.total) {
      paint(elapsedTime); lastPaint = time;
    }
    if (elapsedTime >= INTRO_ENTRANCE_TIMING.total) finish();
    else frame = win.requestAnimationFrame(tick);
  }
  function enter({ fromTime = 0 } = {}) {
    if (destroyed) return Promise.resolve(false);
    stop(); resolveCompletion(false);
    collect(section);
    if (!canAnimate()) { finish(); return Promise.resolve(true); }
    elapsedTime = clamp(Number(fromTime) || 0, 0, INTRO_ENTRANCE_TIMING.total);
    startedAt = now() - elapsedTime;
    lastPaint = -Infinity;
    state = 'playing';
    paint(elapsedTime);
    if (elapsedTime >= INTRO_ENTRANCE_TIMING.total) { finish(); return Promise.resolve(true); }
    return new Promise((resolve) => {
      completion = resolve;
      frame = win.requestAnimationFrame(tick);
    });
  }
  function attach(scope) {
    if (destroyed || !scope?.querySelectorAll) return () => {};
    collect(scope, scopes.get(section) || collect(section));
    paintRecord(scopes.get(scope), elapsedTime);
    return () => scopes.delete(scope);
  }
  const interrupted = () => { if (!destroyed) finish({ cancelled: true }); };
  bind(win, 'resize', interrupted);
  bind(win, 'pagehide', interrupted);
  bind(doc, 'visibilitychange', () => { if (doc.hidden) interrupted(); });
  bind(doc, 'keydown', (event) => { if (state === 'playing' && ['Tab', 'Escape'].includes(event.key)) finish(); });
  collect(section);
  return {
    prepare, enter, attach,
    detach(scope) { scopes.delete(scope); },
    finish,
    reset: prepare,
    refresh() {
      if (destroyed) return;
      collect(section);
      if (!canAnimate()) finish();
      else paint(elapsedTime);
    },
    get elapsed() { return state === 'playing' ? clamp(now() - startedAt, 0, INTRO_ENTRANCE_TIMING.total) : elapsedTime; },
    get playing() { return state === 'playing'; },
    get state() { return state; },
    destroy() {
      if (destroyed) return;
      finish({ cancelled: true });
      destroyed = true;
      state = 'destroyed';
      cleanups.splice(0).forEach((dispose) => dispose());
      for (const record of scopes.values()) {
        record.scope.classList.toggle('intro-enter-managed', false);
        record.scope.classList.toggle('intro-enter-playing', false);
        record.scope.classList.toggle('intro-float-ready', false);
      }
      scopes.clear();
    },
  };
}
