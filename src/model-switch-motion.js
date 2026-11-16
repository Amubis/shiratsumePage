const SVG_NS = 'http://www.w3.org/2000/svg';
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const mix = (a, b, amount) => a + (b - a) * amount;
const fields = ['center', 'width', 'height', 'shellX', 'shellY'];
let switchSerial = 0;

export const MODEL_SWITCH_TIMING = Object.freeze({ duration: 760 });
export const MODEL_SWITCH_THEMES = Object.freeze({ left: '#B7BB5A', right: '#B8A0C2' });

export function modelSwitchRestPose(selection = 'left') {
  return { center: selection === 'right' ? .75 : .25, width: .455, height: .84, shellX: 1, shellY: 1 };
}

/** One continuously damped stroke, without stops at intermediate keyframes. */
export function modelSwitchTravel(progress) {
  const t=clamp(progress);
  if(t===0 || t===1)return t;
  return 1-Math.exp(-6*t)*(Math.cos(7.6*t)+6/7.6*Math.sin(7.6*t));
}
export function modelSwitchJellyPose(progress,{from=modelSwitchRestPose('left'),selection='right'}={}){
  const t=clamp(progress),rest=modelSwitchRestPose(selection);
  if(t===0)return {...from};
  if(t===1)return rest;
  const travel=modelSwitchTravel(t),settle=smooth(clamp(t*3));
  const deformation=.05*Math.sin(3*Math.PI*t)*Math.sin(Math.PI*t);
  return {center:mix(from.center,rest.center,travel),
    width:mix(from.width,rest.width,settle)+deformation,
    height:mix(from.height,rest.height,settle)-deformation*2,
    shellX:mix(from.shellX,1,settle)-deformation*.6,
    shellY:mix(from.shellY,1,settle)+deformation*.9};
}

/** One document clip survives every frame and is shared with its visible rim. */
export function createModelSwitchMotion({ root, reducedMotion = () => false, themes = MODEL_SWITCH_THEMES, onFrame = () => {} } = {}) {
  if (!root?.ownerDocument) throw new TypeError('A model switch root is required.');
  const doc = root.ownerDocument, win = doc.defaultView;
  const color = root.querySelector('.model-choice-color');
  if (!color) throw new TypeError('A model switch color layer is required.');
  const create = tag => doc.createElementNS(SVG_NS, tag);
  const set = (node, name, value) => { const next = typeof value === 'number' ? String(Number(value.toFixed(6))) : value; if (node.getAttribute(name) !== next) node.setAttribute(name, next); };
  const id = `model-color-window-${++switchSerial}`;
  const definitions = create('svg');
  definitions.setAttribute('width', '0'); definitions.setAttribute('height', '0'); definitions.setAttribute('aria-hidden', 'true'); definitions.setAttribute('focusable', 'false');
  definitions.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;';
  const defs = create('defs'), clip = create('clipPath'), clipRect = create('rect');
  clip.setAttribute('id', id); clip.setAttribute('clipPathUnits', 'objectBoundingBox'); clip.append(clipRect); defs.append(clip); definitions.append(defs);
  (doc.body || doc.documentElement).append(definitions);
  const outline = create('svg'); outline.setAttribute('class', 'model-choice-slider'); outline.setAttribute('viewBox', '0 0 1 1'); outline.setAttribute('preserveAspectRatio', 'none'); outline.setAttribute('aria-hidden', 'true'); outline.setAttribute('focusable', 'false');
  const rim = create('rect'); rim.setAttribute('vector-effect', 'non-scaling-stroke'); outline.append(rim); root.append(outline);
  const pointer=doc.createElementNS(SVG_NS,'svg');pointer.setAttribute('class','model-switch-pointer');pointer.setAttribute('viewBox','0 0 24 16');pointer.setAttribute('aria-hidden','true');
  const arrow=create('path');arrow.setAttribute('d','M3 8h18M7 3 2 8l5 5m10-10 5 5-5 5');pointer.append(arrow);root.append(pointer);
  const previousClip = color.style.clipPath, previousWebkitClip = color.style.webkitClipPath;
  const previousAccent = root.style.getPropertyValue('--model-accent');
  color.style.clipPath = `url("#${id}")`; color.style.webkitClipPath = `url("#${id}")`;
  root.classList.add('has-model-switch-motion');
  const listeners = [];
  let selection = root.dataset.selection === 'right' ? 'right' : 'left';
  const palette = Object.fromEntries(['left','right'].map(side => [side,
    typeof themes?.[side] === 'string' && /^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(themes[side]) ? themes[side] : MODEL_SWITCH_THEMES[side],
  ]));
  let pose = modelSwitchRestPose(selection), startingPose = pose, startedAt = 0, frame = null, destroyed = false;
  const now = () => win.performance?.now() ?? Date.now();
  const reduce = () => typeof reducedMotion === 'function' ? Boolean(reducedMotion()) : Boolean(reducedMotion);
  const bind = (target, event, handler) => { target.addEventListener(event, handler); listeners.push(() => target.removeEventListener(event, handler)); };
  function paintAccent(instant = false) {
    root.classList[instant ? 'add' : 'remove']('is-model-switch-still');
    root.style.setProperty('--model-accent', palette[selection]);
  }
  function paint(next) {
    pose = next;
    for (const rect of [clipRect, rim]) {
      set(rect, 'x', next.center - next.width / 2); set(rect, 'y', (1 - next.height) / 2);
      set(rect, 'width', next.width); set(rect, 'height', next.height); set(rect, 'rx', .052); set(rect, 'ry', .14);
    }
    root.style.setProperty('--model-shell-x', next.shellX.toFixed(5));
    root.style.setProperty('--model-shell-y', next.shellY.toFixed(5));
  }
  function stop() { if (frame !== null) win.cancelAnimationFrame(frame); frame = null; }
  function settle() {stop();paintAccent(true);paint(modelSwitchRestPose(selection));onFrame({selection,progress:1,travel:1});}
  function tick(time) {
    frame = null;
    if (destroyed) return;
    if (reduce() || doc.hidden) { settle(); return; }
    const progress = clamp((time - startedAt) / MODEL_SWITCH_TIMING.duration);
    paint(modelSwitchJellyPose(progress, { from: startingPose, selection }));
    onFrame({selection,progress,travel:modelSwitchTravel(progress)});
    if (progress < 1) frame = win.requestAnimationFrame(tick);
    else paint(modelSwitchRestPose(selection));
  }
  function setSelection(next, { animate = true } = {}) {
    if (destroyed) return false;
    const target = next === 'right' ? 'right' : 'left';
    if (selection === target) return false;
    stop(); selection = target; root.dataset.selection = target; startingPose = { ...pose };
    if (!animate || reduce() || doc.hidden || typeof win.requestAnimationFrame !== 'function') { settle();return true; }
    paintAccent();
    startedAt = now();onFrame({selection,progress:0,travel:0});frame = win.requestAnimationFrame(tick); return true;
  }
  const syncSelection = () => setSelection(root.dataset.selection);
  const Observer = win.MutationObserver;
  const observer = typeof Observer === 'function' ? new Observer(syncSelection) : null;
  observer?.observe(root, { attributes: true, attributeFilter: ['data-selection'] });
  bind(root,'pointermove',event=>{const rect=root.getBoundingClientRect?.();if(rect?.width)root.style.setProperty('--model-pointer-x',`${18+clamp((event.clientX-rect.left)/rect.width)*64}%`);});
  bind(root,'pointerleave',()=>root.style.setProperty('--model-pointer-x','50%'));
  bind(win, 'resize', settle);
  bind(doc, 'visibilitychange', () => { if (doc.hidden) settle(); });
  bind(win, 'pagehide', settle);
  paintAccent(true); paint(pose);
  return {
    setSelection,
    refresh() { if (!destroyed) { syncSelection(); if (reduce() || doc.hidden) settle(); else { paintAccent(); paint(pose); } } },
    get pose() { return { ...pose }; },
    get animating() { return frame !== null; },
    destroy() {
      if (destroyed) return;
      stop(); destroyed = true; observer?.disconnect(); listeners.splice(0).forEach(dispose => dispose());
      definitions.remove(); outline.remove(); pointer.remove(); root.classList.remove('has-model-switch-motion');
      root.classList.remove('is-model-switch-still');
      root.style.removeProperty('--model-shell-x'); root.style.removeProperty('--model-shell-y');
      if (previousAccent) root.style.setProperty('--model-accent', previousAccent);
      else root.style.removeProperty('--model-accent');
      color.style.clipPath = previousClip || ''; color.style.webkitClipPath = previousWebkitClip || '';
    },
  };
}
