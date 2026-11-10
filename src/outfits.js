import { cloverSVG } from './scene.js';

/** Each pair uses the supplied front and back of the same outfit. */
export const OUTFITS = Object.freeze([
  Object.freeze({ id: 'sailor', label: Object.freeze({ zh: 'Noir Academy', ja: 'Noir Academy' }), front: './assets/outfits/outfit-v2-01-front.png', back: './assets/outfits/outfit-v2-01-back.png', frontBounds: Object.freeze([396,192,1128,2507]), backBounds: Object.freeze([278,127,1056,2518]) }),
  Object.freeze({ id: 'lace', label: Object.freeze({ zh: '本命Knit', ja: '本命ニット' }), front: './assets/outfits/outfit-v2-02-front.png', back: './assets/outfits/outfit-v2-02-back.png', frontBounds: Object.freeze([247,146,1182,2519]), backBounds: Object.freeze([267,175,1239,2425]) }),
  Object.freeze({ id: 'hoodie', label: Object.freeze({ zh: '小黄鸭', ja: 'ディフォルト' }), front: './assets/outfits/outfit-v2-03-front.png', back: './assets/outfits/outfit-v2-03-back.png', frontBounds: Object.freeze([146,143,1290,2401]), backBounds: Object.freeze([320,154,1340,2385]) }),
  Object.freeze({ id: 'gingham', label: Object.freeze({ zh: 'My Sunny Femme', ja: 'My Sunny Femme' }), front: './assets/outfits/outfit-v2-04-front.png', back: './assets/outfits/outfit-v2-04-back.png', frontBounds: Object.freeze([380,98,1060,2509]), backBounds: Object.freeze([348,89,1056,2533]) }),
]);

/** The introduction and outfit list can share this configuration with a future CMS. */
export const MODEL_PROFILE = Object.freeze({
  name: 'しらつめ',
  zh: Object.freeze({ eyebrow: 'MEET SHIRATSUME.', heading: 'しらつめ', lead: '换一身喜欢的衣服，\n出发收集今天的小小幸运。', description: '轻轻晃动的发梢、软软的猫耳，还有一蹦一跳的日常。\n在不同的衣装之间，遇见同一个可爱的她。' }),
  ja: Object.freeze({ eyebrow: 'MEET SHIRATSUME.', heading: 'しらつめ', lead: 'お気に入りの服に着替えたら、\n今日の小さな幸運を探しに。', description: '揺れる髪も、ふわふわの猫耳も、弾むような毎日も。\nいろいろな装いの中で、いつものかわいい彼女に出会って。' }),
});

const OUTFIT_COPY = Object.freeze({
  zh: Object.freeze({ choose: '选择服装', next: '点击切换下一套服装', front: '正面', back: '背面', inspect: '查看这套服装的背面', failure: '这套服装暂时加载失败，请再试一次。' }),
  ja: Object.freeze({ choose: 'コーデを選ぶ', next: 'タップして次のコーデへ', front: '正面', back: '背面', inspect: 'このコーデの後ろ姿を見る', failure: '画像を読み込めませんでした。もう一度お試しください。' }),
});
const SVG_NS = 'http://www.w3.org/2000/svg';
const IMAGE_WIDTH = 1440;
const IMAGE_HEIGHT = 2560;
let outfitSerial = 0;

/** Normalize the visible figures, rather than assuming equal PNG canvases mean equal height.
 * Optional per-outfit backCalibration: { scale, offsetX, offsetY } uses source-image
 * pixels for offsets, leaving room to correct pose/perspective by eye later. */
export function outfitViewGeometry(outfit) {
  const front = outfit.frontBounds;
  const back = outfit.backBounds;
  const correction = outfit.backCalibration || {};
  const previewScale = (front[3] - front[1]) / Math.max(1, back[3] - back[1]) * (correction.scale ?? 1);
  const restScale = previewScale * .93;
  const frontCenter = (front[0] + front[2]) / (2 * IMAGE_WIDTH);
  const backCenter = (back[0] + back[2]) / (2 * IMAGE_WIDTH);
  const offsetX = (correction.offsetX ?? 0) / IMAGE_WIDTH;
  const offsetY = (correction.offsetY ?? 0) / IMAGE_HEIGHT;
  const horizontal = (scale) => frontCenter - (.5 + (backCenter - .5) * scale) + offsetX;
  const vertical = (scale) => front[3] / IMAGE_HEIGHT - .5 - (back[3] / IMAGE_HEIGHT - .5) * scale + offsetY;
  return {
    restScale, previewScale,
    restX: (-.42 + horizontal(restScale)) * 100,
    previewX: (-.22 + horizontal(previewScale)) * 100,
    restY: vertical(restScale) * 100,
    previewY: vertical(previewScale) * 100,
  };
}

export function wrapOutfitIndex(index, length = OUTFITS.length) {
  if (!Number.isInteger(length) || length < 1) throw new TypeError('An outfit list must contain at least one item.');
  if (!Number.isInteger(index)) throw new TypeError('An outfit index must be an integer.');
  return ((index % length) + length) % length;
}

/** Visual spacing is independent from the fixed, accessible 44px button slots. */
export function outfitRailGeometry(position, count = OUTFITS.length, slot = 44) {
  const focus = Math.max(-.12, Math.min(count - .88, Number(position) || 0));
  const influence = (distance) => Math.max(0, 1 - Math.abs(distance) / 1.3);
  const gaps = Array.from({ length: Math.max(0, count - 1) }, (_, index) => 24 + 16 * influence(index + .5 - focus));
  let x = count * slot / 2 - gaps.reduce((sum, gap) => sum + gap, 0) / 2;
  const dots = Array.from({ length: count }, (_, index) => {
    if (index) x += gaps[index - 1];
    const distance = Math.abs(index - focus);
    const amount = influence(distance);
    return { index, x, size: 5 + 5 * amount, opacity: (.25 + .65 * amount) * Math.min(1, distance / .24), influence: amount };
  });
  const lower = Math.max(0, Math.min(count - 2, Math.floor(focus)));
  const cloverX = count === 1 ? dots[0].x : dots[lower].x + (dots[lower + 1].x - dots[lower].x) * (focus - lower);
  return { position: focus, width: count * slot, dots, cloverX, cloverSize: 26 };
}

/** Pointer clicks resolve against what is actually painted, including moving gaps. */
export function nearestOutfitDot(x, geometry) {
  return geometry.dots.reduce((best, dot) => Math.abs(dot.x - x) < Math.abs(best.x - x) ? dot : best).index;
}

function railPositionAtX(x, count) {
  let lower = 0;
  let upper = count - 1;
  for (let step = 0; step < 18; step += 1) {
    const middle = (lower + upper) / 2;
    if (outfitRailGeometry(middle, count).cloverX < x) lower = middle;
    else upper = middle;
  }
  return (lower + upper) / 2;
}

export const OUTFIT_HINT_TIMING = Object.freeze({ delay: 4000, duration: 2800 });

/** One selected outfit with independently accessible front and rear views. */
export function createOutfitShowcase({ container, language = 'zh', reducedMotion = () => false, onChange = () => {} } = {}) {
  if (!container?.ownerDocument) throw new TypeError('An outfit showcase container is required.');
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  const uid = `outfit-showcase-${++outfitSerial}`;
  const listeners = [];
  const preloads = new Map();
  const animations = new Set();
  let locale = language === 'ja' ? 'ja' : 'zh';
  let currentIndex = 0;
  let enabled = true;
  let busy = false;
  let interacted = false;
  let hintActive = false;
  let hintShown = false;
  let hintHovered = false;
  let hintFocused = false;
  let hintTimer = null;
  let hintEndTimer = null;
  let hintSerial = 0;
  let destroyed = false;
  let serial = 0;
  let pressAnimation;
  let backPressAnimation;
  let backHovered = false;
  let backFocused = false;
  let backPointerFocus = false;
  let backPointerType = 'mouse';
  let pressed = false;
  let pressReleased = false;
  let pressPointer = null;
  let pressOwner = null;
  let pressBounds = null;
  let keyboardHeld = false;
  let suppressClick = false;
  let railPosition = 0;
  let railTarget = 0;
  let railVelocity = 0;
  let railRotation = 0;
  let railFrame = null;
  let railTime = null;
  let railHovered = false;
  let railPointerX = null;
  let railMagnet = null;
  let shadowFrame = null;
  let shadowStartedAt = null;
  let shadowDuration = 0;
  let shadowLastPaint = -Infinity;
  let shadowResizeObserver;

  function element(tag, className) {
    const node = doc.createElement(tag);
    node.className = className;
    return node;
  }
  function svgElement(tag, attributes = {}) {
    const node = doc.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
    return node;
  }
  function bind(node, type, handler) {
    node.addEventListener(type, handler);
    listeners.push(() => node.removeEventListener(type, handler));
  }

  container.classList.add('outfit-showcase');
  const pair = element('div', 'outfit-pair');
  const stage = element('button', 'outfit-stage');
  stage.type = 'button';
  const art = element('span', 'outfit-art');
  // Both alpha silhouettes compose first; the pattern receives one opacity only.
  // This sibling of both portrait buttons can never paint over either picture.
  const shadow = svgElement('svg', { class: 'outfit-shadow outfit-shared-shadow', viewBox: `0 0 ${IMAGE_WIDTH} ${IMAGE_HEIGHT}`, 'aria-hidden': 'true', focusable: 'false', preserveAspectRatio: 'none' });
  const shadowDefs = svgElement('defs');
  const shadowMask = svgElement('mask', { id: `${uid}-mask`, maskUnits: 'userSpaceOnUse', x: '-320', y: '-320', width: IMAGE_WIDTH + 640, height: IMAGE_HEIGHT + 640, 'mask-type': 'alpha', style: 'mask-type:alpha', 'data-composite': 'alpha-union' });
  const shadowSources = [OUTFITS[0].front, OUTFITS[0].back].map((source, index) => svgElement('image', { class: index ? 'outfit-projection-back' : 'outfit-projection-front', x: '0', y: '0', width: IMAGE_WIDTH, height: IMAGE_HEIGHT, preserveAspectRatio: 'xMidYMid meet', href: source }));
  shadowMask.append(...shadowSources);
  const shadowPattern = svgElement('pattern', { id: `${uid}-dots`, width: '52', height: '52', patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(8)' });
  shadowPattern.append(svgElement('circle', { cx: '26', cy: '26', r: '19', fill: 'currentColor' }));
  shadowDefs.append(shadowMask, shadowPattern);
  const shadowGroup = svgElement('g', { mask: `url(#${uid}-mask)`, opacity: '.36' });
  const shadowPaint = svgElement('rect', { x: '-320', y: '-320', width: IMAGE_WIDTH + 640, height: IMAGE_HEIGHT + 640, fill: `url(#${uid}-dots)` });
  shadowGroup.append(shadowPaint);
  shadow.append(shadowDefs, shadowGroup);
  const image = element('img', 'outfit-image');
  image.width = IMAGE_WIDTH;
  image.height = IMAGE_HEIGHT;
  image.decoding = 'async';
  image.draggable = false;
  image.src = OUTFITS[0].front;
  art.append(image);
  const cue = element('span', 'outfit-cue');
  cue.setAttribute('aria-hidden', 'true');
  cue.hidden = true;
  cue.style.setProperty('--hint-duration', `${OUTFIT_HINT_TIMING.duration}ms`);
  const cueArt = element('span', 'outfit-cue-art');
  cueArt.innerHTML = `${cloverSVG({ className: 'clover-svg', variant: 'small' })}<svg class="outfit-cue-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 12V5a2 2 0 0 1 4 0v6l1.8-1a2 2 0 0 1 1.7-.1l3.2 1.3A2.2 2.2 0 0 1 20 13.3V17a5 5 0 0 1-5 5h-2a5 5 0 0 1-4-2L4.6 14a1.7 1.7 0 0 1 2.6-2.2L8 13"/><path d="M3.5 5.5 2 4M6 2.3V1M14 3l1.5-1.5"/></svg>`;
  cue.append(cueArt);
  stage.append(art, cue);
  const backStage = element('button', 'outfit-back-stage');
  backStage.type = 'button';
  const backArt = element('span', 'outfit-back-art');
  const backImage = element('img', 'outfit-back-image');
  backImage.width = IMAGE_WIDTH;
  backImage.height = IMAGE_HEIGHT;
  backImage.decoding = 'async';
  backImage.draggable = false;
  backImage.src = OUTFITS[0].back;
  backArt.append(backImage);
  backStage.append(backArt);
  pair.append(shadow, stage, backStage);
  const footer = element('div', 'outfit-footer');
  const dots = element('div', 'outfit-dots');
  dots.setAttribute('role', 'group');
  const railClover = element('span', 'outfit-rail-clover');
  railClover.setAttribute('aria-hidden', 'true');
  railClover.innerHTML = cloverSVG({ className: 'clover-svg', variant: 'small' });
  const dotButtons = OUTFITS.map((outfit, index) => {
    const button = element('button', 'outfit-dot');
    button.type = 'button';
    button.style.left = `${index * 44}px`;
    const circle = element('span', 'outfit-dot-circle');
    circle.setAttribute('aria-hidden', 'true');
    button.append(circle);
    dots.append(button);
    bind(button, 'click', (event) => {
      event.stopPropagation();
      const selected = event.detail && Number.isFinite(event.clientX) ? pickPointerDot(event.clientX) : index;
      void goTo(selected);
    });
    bind(button, 'focus', () => { if (!railHovered) targetRail(index); });
    bind(button, 'blur', () => { if (!railHovered) targetRail(currentIndex); });
    bind(button, 'keydown', (event) => {
      const targets = { ArrowLeft: wrapOutfitIndex(index - 1), ArrowRight: wrapOutfitIndex(index + 1), Home: 0, End: OUTFITS.length - 1 };
      if (!Object.hasOwn(targets, event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      dotButtons[targets[event.key]].focus?.();
      void goTo(targets[event.key]);
    });
    return button;
  });
  dots.append(railClover);
  const status = element('p', 'outfit-status sr-only');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  footer.append(dots);
  container.replaceChildren(pair, footer, status);

  const setShadowAttribute = (node, name, value) => {
    const text = String(value);
    if (node.getAttribute(name) !== text) node.setAttribute(name, text);
  };
  const cssLength = (value, extent) => {
    const number = Number.parseFloat(value);
    if (!Number.isFinite(number)) return 0;
    return String(value).includes('%') ? number / 100 * extent : number;
  };
  function paintSharedShadow() {
    if (destroyed) return;
    const pairStyle = win?.getComputedStyle?.(pair);
    const bounds = pair.getBoundingClientRect();
    const pixelWidth = Number.parseFloat(pairStyle?.width) || pair.clientWidth || bounds.width || 500;
    const pixelHeight = Number.parseFloat(pairStyle?.height) || pair.clientHeight || bounds.height || 600;
    const units = IMAGE_HEIGHT / pixelHeight;
    const viewWidth = pixelWidth * units;
    setShadowAttribute(shadow, 'viewBox', `0 0 ${viewWidth.toFixed(5)} ${IMAGE_HEIGHT}`);
    for (const node of [shadowMask, shadowPaint]) setShadowAttribute(node, 'width', (viewWidth + 640).toFixed(5));
    const inspecting = pair.classList.contains('is-back-inspected');
    const geometry = outfitViewGeometry(OUTFITS[currentIndex]);
    [stage, backStage].forEach((node, index) => {
      const style = win?.getComputedStyle?.(node);
      let width = IMAGE_WIDTH, height = IMAGE_HEIGHT;
      let x = viewWidth / 2, y = 0;
      let tx = index ? geometry[inspecting ? 'previewX' : 'restX'] / 100 * IMAGE_WIDTH : (inspecting ? -.7 : -.62) * IMAGE_WIDTH;
      let ty = index ? geometry[inspecting ? 'previewY' : 'restY'] / 100 * IMAGE_HEIGHT : 0;
      let sx = index ? geometry[inspecting ? 'previewScale' : 'restScale'] : 1;
      let sy = sx;
      let originX = width / 2, originY = height / 2;
      let pressX = 0, pressY = 0;
      let pressScaleX = pressed || pressReleased ? .94 : 1;
      let pressScaleY = pressScaleX;
      if (style) {
        width = (Number.parseFloat(style.width) || IMAGE_WIDTH / units) * units;
        height = (Number.parseFloat(style.height) || pixelHeight) * units;
        x = cssLength(style.left, pixelWidth) * units;
        y = cssLength(style.top, pixelHeight) * units;
        const translations = String(style.translate || 'none').split(/\s+/);
        tx = cssLength(translations[0], width / units) * units;
        ty = cssLength(translations[1] || '0', height / units) * units;
        const scales = String(style.scale || 'none').split(/\s+/).map(Number);
        sx = Number.isFinite(scales[0]) ? scales[0] : 1;
        sy = Number.isFinite(scales[1]) ? scales[1] : sx;
        const origins = String(style.transformOrigin || '50% 50%').split(/\s+/);
        originX = cssLength(origins[0], width / units) * units;
        originY = cssLength(origins[1], height / units) * units;
        const matrix = String(style.transform || '').match(/\(([^)]+)\)/)?.[1].split(',').map(Number);
        pressScaleX = matrix?.[0] ?? 1;
        pressScaleY = matrix?.[matrix.length === 16 ? 5 : 3] ?? 1;
        pressX = (matrix?.[matrix.length === 16 ? 12 : 4] || 0) * units;
        pressY = (matrix?.[matrix.length === 16 ? 13 : 5] || 0) * units;
      }
      const finalScaleX = sx * pressScaleX, finalScaleY = sy * pressScaleY;
      x += tx + originX * (1 - finalScaleX) + pressX * sx;
      y += ty + originY * (1 - finalScaleY) + pressY * sy;
      setShadowAttribute(shadowSources[index], 'transform', `matrix(${(finalScaleX * width / IMAGE_WIDTH).toFixed(6)} 0 0 ${(finalScaleY * height / IMAGE_HEIGHT).toFixed(6)} ${x.toFixed(5)} ${y.toFixed(5)})`);
    });
  }
  function stopSharedShadow() {
    if (shadowFrame !== null) win?.cancelAnimationFrame?.(shadowFrame);
    shadowFrame = null; shadowStartedAt = null; shadowDuration = 0;
  }
  function trackSharedShadow(duration = 650) {
    if (destroyed) return;
    paintSharedShadow();
    if (!enabled || reducedMotion() || doc.hidden || !win?.requestAnimationFrame) { stopSharedShadow(); return; }
    // Read the live CSS interpolation only while a scale/press/layout transition
    // is in flight. Whole-pair water drifting moves the SVG with its siblings.
    shadowStartedAt = null;
    shadowDuration = duration;
    if (shadowFrame !== null) return;
    const tick = (time) => {
      shadowFrame = null;
      if (destroyed || !enabled || doc.hidden) { stopSharedShadow(); return; }
      if (shadowStartedAt === null) shadowStartedAt = time;
      if (time - shadowLastPaint >= 1000 / 60 || time - shadowStartedAt >= shadowDuration || reducedMotion()) {
        paintSharedShadow(); shadowLastPaint = time;
      }
      if (reducedMotion() || time - shadowStartedAt >= shadowDuration) { stopSharedShadow(); return; }
      shadowFrame = win.requestAnimationFrame(tick);
    };
    shadowFrame = win.requestAnimationFrame(tick);
  }

  function syncBackInspection() {
    const inspecting = enabled && !busy && (backHovered || backFocused);
    const changed = pair.classList.contains('is-back-inspected') !== inspecting;
    pair.classList.toggle('is-back-inspected', inspecting);
    if (changed) trackSharedShadow();
  }

  function resetBackInspection() {
    backHovered = backFocused = false;
    backPointerFocus = false;
    syncBackInspection();
  }

  function updateHitBounds(node, bounds) {
    // Crop only the transparent canvas around each supplied silhouette. The
    // image stays untouched; a generous margin keeps its pointer target usable.
    const margin = 80;
    const [left, top, right, bottom] = bounds;
    node.style.clipPath = `inset(${Math.max(0,top-margin)/IMAGE_HEIGHT*100}% ${Math.max(0,IMAGE_WIDTH-right-margin)/IMAGE_WIDTH*100}% ${Math.max(0,IMAGE_HEIGHT-bottom-margin)/IMAGE_HEIGHT*100}% ${Math.max(0,left-margin)/IMAGE_WIDTH*100}%)`;
  }

  function renderLabels(announce = false) {
    const copy = OUTFIT_COPY[locale];
    const outfit = OUTFITS[currentIndex];
    const label = outfit.label[locale];
    const number = `${String(currentIndex + 1).padStart(2, '0')} / ${String(OUTFITS.length).padStart(2, '0')}`;
    stage.setAttribute('aria-label', `${label} · ${copy.next}`);
    stage.setAttribute('aria-busy', String(busy));
    stage.disabled = !enabled;
    backStage.disabled = !enabled;
    backStage.setAttribute('aria-label', `${label} · ${copy.back} · ${copy.next}`);
    backStage.setAttribute('aria-busy', String(busy));
    image.alt = `しらつめ · ${label} · ${copy.front}`;
    backImage.alt = `しらつめ · ${label} · ${copy.back}`;
    updateHitBounds(stage, outfit.frontBounds);
    updateHitBounds(backStage, outfit.backBounds);
    const geometry = outfitViewGeometry(outfit);
    for (const mode of ['rest', 'preview']) {
      pair.style.setProperty(`--back-${mode}-scale`, String(geometry[`${mode}Scale`]));
      pair.style.setProperty(`--back-${mode}-x`, `${geometry[`${mode}X`]}%`);
      pair.style.setProperty(`--back-${mode}-y`, `${geometry[`${mode}Y`]}%`);
    }
    syncBackInspection();
    refreshHint();
    dots.setAttribute('aria-label', copy.choose);
    dotButtons.forEach((button, index) => {
      button.setAttribute('aria-label', `${OUTFITS[index].label[locale]} (${index + 1} / ${OUTFITS.length})`);
      button.setAttribute('aria-pressed', String(index === currentIndex));
      button.classList.toggle('is-selected', index === currentIndex);
      button.disabled = !enabled;
    });
    if (announce) status.textContent = `${label} · ${number}`;
    trackSharedShadow();
  }

  function paintRail() {
    const geometry = outfitRailGeometry(railPosition);
    dots.style.width = `${geometry.width}px`;
    geometry.dots.forEach((dot) => {
      const circle = dotButtons[dot.index].children[0];
      circle.style.left = `${dot.x - dot.index * 44}px`;
      circle.style.width = `${dot.size}px`;
      circle.style.height = `${dot.size}px`;
      circle.style.opacity = String(dot.opacity);
      circle.style.setProperty('--dot-influence', String(dot.influence));
    });
    railClover.style.left = `${geometry.cloverX}px`;
    railClover.style.transform = `translate(-50%, -50%) rotate(${railRotation}deg)`;
  }

  function stopRail() {
    if (railFrame !== null) win?.cancelAnimationFrame?.(railFrame);
    railFrame = null;
    railTime = null;
  }

  function rollBetween(from, to) {
    const previous = outfitRailGeometry(from);
    const next = outfitRailGeometry(to);
    return (next.cloverX - previous.cloverX) / (next.cloverSize / 2) * 180 / Math.PI;
  }

  function targetRail(target, immediate = false) {
    if (destroyed) return;
    railTarget = Math.max(0, Math.min(OUTFITS.length - 1, target));
    if (immediate || reducedMotion() || !win?.requestAnimationFrame) {
      stopRail();
      railRotation += rollBetween(railPosition, railTarget);
      railPosition = railTarget;
      railVelocity = 0;
      paintRail();
      return;
    }
    if (railFrame !== null) return;
    const tick = (time) => {
      railFrame = null;
      if (destroyed || !enabled) { railTime = null; return; }
      const dt = Math.min(1 / 30, Math.max(1 / 240, railTime === null ? 1 / 60 : (time - railTime) / 1000));
      railTime = time;
      const before = railPosition;
      const stiffness = railHovered ? 350 : 210;
      const damping = railHovered ? 32 : 21;
      railVelocity += (stiffness * (railTarget - railPosition) - damping * railVelocity) * dt;
      railPosition += railVelocity * dt;
      // Pointer travel has firm end stops. Programmatic turns retain their
      // small water-like settling overshoot at either end of the rail.
      if (railHovered && (railPosition < 0 || railPosition > OUTFITS.length - 1)) {
        railPosition = Math.max(0, Math.min(OUTFITS.length - 1, railPosition));
        railVelocity = 0;
      }
      railRotation += rollBetween(before, railPosition);
      paintRail();
      if (Math.abs(railPosition - railTarget) < .0015 && Math.abs(railVelocity) < .012) {
        railRotation += rollBetween(railPosition, railTarget);
        railPosition = railTarget;
        railVelocity = 0;
        railTime = null;
        paintRail();
        return;
      }
      railFrame = win.requestAnimationFrame(tick);
    };
    railFrame = win.requestAnimationFrame(tick);
  }

  function localRailX(clientX) {
    const bounds = dots.getBoundingClientRect();
    return (clientX - bounds.left) * (OUTFITS.length * 44 / (bounds.width || OUTFITS.length * 44));
  }

  function pickPointerDot(clientX) {
    return nearestOutfitDot(localRailX(clientX), outfitRailGeometry(railPosition));
  }

  function followRailPointer(event) {
    if (!enabled || event.pointerType === 'touch' || !Number.isFinite(event.clientX)) return;
    railHovered = true;
    if (railPosition < 0 || railPosition > OUTFITS.length - 1) {
      const edge = Math.max(0, Math.min(OUTFITS.length - 1, railPosition));
      railRotation += rollBetween(railPosition, edge);
      railPosition = edge;
      railVelocity = 0;
      paintRail();
    }
    railPointerX = localRailX(event.clientX);
    const geometry = outfitRailGeometry(railPosition);
    const first = geometry.dots[0];
    const last = geometry.dots.at(-1);
    if (railPointerX <= first.x + 14) railMagnet = first.index;
    else if (railPointerX >= last.x - 14) railMagnet = last.index;
    else if (railMagnet !== null && Math.abs(railPointerX - geometry.dots[railMagnet].x) <= 18) {
      targetRail(railMagnet);
      return;
    } else railMagnet = null;
    if (railMagnet !== null) { targetRail(railMagnet); return; }
    const nearest = geometry.dots[nearestOutfitDot(railPointerX, geometry)];
    if (Math.abs(railPointerX - nearest.x) <= 14) railMagnet = nearest.index;
    targetRail(railMagnet ?? railPositionAtX(railPointerX, OUTFITS.length));
  }

  bind(dots, 'pointerenter', followRailPointer);
  bind(dots, 'pointermove', followRailPointer);
  bind(dots, 'pointerleave', () => {
    railHovered = false;
    railPointerX = null;
    railMagnet = null;
    targetRail(currentIndex);
  });
  bind(dots, 'click', (event) => {
    if (!event.detail || !Number.isFinite(event.clientX)) return;
    void goTo(pickPointerDot(event.clientX));
  });

  function markInteracted() {
    interacted = true;
    hideHint();
  }

  function hideHint() {
    hintSerial += 1;
    if (hintTimer !== null) win.clearTimeout(hintTimer);
    if (hintEndTimer !== null) win.clearTimeout(hintEndTimer);
    hintTimer = hintEndTimer = null;
    cue.classList.remove('is-hint-visible');
    cue.hidden = true;
  }

  function canWaitForHint() {
    return !destroyed && enabled && hintActive && !doc.hidden && !interacted && !hintShown && !busy && !pressed && !hintHovered && !hintFocused;
  }

  function refreshHint() {
    if (!canWaitForHint()) { hideHint(); return; }
    if (hintTimer !== null) return;
    const generation = hintSerial;
    hintTimer = win.setTimeout(() => {
      if (generation !== hintSerial) return;
      hintTimer = null;
      if (!canWaitForHint()) return;
      hintShown = true;
      cue.hidden = false;
      cue.classList.add('is-hint-visible');
      hintEndTimer = win.setTimeout(() => { if (generation === hintSerial) hideHint(); }, OUTFIT_HINT_TIMING.duration);
    }, OUTFIT_HINT_TIMING.delay);
  }

  function preload(index) {
    const outfit = OUTFITS[wrapOutfitIndex(index)];
    if (preloads.has(outfit.id)) return preloads.get(outfit.id);
    const loading = (async () => {
      try {
        return await Promise.all([outfit.front, outfit.back].map(async (source) => {
          const loaded = doc.createElement('img');
          loaded.decoding = 'async';
          loaded.fetchPriority = 'low';
          loaded.src = source;
          if (loaded.decode) await loaded.decode();
          else if (!loaded.complete) await new Promise((resolve, reject) => { loaded.onload = resolve; loaded.onerror = reject; });
          return loaded;
        }));
      } catch {
        preloads.delete(outfit.id);
        return null;
      }
    })();
    preloads.set(outfit.id, loading);
    return loading;
  }

  async function animateArt(frames, duration) {
    if (reducedMotion() || !art.animate) return;
    const turns = [art, backArt].map(node => node.animate(frames, { duration, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' }));
    turns.forEach(animation => animations.add(animation));
    await Promise.all(turns.map(async animation => {
      try { await animation.finished; } catch { /* The component can be hidden or destroyed mid-turn. */ }
      animations.delete(animation); animation.cancel();
    }));
  }

  async function goTo(index, { animate = true, interaction = true } = {}) {
    if (destroyed || !enabled || busy || !Number.isInteger(index)) return false;
    const destination = wrapOutfitIndex(index);
    if (interaction) markInteracted();
    if (destination === currentIndex) { if (pressReleased) cancelPress(); return true; }
    const request = ++serial;
    const direction = wrapOutfitIndex(destination - currentIndex) <= OUTFITS.length / 2 ? 1 : -1;
    busy = true;
    resetBackInspection();
    stage.setAttribute('aria-busy', 'true');
    backStage.setAttribute('aria-busy', 'true');
    const loaded = await preload(destination);
    if (destroyed || !enabled || request !== serial) return false;
    if (!loaded) {
      busy = false;
      cancelPress();
      stage.setAttribute('aria-busy', 'false');
      backStage.setAttribute('aria-busy', 'false');
      status.textContent = OUTFIT_COPY[locale].failure;
      return false;
    }
    // A slow connection leaves the released portrait quietly compressed until
    // its replacement is decoded. Rebound and flip then begin together.
    if (pressReleased || pressed) reboundPress();
    if (animate && !reducedMotion()) pair.classList.add('is-outfit-turning');
    if (animate && !reducedMotion()) await animateArt([
      { transform: 'translateX(0) rotateY(0deg)', opacity: 1 },
      { transform: `translateX(${-direction * 22}px) rotateY(${-direction * 66}deg)`, opacity: 0 },
    ], 190);
    if (destroyed || !enabled || request !== serial) return false;
    currentIndex = destination;
    image.src = OUTFITS[currentIndex].front;
    backImage.src = OUTFITS[currentIndex].back;
    shadowSources[0].setAttribute('href', OUTFITS[currentIndex].front);
    shadowSources[1].setAttribute('href', OUTFITS[currentIndex].back);
    renderLabels(true);
    if (!railHovered) targetRail(currentIndex);
    onChange(currentIndex, OUTFITS[currentIndex]);
    if (animate && !reducedMotion()) await animateArt([
      { transform: `translateX(${direction * 22}px) rotateY(${direction * 66}deg)`, opacity: 0 },
      { transform: `translateX(${-direction * 2}px) rotateY(${-direction * 3}deg) rotateZ(${-direction * .8}deg)`, opacity: 1, offset: .8 },
      { transform: 'translateX(0) rotateY(0deg)', opacity: 1 },
    ], 320);
    if (destroyed || !enabled || request !== serial) return false;
    busy = false;
    pair.classList.remove('is-outfit-turning');
    trackSharedShadow();
    stage.setAttribute('aria-busy', 'false');
    backStage.setAttribute('aria-busy', 'false');
    refreshHint();
    void preload(currentIndex + 1);
    return true;
  }

  function holdPress(target = stage) {
    if (destroyed || !enabled || busy) return false;
    pressAnimation?.cancel();
    backPressAnimation?.cancel();
    if (target !== backStage) resetBackInspection();
    pressed = true;
    hideHint();
    pressReleased = false;
    stage.classList.add('is-pressed');
    stage.style.transform = 'scale(.94)';
    backStage.style.transform = 'scale(.94)';
    if (!reducedMotion() && stage.animate) {
      pressAnimation = stage.animate([{ transform: 'scale(1)' }, { transform: 'scale(.94)' }], { duration: 110, easing: 'cubic-bezier(.2,.65,.3,1)', fill: 'forwards' });
      pressAnimation.finished?.catch(() => {});
      backPressAnimation = backStage.animate([{ transform: 'scale(1)' }, { transform: 'scale(.94)' }], { duration: 110, easing: 'cubic-bezier(.2,.65,.3,1)', fill: 'forwards' });
      backPressAnimation.finished?.catch(() => {});
    }
    trackSharedShadow();
    return true;
  }

  function releasePointerCapture() {
    const id = pressPointer;
    const owner = pressOwner;
    pressPointer = null;
    pressOwner = null;
    if (id !== null && owner?.hasPointerCapture?.(id)) owner.releasePointerCapture(id);
  }

  function cancelPress() {
    pressed = false;
    pressReleased = false;
    keyboardHeld = false;
    pressBounds = null;
    releasePointerCapture();
    pressAnimation?.cancel();
    backPressAnimation?.cancel();
    pressAnimation = null;
    backPressAnimation = null;
    stage.classList.remove('is-pressed');
    stage.style.transform = '';
    backStage.style.transform = '';
    trackSharedShadow();
    refreshHint();
  }

  function reboundPress() {
    pressed = false;
    pressReleased = false;
    keyboardHeld = false;
    releasePointerCapture();
    pressAnimation?.cancel();
    backPressAnimation?.cancel();
    stage.classList.remove('is-pressed');
    stage.style.transform = '';
    backStage.style.transform = '';
    trackSharedShadow();
    if (reducedMotion() || !stage.animate) { pressAnimation = backPressAnimation = null; return; }
    const animation = stage.animate([
      { transform: 'scale(.94)' },
      { transform: 'scale(1.06)', offset: .34 },
      { transform: 'scale(.995)', offset: .74 },
      { transform: 'scale(1)' },
    ], { duration: 480, easing: 'cubic-bezier(.2,.65,.3,1)', fill: 'both' });
    pressAnimation = animation;
    const backAnimation = backStage.animate([
      { transform: 'scale(.94)' },
      { transform: 'scale(1.06)', offset: .34 },
      { transform: 'scale(.995)', offset: .74 },
      { transform: 'scale(1)' },
    ], { duration: 480, easing: 'cubic-bezier(.2,.65,.3,1)', fill: 'both' });
    backPressAnimation = backAnimation;
    backAnimation.finished.then(() => {
      if (backPressAnimation === backAnimation) { backAnimation.cancel(); backPressAnimation = null; }
    }).catch(() => {});
    animation.finished.then(() => {
      if (pressAnimation === animation) { animation.cancel(); pressAnimation = null; }
    }).catch(() => {});
  }

  // Both visible views use one press/rebound/flip interaction.
  for (const target of [stage, backStage]) {
    bind(target, 'pointerdown', (event) => {
      const bounds = target.getBoundingClientRect?.();
      if ((event.button ?? 0) !== 0 || !holdPress(target)) return;
      pressBounds = bounds;
      suppressClick = false;
      pressPointer = event.pointerId ?? null;
      pressOwner = target;
      if (pressPointer !== null) target.setPointerCapture?.(pressPointer);
    });
    bind(target, 'pointerup', (event) => {
      if (!pressed || (pressPointer !== null && event.pointerId !== pressPointer)) return;
      const rect = pressBounds || target.getBoundingClientRect?.();
      const outside = rect && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
        && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
      pressed = false;
      if (outside) { suppressClick = true; cancelPress(); return; }
      pressReleased = true;
      releasePointerCapture();
    });
    bind(target, 'pointercancel', () => { suppressClick = true; cancelPress(); });
    bind(target, 'lostpointercapture', () => { if (pressed) { suppressClick = true; cancelPress(); } });
    bind(target, 'blur', () => { if ((keyboardHeld || pressed) && (!pressOwner || pressOwner === target)) cancelPress(); });
    bind(target, 'click', (event) => {
      event.stopPropagation();
      if (suppressClick) { suppressClick = false; return; }
      if (destroyed || !enabled || busy) return;
      if (!pressReleased) { holdPress(target); pressed = false; pressReleased = true; }
      void goTo(currentIndex + 1);
    });
    bind(target, 'keydown', (event) => {
      // A cancelled pointer gesture must not swallow a later keyboard activation.
      if (event.key === 'Enter') { suppressClick = false; return; }
      if (event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat && holdPress(target)) keyboardHeld = true;
        return;
      }
      const targets = { ArrowLeft: currentIndex - 1, ArrowRight: currentIndex + 1, Home: 0, End: OUTFITS.length - 1 };
      if (!Object.hasOwn(targets, event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      void goTo(targets[event.key]);
    });
    bind(target, 'keyup', (event) => {
      if ((event.key !== ' ' && event.key !== 'Spacebar') || !keyboardHeld) return;
      event.preventDefault();
      event.stopPropagation();
      keyboardHeld = false;
      pressed = false;
      pressReleased = true;
      void goTo(currentIndex + 1);
    });
  }
  bind(backStage, 'pointerenter', (event) => {
    if (event.pointerType === 'touch') return;
    backHovered = true; syncBackInspection();
  });
  bind(backStage, 'pointerleave', () => { backHovered = false; syncBackInspection(); });
  bind(backStage, 'pointerdown', (event) => {
    backPointerType = event.pointerType || 'mouse';
    backPointerFocus = true;
    markInteracted();
  });
  bind(backStage, 'pointerup', () => { queueMicrotask(() => { backPointerFocus = false; }); });
  bind(backStage, 'pointercancel', () => { backPointerFocus = false; });
  bind(backStage, 'focus', () => {
    // Touch browsers may deliver focus after pointerup. Only keyboard-visible
    // focus owns inspection; touch activation advances to the next outfit.
    backFocused = typeof backStage.matches === 'function' ? backStage.matches(':focus-visible') : !backPointerFocus && backPointerType !== 'touch';
    syncBackInspection();
  });
  bind(backStage, 'blur', () => { backFocused = false; syncBackInspection(); });
  bind(backStage, 'keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); resetBackInspection();
    }
  });
  for (const target of [pair, dots]) {
    bind(target, 'pointerenter', (event) => {
      if (event.pointerType === 'touch') return;
      hintHovered = true;
      refreshHint();
    });
    bind(target, 'pointerleave', () => { hintHovered = false; refreshHint(); });
  }
  for (const target of [stage, backStage, ...dotButtons]) {
    bind(target, 'focus', () => { hintFocused = true; refreshHint(); });
    bind(target, 'blur', () => { hintFocused = false; refreshHint(); });
  }
  if (win?.addEventListener) bind(win, 'resize', () => trackSharedShadow());
  if (doc.addEventListener) bind(doc, 'visibilitychange', () => {
    if (doc.hidden) stopSharedShadow(); else trackSharedShadow();
    refreshHint();
  });
  if (win?.addEventListener) {
    bind(win, 'pagehide', hideHint);
    bind(win, 'pageshow', refreshHint);
  }
  if (typeof win?.ResizeObserver === 'function') {
    shadowResizeObserver = new win.ResizeObserver(() => trackSharedShadow());
    shadowResizeObserver.observe(pair);
    listeners.push(() => shadowResizeObserver.disconnect());
  }
  renderLabels();
  targetRail(currentIndex, true);
  void preload(0).then(() => { if (!destroyed) void preload(1); });

  return {
    get index() { return currentIndex; },
    goTo,
    next() { return goTo(currentIndex + 1); },
    previous() { return goTo(currentIndex - 1); },
    setHintActive(value) {
      if (destroyed || hintActive === Boolean(value)) return;
      hintActive = Boolean(value);
      refreshHint();
    },
    setLanguage(nextLanguage) {
      if (destroyed) return;
      locale = nextLanguage === 'ja' ? 'ja' : 'zh';
      renderLabels();
    },
    setEnabled(nextEnabled) {
      if (destroyed) return;
      enabled = Boolean(nextEnabled);
      if (!enabled) {
        hintHovered = hintFocused = false;
        serial += 1;
        busy = false;
        animations.forEach((animation) => animation.cancel());
        animations.clear();
        cancelPress();
        stopRail();
        railHovered = false;
        railPointerX = null;
        railMagnet = null;
        targetRail(currentIndex, true);
        resetBackInspection();
        pair.classList.remove('is-outfit-turning');
        stopSharedShadow();
      }
      renderLabels();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      hideHint();
      serial += 1;
      listeners.splice(0).forEach((dispose) => dispose());
      animations.forEach((animation) => animation.cancel());
      animations.clear();
      cancelPress();
      stopRail();
      stopSharedShadow();
      container.replaceChildren();
      container.classList.remove('outfit-showcase');
    },
  };
}
