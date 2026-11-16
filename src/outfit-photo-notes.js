const safeImageURL = value => {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u0020\u007f\\]/.test(value) || /^(?:\/\/|#|\?)/.test(value)) return null;
  try { return ['http:', 'https:'].includes(new URL(value, 'https://notes.invalid/').protocol) ? value.trim() : null; }
  catch { return null; }
};
const bounded = (value, fallback, low, high) => Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : fallback;

export const OUTFIT_NOTE_TIMING = Object.freeze({ peel: 340, stick: 450, stagger: 45 });

/** Source-pixel crops show the same outfit's face/collar and upper back. */
export function outfitNoteCrop(outfit, side = 'front') {
  const size = outfit?.[`${side}Size`];
  const width = bounded(Array.isArray(size) ? size[0] : outfit?.imageWidth, 1440, 1, 32768);
  const height = bounded(Array.isArray(size) ? size[1] : outfit?.imageHeight, 2560, 1, 32768);
  const input = outfit?.[`${side}Bounds`];
  const valid = Array.isArray(input) && input.length === 4 && input.every(Number.isFinite) && input[2] > input[0] && input[3] > input[1];
  const bounds = valid ? [Math.max(0, input[0]), Math.max(0, input[1]), Math.min(width, input[2]), Math.min(height, input[3])] : [0, 0, width, height];
  const figureHeight = Math.max(1, bounds[3] - bounds[1]);
  const cropHeight = Math.min(height, Math.max(height * .22, figureHeight * .37));
  const cropWidth = Math.min(width, cropHeight * 1.35);
  const actualHeight = Math.min(height, cropWidth / 1.35);
  const left = Math.max(0, Math.min(width - cropWidth, (bounds[0] + bounds[2]) / 2 - cropWidth / 2));
  const top = Math.max(0, Math.min(height - actualHeight, bounds[1] - figureHeight * .025));
  return { width, height, left, top, cropWidth, cropHeight: actualHeight };
}

const restTransform = index => index ? 'rotate(8deg)' : 'rotate(-9deg) translateY(7px)';

export function outfitNotePeelFrames(index = 0) {
  const rest = restTransform(index), direction = index ? 1 : -1;
  return [
    { opacity: 1, transform: `${rest} perspective(650px) translate(0px,0px) rotateX(0deg) rotateY(0deg)`, offset: 0 },
    { opacity: 1, transform: `${rest} perspective(650px) translate(${direction * 3}px,-6px) rotateX(24deg) rotateY(${direction * 10}deg)`, offset: .36 },
    { opacity: 1, transform: `${rest} perspective(650px) translate(${direction * 10}px,-24px) rotateX(43deg) rotateY(${direction * 18}deg) rotateZ(${direction * 6}deg)`, offset: .66 },
    { opacity: 0, transform: `${rest} perspective(650px) translate(${direction * 25}px,-72px) rotateX(58deg) rotateY(${direction * 24}deg) rotateZ(${direction * 15}deg) scale(.92)`, offset: 1 },
  ];
}

export function outfitNoteStickFrames(index = 0) {
  const rest = restTransform(index), direction = index ? 1 : -1;
  return [
    { opacity: 0, transform: `${rest} perspective(650px) translate(${direction * 9}px,-23px) rotateX(-24deg) rotateZ(${direction * 6}deg) scale(1.04)`, offset: 0 },
    { opacity: 1, transform: `${rest} perspective(650px) translate(0px,5px) rotateX(5deg) rotateZ(${-direction * 2}deg) scale(.975)`, offset: .46 },
    { opacity: 1, transform: `${rest} perspective(650px) translate(0px,-2px) rotateX(-2deg) scale(1.012)`, offset: .73 },
    { opacity: 1, transform: rest, offset: 1 },
  ];
}

function normalizedOutfit(input) {
  const front = safeImageURL(input?.front);
  if (!front) return null;
  const back = safeImageURL(input?.back);
  const result = {
    id: typeof input.id === 'string' ? input.id : front,
    front, back,
    imageWidth: input.imageWidth, imageHeight: input.imageHeight,
    frontSize: input.frontSize, backSize: input.backSize,
    frontBounds: input.frontBounds, backBounds: input.backBounds,
  };
  result.signature = JSON.stringify(result);
  return result;
}

/** Decorative only: it never adds a click target or changes the outfit controller. */
export function createOutfitPhotoNotes({ container, reducedMotion = () => false, initialOutfit = null, active = false } = {}) {
  if (!container?.ownerDocument) throw new TypeError('An outfit photo notes container is required.');
  const doc = container.ownerDocument, win = doc.defaultView;
  let current = null, desired = null, isActive = Boolean(active), destroyed = false;
  let generation = 0, phase = 'empty', operation = null;
  let animations = [];
  const loaded = new Map();
  const bindings = [];
  const reduced = () => typeof reducedMotion === 'function' ? reducedMotion() : Boolean(reducedMotion);
  const canAnimate = () => isActive && !reduced() && !doc.hidden && typeof container.animate === 'function';
  const setState = value => { phase = value; container.setAttribute('data-notes-state', value); };
  const bind = (target, event, handler) => { target.addEventListener(event, handler); bindings.push(() => target.removeEventListener(event, handler)); };
  const element = (tag, className) => { const node = doc.createElement(tag); node.className = className; return node; };
  container.setAttribute('data-outfit-notes', '');
  container.setAttribute('aria-hidden', 'true');
  container.replaceChildren();

  function resolveOperation(completed) {
    if (operation) { operation.resolve(completed); operation = null; }
  }
  function cancelAnimations() {
    for (const animation of animations) animation.cancel();
    animations = [];
    for (const node of Array.from(container.children)) node.classList.remove('is-note-peeling', 'is-note-sticking');
  }
  function print(outfit, side, index) {
    const card = element('figure', 'outfit-note-print');
    card.setAttribute('data-note-side', side);
    card.style.setProperty('--note-rest-transform', restTransform(index));
    card.style.setProperty('--note-order', String(index));
    const window = element('span', 'outfit-note-window');
    const image = element('img', 'outfit-note-image');
    image.alt = ''; image.draggable = false; image.decoding = 'async';
    const crop = outfitNoteCrop(outfit, side);
    image.width = crop.width; image.height = crop.height;
    image.style.setProperty('--note-image-width', `${crop.width / crop.cropWidth * 100}%`);
    image.style.setProperty('--note-image-height', `${crop.height / crop.cropHeight * 100}%`);
    image.style.setProperty('--note-image-left', `${-crop.left / crop.cropWidth * 100}%`);
    image.style.setProperty('--note-image-top', `${-crop.top / crop.cropHeight * 100}%`);
    image.src = outfit[side];
    window.append(image); card.append(window); return card;
  }
  function commit(outfit) {
    current = outfit;
    const nodes = outfit ? ['front', ...(outfit.back ? ['back'] : [])].map((side, index) => print(outfit, side, index)) : [];
    container.replaceChildren(...nodes);
    if (outfit) container.setAttribute('data-outfit-id', outfit.id);
    else container.removeAttribute('data-outfit-id');
    setState(outfit ? 'ready' : 'empty');
    return nodes;
  }
  function preload(url) {
    if (loaded.has(url)) return loaded.get(url);
    let loading;
    loading = (async () => {
      const image = doc.createElement('img'); image.decoding = 'async';
      if (typeof image.decode === 'function') { image.src = url; await image.decode(); }
      else await new Promise((resolve, reject) => {
        image.onload = () => { image.onload = image.onerror = null; resolve(); };
        image.onerror = () => { image.onload = image.onerror = null; reject(new Error('Outfit detail image unavailable.')); };
        image.src = url;
        if (image.complete && image.naturalWidth) { image.onload = image.onerror = null; resolve(); }
      });
      return true;
    })().catch(error => { if (loaded.get(url) === loading) loaded.delete(url); throw error; });
    loaded.set(url, loading); return loading;
  }
  function animateBatch(nodes, kind) {
    const frames = kind === 'peel' ? outfitNotePeelFrames : outfitNoteStickFrames;
    const duration = kind === 'peel' ? OUTFIT_NOTE_TIMING.peel : OUTFIT_NOTE_TIMING.stick;
    const pending = nodes.map((node, index) => {
      node.classList.add(kind === 'peel' ? 'is-note-peeling' : 'is-note-sticking');
      const animation = node.animate(frames(index), { duration, delay: index * OUTFIT_NOTE_TIMING.stagger, easing: kind === 'peel' ? 'cubic-bezier(.42,0,.62,1)' : 'cubic-bezier(.2,.7,.3,1)', fill: 'both' });
      animations.push(animation);
      return animation.finished.catch(() => false);
    });
    return Promise.all(pending);
  }
  async function transition(outfit, serial) {
    try {
      setState('loading');
      await Promise.all([outfit.front, outfit.back].filter(Boolean).map(preload));
      if (destroyed || serial !== generation) return;
      if (!canAnimate()) { commit(outfit); resolveOperation(true); return; }
      setState('peeling');
      await animateBatch(Array.from(container.children), 'peel');
      if (destroyed || serial !== generation) return;
      cancelAnimations();
      const nodes = commit(outfit);
      if (!canAnimate()) { resolveOperation(true); return; }
      setState('sticking');
      await animateBatch(nodes, 'stick');
      if (destroyed || serial !== generation) return;
      cancelAnimations(); setState('ready'); resolveOperation(true);
    } catch {
      if (destroyed || serial !== generation) return;
      cancelAnimations(); commit(null); setState('error'); resolveOperation(false);
    }
  }
  function setOutfit(input) {
    if (destroyed) return Promise.resolve(false);
    const next = normalizedOutfit(input);
    if (next?.signature && next.signature === desired?.signature) {
      if (operation) return operation.promise;
      if (current?.signature === next.signature) return Promise.resolve(true);
    }
    generation++; resolveOperation(false); cancelAnimations(); desired = next;
    if (!next || !current || !canAnimate()) { commit(next); return Promise.resolve(true); }
    const serial = generation;
    let resolve;
    const promise = new Promise(yes => { resolve = yes; });
    operation = { serial, resolve, promise };
    void transition(next, serial); return promise;
  }
  function settle() {
    if (!operation) return;
    generation++; cancelAnimations(); commit(desired); resolveOperation(true);
  }
  function refresh() { if (!destroyed && !canAnimate()) settle(); }
  bind(doc, 'visibilitychange', refresh);
  bind(win, 'pagehide', () => { isActive = false; settle(); });
  void setOutfit(initialOutfit);
  return {
    setOutfit, refresh,
    setActive(value) { if (destroyed) return; isActive = Boolean(value); refresh(); },
    get state() { return phase; },
    get outfitId() { return current?.id || null; },
    get pendingId() { return desired?.id || null; },
    destroy() {
      if (destroyed) return;
      generation++; resolveOperation(false); cancelAnimations(); destroyed = true; loaded.clear();
      bindings.splice(0).forEach(dispose => dispose()); container.replaceChildren();
      container.removeAttribute('data-outfit-notes'); container.removeAttribute('data-outfit-id'); container.removeAttribute('data-notes-state');
      phase = 'destroyed';
    },
  };
}
