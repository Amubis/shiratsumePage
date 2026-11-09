import { cloverSVG, seededRandom, randomThemeColor, hslToHex } from './scene.js';
import { createHeroInteractions } from './hero-interactions.js';

const clamp = value => Math.min(1, Math.max(0, value));
const eased = value => 1 - (1 - clamp(value)) ** 3;
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const flag = value => typeof value === 'function' ? value() : Boolean(value);

export const PERSONAL_ENTRANCE_TIMING = Object.freeze({ avatarDelay: 80, avatarDuration: 940, textDelay: 660, textStagger: 100, textDuration: 540, footerDelay: 1220, total: 1760 });

/** A bubble stretches on ascent, passes the surface and softly settles. */
export function personalAvatarPose(progress) {
  const t = clamp(progress);
  const stops = [
    { t: 0, y: 58, scaleX: .35, scaleY: .48, opacity: 0 },
    { t: .42, y: -18, scaleX: 1.085, scaleY: .96, opacity: 1 },
    { t: .7, y: 5, scaleX: .98, scaleY: 1.035, opacity: 1 },
    { t: 1, y: 0, scaleX: 1, scaleY: 1, opacity: 1 },
  ];
  const index = stops.findIndex(stop => stop.t >= t);
  if (index <= 0) return { y: 58, scaleX: .35, scaleY: .48, opacity: 0 };
  const a = stops[index - 1], b = stops[index];
  const amount = (index === 1 ? eased : smooth)((t - a.t) / (b.t - a.t));
  return Object.fromEntries(['y', 'scaleX', 'scaleY', 'opacity'].map(key => [key, a[key] + (b[key] - a[key]) * amount]));
}

/** Four smaller counterweights leave the central portrait and copy open. */
export function generatePersonalSceneLayout(seed) {
  const random = seededRandom(seed);
  const range = (a, b) => a + random() * (b - a);
  return [
    { x: range(14, 25), y: range(13, 25), size: range(12, 18), alpha: .21 },
    { x: range(10, 22), y: range(74, 89), size: range(9, 13), alpha: .16 },
    { x: range(80, 92), y: range(20, 38), size: range(10, 15), alpha: .18 },
    { x: range(76, 90), y: range(76, 89), size: range(12, 17), alpha: .23 },
  ].map(shape => ({ ...shape, rotation: range(-42, 42) }));
}

/** Arrival starts explicitly after the album's final wave, never on is-current. */
export function createPersonalEntrance({ section, reducedMotion = () => false, isEnabled = () => true, theme = '#B7BB5A', seed = 'shiratsume' } = {}) {
  if (!section?.ownerDocument) throw new TypeError('A personal chapter is required.');
  const doc = section.ownerDocument, win = doc.defaultView;
  const field = section.querySelector('.personal-clovers');
  const content = section.querySelector('.personal-inner');
  const page = section.querySelector('#personal-page');
  const visitSeed = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const layouts = new Map();
  const cleanups = [];
  const originalInert = Boolean(content?.inert);
  let enabled = true, destroyed = false, state = 'idle', frame = null, elapsed = 0, startedAt = 0, promise = null, completion = null;
  const now = () => win.performance?.now() ?? Date.now();
  const active = () => enabled && flag(isEnabled) && !destroyed;
  const canAnimate = () => active() && !flag(reducedMotion) && !doc.hidden;
  const phase = (time, delay, duration) => clamp((time - delay) / duration);
  const set = (node, property, value) => node?.style.setProperty(property, String(value));
  const bind = (target, name, handler) => { target.addEventListener(name, handler); cleanups.push(() => target.removeEventListener(name, handler)); };
  function renderField() {
    if (!field) return;
    if (!layouts.has(seed)) layouts.set(seed, generatePersonalSceneLayout(`${visitSeed}:${seed}`));
    const random = seededRandom(`${visitSeed}:${seed}:color`);
    const nodes = layouts.get(seed).map((shape, index) => {
      const node = doc.createElement('div'); node.className = 'scene-clover'; node.setAttribute('aria-hidden', 'true');
      const angle = random() * Math.PI * 2, distance = 2 + random() * 3;
      const variables = { '--x': `${shape.x}%`, '--y': `${shape.y}%`, '--size': `${shape.size}vmin`, '--rotation': `${shape.rotation}deg`, '--duration': `${4 + random() * 3}s`, '--delay': `${-random() * 7}s`, '--sway': `${.9 + random() * 1.8}deg`, '--drift-x': `${Math.cos(angle) * distance}px`, '--drift-y': `${Math.sin(angle) * distance}px`, '--drift-duration': `${8 + random() * 6}s`, '--drift-delay': `${-random() * 14}s`, '--personal-clover-alpha': shape.alpha, '--personal-clover-entry-delay': `${.18 + index * .1}s` };
      Object.entries(variables).forEach(([key, value]) => set(node, key, value));
      node.innerHTML = cloverSVG({ className: 'clover-svg', color: hslToHex(randomThemeColor(theme, random)), variant: 'small' });
      return node;
    });
    field.replaceChildren(...nodes);
  }
  const interactions = field ? createHeroInteractions({ hero: section, reducedMotion, isActive: () => active() && state !== 'prepared' && section.classList.contains('is-current') }) : null;
  function paint(time) {
    const complete = time >= PERSONAL_ENTRANCE_TIMING.total;
    const timing = PERSONAL_ENTRANCE_TIMING;
    section.classList.toggle('personal-enter-managed', true);
    section.classList.toggle('personal-enter-playing', state === 'playing' && !complete);
    section.classList.toggle('personal-enter-ready', complete);
    const pose = personalAvatarPose(phase(time, timing.avatarDelay, timing.avatarDuration));
    set(section, '--personal-avatar-alpha', complete ? 1 : pose.opacity);
    set(section, '--personal-avatar-y', `${complete ? 0 : pose.y}px`);
    set(section, '--personal-avatar-scale-x', complete ? 1 : pose.scaleX);
    set(section, '--personal-avatar-scale-y', complete ? 1 : pose.scaleY);
    set(section, '--personal-field-alpha', complete ? 1 : smooth(phase(time, 180, 720)));
    const texts = ['.personal-eyebrow', '.personal-name', '.personal-bio', '.personal-socials', '.personal-journal'];
    const items = texts.map((selector, index) => ({ node: section.querySelector(selector), delay: timing.textDelay + index * timing.textStagger }));
    items.push({ node: section.querySelector('.personal-return'), delay: timing.footerDelay });
    for (const { node, delay } of items) {
      const amount = complete ? 1 : eased(phase(time, delay, timing.textDuration));
      set(node, '--personal-item-alpha', amount);
      set(node, '--personal-item-y', `${(1 - amount) * 26}px`);
    }
    if (content) content.inert = !complete && time < timing.textDelay + timing.textStagger * 3 + timing.textDuration * .8 ? true : originalInert;
  }
  function stop() { if (frame !== null) win.cancelAnimationFrame(frame); frame = null; }
  function resolve(value) { const done = completion; completion = null; promise = null; done?.(value); }
  function finish({ cancelled = false } = {}) {
    stop(); elapsed = PERSONAL_ENTRANCE_TIMING.total; state = 'ready'; paint(elapsed); interactions?.refresh(); resolve(!cancelled);
    return true;
  }
  function prepare() {
    if (destroyed) return false;
    stop(); resolve(false); interactions?.refresh();
    if (!canAnimate()) { finish(); return false; }
    state = 'prepared'; elapsed = 0; paint(0); return true;
  }
  function tick(timestamp) {
    frame = null;
    if (!canAnimate()) { finish(); return; }
    elapsed = Math.min(PERSONAL_ENTRANCE_TIMING.total, Math.max(0, timestamp - startedAt));
    paint(elapsed);
    if (elapsed >= PERSONAL_ENTRANCE_TIMING.total) finish(); else frame = win.requestAnimationFrame(tick);
  }
  function enter() {
    if (destroyed) return Promise.resolve(false);
    if (state === 'playing') return promise;
    if (state === 'ready') return Promise.resolve(true);
    if (!canAnimate()) { finish(); return Promise.resolve(true); }
    state = 'playing'; elapsed = 0; startedAt = now(); paint(0);
    promise = new Promise(done => { completion = done; });
    frame = win.requestAnimationFrame(tick);
    return promise;
  }
  function refresh() { if (!destroyed) { paint(elapsed); interactions?.refresh(); } }
  function setEnabled(value) {
    enabled = Boolean(value);
    if (field) field.hidden = !enabled;
    if (!enabled) finish({ cancelled: true });
  }
  bind(doc, 'visibilitychange', () => { if (doc.hidden && state === 'playing') finish(); });
  bind(win, 'resize', refresh);
  if (page && typeof win.MutationObserver === 'function') {
    const observer = new win.MutationObserver(() => { if (!destroyed) paint(elapsed); });
    observer.observe(page, { childList: true, subtree: true }); cleanups.push(() => observer.disconnect());
  }
  renderField(); prepare();
  return {
    prepare, enter, finish, refresh, setEnabled,
    setTheme(nextTheme, nextSeed = seed) { if (destroyed) return; theme = nextTheme; seed = nextSeed; renderField(); interactions?.refresh(); },
    get state() { return state; },
    destroy() {
      if (destroyed) return; finish({ cancelled: true }); destroyed = true; interactions?.destroy(); cleanups.splice(0).forEach(dispose => dispose()); field?.replaceChildren();
      section.classList.toggle('personal-enter-managed', false); section.classList.toggle('personal-enter-ready', false);
    },
  };
}
