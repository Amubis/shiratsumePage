import { cloverSVG } from './scene.js';
import { createOutfitRailFeedback } from './outfit-rail-feedback.js';

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

export const OUTFIT_COPY = Object.freeze({
  zh: Object.freeze({ choose: '选择服装', next: '点击切换下一套服装', front: '正面', back: '背面', inspect: '查看这套服装的背面', failure: '这套服装暂时加载失败，请再试一次。', empty: '还没有服装展示。' }),
  ja: Object.freeze({ choose: 'コーデを選ぶ', next: 'タップして次のコーデへ', front: '正面', back: '背面', inspect: 'このコーデの後ろ姿を見る', failure: '画像を読み込めませんでした。もう一度お試しください。', empty: 'コーデはまだ登録されていません。' }),
});
const SVG_NS = 'http://www.w3.org/2000/svg';
const IMAGE_WIDTH = 1440;
const IMAGE_HEIGHT = 2560;
let outfitSerial = 0;

function normalizedCopy(input = OUTFIT_COPY) {
  return Object.fromEntries(['zh', 'ja'].map(locale => [locale, Object.fromEntries(Object.entries(OUTFIT_COPY[locale]).map(([key, fallback]) => [key, typeof input?.[locale]?.[key] === 'string' ? input[locale][key] : fallback]))]));
}


function safeOutfitURL(value) {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (!url || /[\u0000-\u001f\u007f\\]/.test(url) || /^(?:\/\/|#|\?)/.test(url)) return null;
  try { return ['https:', 'http:'].includes(new URL(url, 'https://outfits.invalid/').protocol) ? url : null; }
  catch { return null; }
}
const imageSize = (value, fallback) => Array.isArray(value) && value.length === 2 && value.every(number => Number.isFinite(number) && number >= 1 && number <= 32768) ? value.map(Math.round) : [...fallback];
function normalizedBounds(bounds, [width, height]) {
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)) return [0, 0, width, height];
  const result = [Math.max(0, Math.min(width, bounds[0])), Math.max(0, Math.min(height, bounds[1])), Math.max(0, Math.min(width, bounds[2])), Math.max(0, Math.min(height, bounds[3]))];
  return result[2] > result[0] && result[3] > result[1] ? result : [0, 0, width, height];
}
/** Public outfit configuration; bounds stay in original-image pixels. */
export function normalizeOutfits(input = OUTFITS) {
  const items = Array.isArray(input) ? input : Array.isArray(input?.outfits) ? input.outfits : [];
  const ids = new Set();
  return items.flatMap((item, index) => {
    const front = safeOutfitURL(item?.front);
    const id = typeof item?.id === 'string' && item.id.trim() ? item.id.trim().slice(0, 160) : `outfit-${index + 1}`;
    if (!front || ids.has(id)) return [];
    ids.add(id);
    const size = imageSize([item.imageWidth, item.imageHeight], [IMAGE_WIDTH, IMAGE_HEIGHT]);
    const frontSize = imageSize(item.frontSize, size), backSize = imageSize(item.backSize, size);
    const label = typeof item.label === 'string' ? { zh: item.label, ja: item.label } : item.label || {};
    const zh = typeof label.zh === 'string' && label.zh.trim() ? label.zh.trim() : typeof label.ja === 'string' && label.ja.trim() ? label.ja.trim() : id;
    const ja = typeof label.ja === 'string' && label.ja.trim() ? label.ja.trim() : zh;
    const correction = item.backCalibration || {};
    const finite = (value, fallback, minimum, maximum) => Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
    return [{ id, label: { zh, ja }, front, back: safeOutfitURL(item.back), imageWidth: size[0], imageHeight: size[1], frontSize, backSize,
      frontBounds: normalizedBounds(item.frontBounds, frontSize), backBounds: normalizedBounds(item.backBounds, backSize),
      backCalibration: { scale: finite(correction.scale, 1, .2, 4), offsetX: finite(correction.offsetX, 0, -32768, 32768), offsetY: finite(correction.offsetY, 0, -32768, 32768) } }];
  });
}
function canvasFit(size) {
  const [width, height] = size;
  const scale = Math.min(IMAGE_WIDTH / width, IMAGE_HEIGHT / height);
  return { scale, x: (IMAGE_WIDTH - width * scale) / 2, y: (IMAGE_HEIGHT - height * scale) / 2 };
}
function rawCanvasBounds(outfit, side) {
  const size = imageSize(outfit[`${side}Size`], imageSize([outfit.imageWidth, outfit.imageHeight], [IMAGE_WIDTH, IMAGE_HEIGHT]));
  const fit = canvasFit(size), bounds = normalizedBounds(outfit[`${side}Bounds`], size);
  return [bounds[0] * fit.scale + fit.x, bounds[1] * fit.scale + fit.y, bounds[2] * fit.scale + fit.x, bounds[3] * fit.scale + fit.y];
}

/** A fixed visible height and baseline keep the stage and its scenery stationary. */
export function outfitFrontCanvasPose(outfit) {
  const bounds=rawCanvasBounds(outfit,'front');
  const scale=2350/Math.max(1,bounds[3]-bounds[1]);
  return {scale,x:720-(bounds[0]+bounds[2])*.5*scale,y:2500-bounds[3]*scale};
}
function canvasBounds(outfit,side){
  const bounds=rawCanvasBounds(outfit,side);
  if(side!=='front')return bounds;
  const pose=outfitFrontCanvasPose(outfit);
  return bounds.map((value,index)=>value*pose.scale+(index%2?pose.y:pose.x));
}

/** Normalize the visible figures, rather than assuming equal PNG canvases mean equal height.
 * Optional per-outfit backCalibration: { scale, offsetX, offsetY } uses source-image
 * pixels for offsets, leaving room to correct pose/perspective by eye later. */
export function outfitViewGeometry(outfit) {
  const front = canvasBounds(outfit, 'front');
  const back = canvasBounds(outfit, 'back');
  const correction = outfit.backCalibration || {};
  const previewScale = (front[3] - front[1]) / Math.max(1, back[3] - back[1]) * (correction.scale ?? 1);
  const restScale = previewScale * .93;
  const frontCenter = (front[0] + front[2]) / (2 * IMAGE_WIDTH);
  const backCenter = (back[0] + back[2]) / (2 * IMAGE_WIDTH);
  const fit = canvasFit(imageSize(outfit.backSize, imageSize([outfit.imageWidth, outfit.imageHeight], [IMAGE_WIDTH, IMAGE_HEIGHT])));
  const offsetX = (correction.offsetX ?? 0) * fit.scale / IMAGE_WIDTH;
  const offsetY = (correction.offsetY ?? 0) * fit.scale / IMAGE_HEIGHT;
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
  if (!Number.isInteger(count) || count < 0) throw new TypeError('An outfit count must be a non-negative integer.');
  if (!count) return { position: 0, width: 0, dots: [], cloverX: 0, cloverSize: 26 };
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
  if (!geometry?.dots?.length) return -1;
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

export const OUTFIT_HINT_TIMING = Object.freeze({ delay: 2200, duration: 2800, repeatDelay: 6000 });

/** One selected outfit with independently accessible front and rear views. */
function createOutfitShowcaseView({ container, language = 'zh', reducedMotion = () => false, onChange = () => {}, outfits = OUTFITS, initialIndex = 0, copy = OUTFIT_COPY, preloadEnabled = true, hintConsumed = false } = {}) {
  if (!container?.ownerDocument) throw new TypeError('An outfit showcase container is required.');
  const records = normalizeOutfits(outfits);
  let messages = normalizedCopy(copy);
  if (!records.length) return createEmptyOutfitShowcase({ container, language, copy: messages });
  const wrap = index => wrapOutfitIndex(index, records.length);
  const railGeometry = position => outfitRailGeometry(position, records.length);
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  const uid = `outfit-showcase-${++outfitSerial}`;
  const listeners = [];
  const preloads = new Map();
  const sourceLoads = new Map();
  const sourceImages = new Map();
  const animations = new Set();
  let locale = language === 'ja' ? 'ja' : 'zh';
  let currentIndex = Number.isInteger(initialIndex) ? wrap(initialIndex) : 0;
  let enabled = true;
  let busy = false;
  let warmEnabled = Boolean(preloadEnabled), warming = false;
  // A demonstration is not interaction: only a real activation retires it.
  let interacted = Boolean(hintConsumed);
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
  let railPosition = currentIndex;
  let railTarget = currentIndex;
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
  pair.style.setProperty('--hint-duration', `${OUTFIT_HINT_TIMING.duration}ms`);
  const stage = element('button', 'outfit-stage');
  stage.type = 'button';
  const art = element('span', 'outfit-art');
  // Both alpha silhouettes compose first; the pattern receives one opacity only.
  // This sibling of both portrait buttons can never paint over either picture.
  const shadow = svgElement('svg', { class: 'outfit-shadow outfit-shared-shadow', viewBox: `0 0 ${IMAGE_WIDTH} ${IMAGE_HEIGHT}`, 'aria-hidden': 'true', focusable: 'false', preserveAspectRatio: 'none' });
  const shadowDefs = svgElement('defs');
  const shadowMask = svgElement('mask', { id: `${uid}-mask`, maskUnits: 'userSpaceOnUse', x: '-320', y: '-320', width: IMAGE_WIDTH + 640, height: IMAGE_HEIGHT + 640, 'mask-type': 'alpha', style: 'mask-type:alpha', 'data-composite': 'alpha-union' });
  const shadowSources = [records[currentIndex].front, records[currentIndex].back].map((source, index) => svgElement('image', { class: index ? 'outfit-projection-back' : 'outfit-projection-front', x: '0', y: '0', width: IMAGE_WIDTH, height: IMAGE_HEIGHT, preserveAspectRatio: 'xMidYMid meet', ...(source ? { href: source } : {}) }));
  shadowMask.append(...shadowSources);
  const shadowPattern = svgElement('pattern', { id: `${uid}-dots`, width: '40', height: '40', patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(8)' });
  shadowPattern.append(svgElement('circle', { cx: '20', cy: '20', r: '14', fill: 'currentColor' }));
  shadowDefs.append(shadowMask, shadowPattern);
  const shadowGroup = svgElement('g', { mask: `url(#${uid}-mask)`, opacity: '.24' });
  const shadowPaint = svgElement('rect', { x: '-320', y: '-320', width: IMAGE_WIDTH + 640, height: IMAGE_HEIGHT + 640, fill: `url(#${uid}-dots)` });
  shadowGroup.append(shadowPaint);
  shadow.append(shadowDefs, shadowGroup);
  let image = element('img', 'outfit-image');
  image.width = IMAGE_WIDTH;
  image.height = IMAGE_HEIGHT;
  image.decoding = 'async';
  image.draggable = false;
  image.src = records[currentIndex].front;
  art.append(image);
  const cue = element('span', 'outfit-cue');
  cue.setAttribute('aria-hidden', 'true');
  cue.hidden = true;
  cue.style.setProperty('--hint-duration', `${OUTFIT_HINT_TIMING.duration}ms`);
  const cueArt = element('span', 'outfit-cue-art');
  cueArt.innerHTML = '<svg class="outfit-cue-icon" viewBox="0 0 24 24" fill="#fff" stroke="#34372d" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 12V5a2 2 0 0 1 4 0v6l1.8-1a2 2 0 0 1 1.7-.1l3.2 1.3A2.2 2.2 0 0 1 20 13.3V17a5 5 0 0 1-5 5h-2a5 5 0 0 1-4-2L4.6 14a1.7 1.7 0 0 1 2.6-2.2L8 13Z"/></svg>';
  cueArt.append(element('span', 'outfit-cue-ripple ripple-first'), element('span', 'outfit-cue-ripple ripple-second'));
  cue.append(cueArt);
  // The portrait button clips transparent image margins for hit testing. Keep
  // this visual-only cue outside that clip while matching the front canvas.
  const cueAnchor = element('span', 'outfit-cue-anchor');
  cueAnchor.setAttribute('aria-hidden', 'true');
  cueAnchor.append(cue);
  stage.append(art);
  const backStage = element('button', 'outfit-back-stage');
  backStage.type = 'button';
  const backArt = element('span', 'outfit-back-art');
  let backImage = element('img', 'outfit-back-image');
  backImage.width = IMAGE_WIDTH;
  backImage.height = IMAGE_HEIGHT;
  backImage.decoding = 'async';
  backImage.draggable = false;
  if (records[currentIndex].back) backImage.src = records[currentIndex].back;
  sourceImages.set(records[currentIndex].front, image);
  if (records[currentIndex].back && !sourceImages.has(records[currentIndex].back)) sourceImages.set(records[currentIndex].back, backImage);
  backArt.append(backImage);
  backStage.append(backArt);
  pair.append(shadow, stage, backStage, cueAnchor);
  const footer = element('div', 'outfit-footer');
  footer.style.width = '100%'; footer.style.maxWidth = '100%';
  footer.style.overflowX = 'auto'; footer.style.overflowY = 'hidden';
  const dots = element('div', 'outfit-dots');
  dots.setAttribute('role', 'group');
  const railClover = element('span', 'outfit-rail-clover');
  railClover.setAttribute('aria-hidden', 'true');
  const railCloverInk = element('span', 'outfit-rail-clover-feedback');
  railCloverInk.innerHTML = cloverSVG({ className: 'clover-svg', variant: 'small' });
  railClover.append(railCloverInk);
  const dotButtons = records.map((outfit, index) => {
    const button = element('button', 'outfit-dot');
    button.type = 'button';
    button.style.left = `${index * 44}px`;
    const circle = element('span', 'outfit-dot-circle');
    circle.setAttribute('aria-hidden', 'true');
    circle.append(element('span', 'outfit-dot-ink'));
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
      const targets = { ArrowLeft: wrap(index - 1), ArrowRight: wrap(index + 1), Home: 0, End: records.length - 1 };
      if (!Object.hasOwn(targets, event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      dotButtons[targets[event.key]].focus?.();
      void goTo(targets[event.key]);
    });
    return button;
  });
  dots.append(railClover);
  const railFeedback = createOutfitRailFeedback({
    root: dots, buttons: dotButtons, circles: dotButtons.map(button => button.children[0].children[0]), clover: railCloverInk,
    pickIndex: pickPointerDot, isEnabled: () => enabled && !destroyed && records.length > 1, reducedMotion,
  });
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
    const geometry = outfitViewGeometry(records[currentIndex]);
    [stage, backStage].forEach((node, index) => {
      const style = win?.getComputedStyle?.(node);
      let width = IMAGE_WIDTH, height = IMAGE_HEIGHT;
      let x = viewWidth / 2, y = 0;
      let tx = index ? geometry[inspecting ? 'previewX' : 'restX'] / 100 * IMAGE_WIDTH : (records[currentIndex].back ? inspecting ? -.7 : -.62 : -.5) * IMAGE_WIDTH;
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
      const normalization=index?{scale:1,x:0,y:0}:outfitFrontCanvasPose(records[currentIndex]);
      const baseX=finalScaleX*width/IMAGE_WIDTH,baseY=finalScaleY*height/IMAGE_HEIGHT;
      setShadowAttribute(shadowSources[index], 'transform', `matrix(${(baseX*normalization.scale).toFixed(6)} 0 0 ${(baseY*normalization.scale).toFixed(6)} ${(x+baseX*normalization.x).toFixed(5)} ${(y+baseY*normalization.y).toFixed(5)})`);
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
    const inspecting = enabled && Boolean(records[currentIndex].back) && !busy && (backHovered || backFocused);
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
    const copy = messages[locale];
    const outfit = records[currentIndex];
    const label = outfit.label[locale];
    const number = `${String(currentIndex + 1).padStart(2, '0')} / ${String(records.length).padStart(2, '0')}`;
    stage.setAttribute('aria-label', records.length > 1 ? `${label} · ${copy.next}` : `${label} · ${copy.front}`);
    stage.setAttribute('aria-busy', String(busy));
    stage.disabled = !enabled || records.length < 2;
    backStage.disabled = !enabled || !outfit.back;
    backStage.hidden = !outfit.back;
    shadowSources[1].style.display = outfit.back ? '' : 'none';
    stage.style.translate = outfit.back ? '' : '-50% 0';
    cueAnchor.style.translate = stage.style.translate;
    dots.hidden = records.length < 2;
    backStage.setAttribute('aria-label', records.length > 1 ? `${label} · ${copy.back} · ${copy.next}` : `${label} · ${copy.inspect}`);
    backStage.setAttribute('aria-busy', String(busy));
    image.alt = `しらつめ · ${label} · ${copy.front}`;
    backImage.alt = `しらつめ · ${label} · ${copy.back}`;
    const frontPose=outfitFrontCanvasPose(outfit);
    image.style.transformOrigin='0 0';
    image.style.transform=`translate(${frontPose.x/IMAGE_WIDTH*100}%,${frontPose.y/IMAGE_HEIGHT*100}%) scale(${frontPose.scale})`;
    updateHitBounds(stage, canvasBounds(outfit, 'front'));
    updateHitBounds(backStage, canvasBounds(outfit, 'back'));
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
      button.setAttribute('aria-label', `${records[index].label[locale]} (${index + 1} / ${records.length})`);
      button.setAttribute('aria-pressed', String(index === currentIndex));
      button.classList.toggle('is-selected', index === currentIndex);
      button.disabled = !enabled || records.length < 2;
    });
    if (announce) status.textContent = `${label} · ${number}`;
    trackSharedShadow();
  }

  function paintRail() {
    const geometry = railGeometry(railPosition);
    dots.style.width = `${geometry.width}px`;
    geometry.dots.forEach((dot) => {
      const circle = dotButtons[dot.index].children[0];
      circle.style.left = `${dot.x - dot.index * 44}px`;
      circle.style.width = `${dot.size}px`;
      circle.style.height = `${dot.size}px`;
      circle.style.opacity = String((.72 + .25 * dot.influence) * Math.min(1, Math.abs(dot.index - geometry.position) / .24));
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
    const previous = railGeometry(from);
    const next = railGeometry(to);
    return (next.cloverX - previous.cloverX) / (next.cloverSize / 2) * 180 / Math.PI;
  }

  function targetRail(target, immediate = false) {
    if (destroyed) return;
    railTarget = Math.max(0, Math.min(records.length - 1, target));
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
      if (railHovered && (railPosition < 0 || railPosition > records.length - 1)) {
        railPosition = Math.max(0, Math.min(records.length - 1, railPosition));
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
    return (clientX - bounds.left) * (records.length * 44 / (bounds.width || records.length * 44));
  }

  function pickPointerDot(clientX) {
    return nearestOutfitDot(localRailX(clientX), railGeometry(railPosition));
  }

  function followRailPointer(event) {
    if (!enabled || event.pointerType === 'touch' || !Number.isFinite(event.clientX)) return;
    railHovered = true;
    if (railPosition < 0 || railPosition > records.length - 1) {
      const edge = Math.max(0, Math.min(records.length - 1, railPosition));
      railRotation += rollBetween(railPosition, edge);
      railPosition = edge;
      railVelocity = 0;
      paintRail();
    }
    railPointerX = localRailX(event.clientX);
    const geometry = railGeometry(railPosition);
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
    targetRail(railMagnet ?? railPositionAtX(railPointerX, records.length));
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
    cue.classList.remove('is-hint-visible', 'is-hint-static');
    pair.classList.remove('is-hint-demonstrating');
    cue.hidden = true;
  }

  function canWaitForHint() {
    return !destroyed && enabled && records.length > 1 && hintActive && !doc.hidden && !interacted && !(hintShown && reducedMotion() && cue.hidden) && !busy && !pressed && !hintHovered && !hintFocused;
  }

  function refreshHint() {
    if (!canWaitForHint()) { hideHint(); return; }
    if (hintTimer !== null || hintEndTimer !== null || !cue.hidden) return;
    const generation = hintSerial;
    hintTimer = win.setTimeout(() => {
      if (generation !== hintSerial) return;
      hintTimer = null;
      if (!canWaitForHint()) return;
      hintShown = true;
      cue.hidden = false;
      cue.classList.add('is-hint-visible');
      cue.classList.toggle('is-hint-static', Boolean(reducedMotion()));
      pair.classList.toggle('is-hint-demonstrating', !reducedMotion());
      hintEndTimer = win.setTimeout(() => {
        if (generation !== hintSerial) return;
        hideHint();
        // Queue the next quiet interval only while this chapter is eligible.
        refreshHint();
      }, OUTFIT_HINT_TIMING.duration);
    }, hintShown ? OUTFIT_HINT_TIMING.repeatDelay : OUTFIT_HINT_TIMING.delay);
  }

  async function decodeImage(loaded) {
    if (loaded.decode) await loaded.decode();
    else if (!loaded.complete) await new Promise((resolve, reject) => { loaded.onload = resolve; loaded.onerror = reject; });
    if (typeof loaded.naturalWidth === 'number' && !loaded.naturalWidth) throw new Error('Outfit image unavailable.');
    return loaded;
  }

  function decodedSource(source, priority) {
    if (!source) return Promise.resolve(null);
    let loaded = sourceImages.get(source);
    if (loaded && priority === 'high') loaded.fetchPriority = priority;
    if (sourceLoads.has(source)) return sourceLoads.get(source);
    if (!loaded) {
      loaded = doc.createElement('img');
      loaded.decoding = 'async'; loaded.fetchPriority = priority; loaded.src = source;
      sourceImages.set(source, loaded);
    }
    const loading = decodeImage(loaded).catch(error => {
      if (sourceLoads.get(source) === loading) { sourceLoads.delete(source); sourceImages.delete(source); }
      throw error;
    });
    sourceLoads.set(source, loading);
    return loading;
  }

  function preload(index, priority = 'low') {
    const outfit = records[wrap(index)];
    if (priority === 'high') for (const source of [outfit.front, outfit.back]) {
      const pending = sourceImages.get(source); if (pending) pending.fetchPriority = priority;
    }
    if (preloads.has(outfit.id)) return preloads.get(outfit.id);
    const loading = (async () => {
      try {
        const [front, rear] = await Promise.all([decodedSource(outfit.front, priority), decodedSource(outfit.back, priority)]);
        // One source can be configured for both sides, but one DOM node cannot
        // occupy both portrait buttons. Its resource still comes from the cache.
        let back = rear;
        if (back === front) {
          back = doc.createElement('img'); back.decoding = 'async'; back.src = outfit.back;
          await decodeImage(back);
        }
        return [front, back];
      } catch {
        preloads.delete(outfit.id);
        return null;
      }
    })();
    preloads.set(outfit.id, loading);
    return loading;
  }

  function warmAll() {
    if (warming || !warmEnabled || destroyed) return;
    warming = true;
    const order = Array.from({ length: records.length }, (_, offset) => wrap(currentIndex + offset));
    let cursor = 0;
    const worker = async () => {
      while (!destroyed && warmEnabled && cursor < order.length) {
        const index = order[cursor++];
        await preload(index, index === currentIndex ? 'high' : 'low');
      }
    };
    // At most two background pairs compete for bandwidth; a user-selected
    // destination can join immediately instead of waiting behind this queue.
    void Promise.all([worker(), worker()]).finally(() => { warming = false; });
  }

  function mountDecodedPair(loaded) {
    image = loaded[0]; backImage = loaded[1] || element('img', 'outfit-back-image');
    for (const [node, className] of [[image, 'outfit-image'], [backImage, 'outfit-back-image']]) {
      node.className = className; node.width = IMAGE_WIDTH; node.height = IMAGE_HEIGHT;
      node.decoding = 'sync'; node.draggable = false;
      node.style.transform = ''; node.style.transformOrigin = '';
    }
    // Insert the already-decoded image itself. Assigning its URL to a separate
    // async image can leave that element painting its previous source mid-flip.
    art.replaceChildren(image); backArt.replaceChildren(backImage);
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
    const destination = wrap(index);
    if (interaction) markInteracted();
    if (destination === currentIndex) { if (pressReleased) cancelPress(); return true; }
    const request = ++serial;
    const direction = wrap(destination - currentIndex) <= records.length / 2 ? 1 : -1;
    if (animate && !reducedMotion() && !pressed && !pressReleased) {
      holdPress(); pressed = false; pressReleased = true;
    }
    busy = true;
    pair.classList.add('is-outfit-loading');
    resetBackInspection();
    stage.setAttribute('aria-busy', 'true');
    backStage.setAttribute('aria-busy', 'true');
    const loaded = await preload(destination, 'high');
    if (destroyed || !enabled || request !== serial) return false;
    if (!loaded) {
      busy = false;
      pair.classList.remove('is-outfit-loading');
      cancelPress();
      stage.setAttribute('aria-busy', 'false');
      backStage.setAttribute('aria-busy', 'false');
      status.textContent = messages[locale].failure;
      return false;
    }
    pair.classList.remove('is-outfit-loading');
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
    mountDecodedPair(loaded);
    shadowSources[0].setAttribute('href', records[currentIndex].front);
    if (records[currentIndex].back) shadowSources[1].setAttribute('href', records[currentIndex].back); else shadowSources[1].removeAttribute('href');
    renderLabels(true);
    if (!railHovered) targetRail(currentIndex);
    onChange(currentIndex, records[currentIndex]);
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
    warmAll();
    return true;
  }

  function holdPress(target = stage) {
    if (destroyed || !enabled || busy || records.length < 2) return false;
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
      markInteracted();
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
        if (!event.repeat && holdPress(target)) { markInteracted(); keyboardHeld = true; }
        return;
      }
      const targets = { ArrowLeft: currentIndex - 1, ArrowRight: currentIndex + 1, Home: 0, End: records.length - 1 };
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
  warmAll();

  return {
    get index() { return currentIndex; },
    get outfitId() { return records[currentIndex].id; },
    get hintConsumed() { return interacted || (hintShown && reducedMotion()); },
    goTo,
    next() { return goTo(currentIndex + 1); },
    previous() { return goTo(currentIndex - 1); },
    setPreloadEnabled(value) { warmEnabled = Boolean(value); if (warmEnabled) warmAll(); },
    setHintActive(value) {
      if (destroyed || hintActive === Boolean(value)) return;
      hintActive = Boolean(value);
      refreshHint();
    },
    setCopy(next) { if (!destroyed) { messages = normalizedCopy(next); renderLabels(); } },
    setLanguage(nextLanguage) {
      if (destroyed) return;
      locale = nextLanguage === 'ja' ? 'ja' : 'zh';
      renderLabels();
    },
    setEnabled(nextEnabled) {
      if (destroyed) return;
      enabled = Boolean(nextEnabled);
      if (!enabled) {
        railFeedback.cancel();
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
        pair.classList.remove('is-outfit-turning', 'is-outfit-loading');
        stopSharedShadow();
      }
      renderLabels();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      railFeedback.destroy();
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


function createEmptyOutfitShowcase({ container, language, copy }) {
  let messages = normalizedCopy(copy);
  const message = container.ownerDocument.createElement('p');
  message.className = 'outfit-empty'; message.setAttribute('role', 'status'); message.setAttribute('data-language-text', '');
  message.style.minHeight = 'min(60svh, 560px)'; message.style.display = 'grid'; message.style.placeItems = 'center';
  let locale = language === 'ja' ? 'ja' : 'zh';
  let destroyed = false;
  const render = () => { message.textContent = messages[locale].empty; };
  container.classList.add('outfit-showcase'); container.replaceChildren(message); render();
  return {
    get index() { return -1; }, get outfitId() { return null; },
    async goTo() { return false; }, async next() { return false; }, async previous() { return false; },
    setHintActive() {}, setEnabled() {}, setPreloadEnabled() {},
    setCopy(next) { if (!destroyed) { messages = normalizedCopy(next); render(); } },
    setLanguage(next) { if (!destroyed) { locale = next === 'ja' ? 'ja' : 'zh'; render(); } },
    destroy() { if (destroyed) return; destroyed = true; container.replaceChildren(); container.classList.remove('outfit-showcase'); },
  };
}

/** Replacing a configuration invalidates old image work while retaining selection and controls. */
export function createOutfitShowcase(options = {}) {
  let records = normalizeOutfits(Object.hasOwn(options, 'outfits') ? options.outfits : OUTFITS);
  let messages = normalizedCopy(options.copy);
  let locale = options.language === 'ja' ? 'ja' : 'zh';
  let enabled = true, hintActive = false, hintConsumed = false, destroyed = false;
  let preloadEnabled = options.preloadEnabled !== false;
  let view = createOutfitShowcaseView({ ...options, outfits: records, language: locale, copy: messages });
  return {
    get index() { return view.index; }, get outfitId() { return view.outfitId; },
    goTo(...args) { return view.goTo(...args); }, next() { return view.next(); }, previous() { return view.previous(); },
    setOutfits(input) {
      if (destroyed) return false;
      const next = normalizeOutfits(input);
      if (JSON.stringify(records) === JSON.stringify(next)) return false;
      const selectedId = view.outfitId, previousIndex = view.index;
      const selected = next.findIndex(item => item.id === selectedId);
      const initialIndex = selected >= 0 ? selected : Math.max(0, Math.min(previousIndex, next.length - 1));
      hintConsumed ||= view.hintConsumed === true;
      view.destroy(); records = next;
      view = createOutfitShowcaseView({ ...options, outfits: records, initialIndex, language: locale, copy: messages, preloadEnabled, hintConsumed });
      view.setEnabled(enabled); view.setHintActive(hintActive);
      return true;
    },
    setCopy(next) { if (destroyed) return; messages = normalizedCopy(next); view.setCopy(messages); },
    setLanguage(next) { if (destroyed) return; locale = next === 'ja' ? 'ja' : 'zh'; view.setLanguage(locale); },
    setEnabled(value) { if (destroyed) return; enabled = Boolean(value); view.setEnabled(enabled); },
    setPreloadEnabled(value) { if (destroyed) return; preloadEnabled = Boolean(value); view.setPreloadEnabled(preloadEnabled); },
    setHintActive(value) { if (destroyed) return; hintActive = Boolean(value); view.setHintActive(hintActive); },
    destroy() { if (destroyed) return; destroyed = true; view.destroy(); },
  };
}
