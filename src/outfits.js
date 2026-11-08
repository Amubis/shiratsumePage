import { cloverSVG } from './scene.js';

/** Add an outfit here when its images are ready. No back view is invented. */
export const OUTFITS = Object.freeze([
  Object.freeze({ id: 'sailor', label: Object.freeze({ zh: '深色水手服', ja: 'ダークカラーのセーラー服' }), front: './assets/outfits/outfit-01-front.png', back: null }),
  Object.freeze({ id: 'maid', label: Object.freeze({ zh: '黑白女仆装', ja: 'モノトーンのメイド服' }), front: './assets/outfits/outfit-02-front.png', back: null }),
  Object.freeze({ id: 'lace', label: Object.freeze({ zh: '黑色蕾丝装', ja: '黒いレースのコーデ' }), front: './assets/outfits/outfit-03-front.png', back: null }),
  Object.freeze({ id: 'gingham', label: Object.freeze({ zh: '蓝白格套装', ja: 'ブルーのギンガムコーデ' }), front: './assets/outfits/outfit-04-front.png', back: null }),
]);

/** The introduction and outfit list can share this configuration with a future CMS. */
export const MODEL_PROFILE = Object.freeze({
  name: 'しらつめ',
  zh: Object.freeze({ eyebrow: 'MEET SHIRATSUME.', heading: 'しらつめ', lead: '换一身喜欢的衣服，\n出发收集今天的小小幸运。', description: '轻轻晃动的发梢、软软的猫耳，还有一蹦一跳的日常。\n在不同的衣装之间，遇见同一个可爱的她。' }),
  ja: Object.freeze({ eyebrow: 'MEET SHIRATSUME.', heading: 'しらつめ', lead: 'お気に入りの服に着替えたら、\n今日の小さな幸運を探しに。', description: '揺れる髪も、ふわふわの猫耳も、弾むような毎日も。\nいろいろな装いの中で、いつものかわいい彼女に出会って。' }),
});

const OUTFIT_COPY = Object.freeze({
  zh: Object.freeze({ choose: '选择服装', next: '点击切换下一套服装', hint: '轻点，换一套', front: '正面', failure: '这套服装暂时加载失败，请再试一次。' }),
  ja: Object.freeze({ choose: 'コーデを選ぶ', next: 'タップして次のコーデへ', hint: 'タップで着替え', front: '正面', failure: '画像を読み込めませんでした。もう一度お試しください。' }),
});
const SVG_NS = 'http://www.w3.org/2000/svg';
let outfitSerial = 0;

export function wrapOutfitIndex(index, length = OUTFITS.length) {
  if (!Number.isInteger(length) || length < 1) throw new TypeError('An outfit list must contain at least one item.');
  if (!Number.isInteger(index)) throw new TypeError('An outfit index must be an integer.');
  return ((index % length) + length) % length;
}

/** A single-view carousel. Supply a real back image in OUTFITS before adding another view. */
export function createOutfitShowcase({ container, language = 'zh', reducedMotion = () => false, onChange = () => {} } = {}) {
  if (!container?.ownerDocument) throw new TypeError('An outfit showcase container is required.');
  const doc = container.ownerDocument;
  const uid = `outfit-showcase-${++outfitSerial}`;
  const listeners = [];
  const preloads = new Map();
  const animations = new Set();
  let locale = language === 'ja' ? 'ja' : 'zh';
  let currentIndex = 0;
  let enabled = true;
  let busy = false;
  let interacted = false;
  let destroyed = false;
  let serial = 0;
  let pressAnimation;

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
  const stage = element('button', 'outfit-stage');
  stage.type = 'button';
  const art = element('span', 'outfit-art');
  const shadow = svgElement('svg', { class: 'outfit-shadow', viewBox: '0 0 941 1672', 'aria-hidden': 'true', focusable: 'false', preserveAspectRatio: 'xMidYMid meet' });
  const defs = svgElement('defs');
  const mask = svgElement('mask', { id: `${uid}-mask`, maskUnits: 'userSpaceOnUse', x: '0', y: '0', width: '941', height: '1672', 'mask-type': 'alpha', style: 'mask-type:alpha' });
  const shadowSource = svgElement('image', { x: '0', y: '0', width: '941', height: '1672', preserveAspectRatio: 'xMidYMid meet', href: OUTFITS[0].front });
  mask.append(shadowSource);
  const pattern = svgElement('pattern', { id: `${uid}-dots`, width: '16', height: '16', patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(8)' });
  pattern.append(svgElement('circle', { cx: '8', cy: '8', r: '6.6', fill: 'currentColor' }));
  defs.append(mask, pattern);
  const shadowGroup = svgElement('g', { mask: `url(#${uid}-mask)`, opacity: '.36' });
  shadowGroup.append(svgElement('rect', { width: '941', height: '1672', fill: `url(#${uid}-dots)` }));
  shadow.append(defs, shadowGroup);
  const image = element('img', 'outfit-image');
  image.width = 941;
  image.height = 1672;
  image.decoding = 'async';
  image.draggable = false;
  image.src = OUTFITS[0].front;
  art.append(shadow, image);
  const cue = element('span', 'outfit-cue');
  cue.setAttribute('aria-hidden', 'true');
  const cueArt = element('span', 'outfit-cue-art');
  cueArt.innerHTML = `${cloverSVG({ className: 'clover-svg', variant: 'small' })}<svg class="outfit-cue-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18.7 7.5A7.8 7.8 0 1 0 19.5 15M19.4 3.8v4.5h-4.5"/></svg>`;
  const cueLabel = element('span', 'outfit-cue-label');
  cue.append(cueArt, cueLabel);
  stage.append(art, cue);
  const footer = element('div', 'outfit-footer');
  const caption = element('p', 'outfit-caption');
  const count = element('span', 'outfit-count');
  const name = element('span', 'outfit-name');
  caption.append(count, name);
  const dots = element('div', 'outfit-dots');
  dots.setAttribute('role', 'group');
  const dotButtons = OUTFITS.map((outfit, index) => {
    const button = element('button', 'outfit-dot');
    button.type = 'button';
    const circle = element('span', 'outfit-dot-circle');
    circle.setAttribute('aria-hidden', 'true');
    button.append(circle);
    dots.append(button);
    bind(button, 'click', () => { void goTo(index); });
    return button;
  });
  const status = element('p', 'outfit-status sr-only');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  footer.append(caption, dots);
  container.replaceChildren(stage, footer, status);

  function renderLabels(announce = false) {
    const copy = OUTFIT_COPY[locale];
    const outfit = OUTFITS[currentIndex];
    const label = outfit.label[locale];
    const number = `${String(currentIndex + 1).padStart(2, '0')} / ${String(OUTFITS.length).padStart(2, '0')}`;
    stage.setAttribute('aria-label', `${label} · ${copy.next}`);
    stage.setAttribute('aria-busy', String(busy));
    stage.disabled = !enabled;
    image.alt = `しらつめ · ${label} · ${copy.front}`;
    count.textContent = number;
    name.textContent = label;
    cueLabel.textContent = copy.hint;
    cue.hidden = interacted;
    dots.setAttribute('aria-label', copy.choose);
    dotButtons.forEach((button, index) => {
      button.setAttribute('aria-label', `${OUTFITS[index].label[locale]} (${index + 1} / ${OUTFITS.length})`);
      button.setAttribute('aria-pressed', String(index === currentIndex));
      button.classList.toggle('is-selected', index === currentIndex);
      button.disabled = !enabled;
    });
    if (announce) status.textContent = `${label} · ${number}`;
  }

  function markInteracted() {
    interacted = true;
    cue.hidden = true;
  }

  function preload(index) {
    const outfit = OUTFITS[wrapOutfitIndex(index)];
    if (preloads.has(outfit.id)) return preloads.get(outfit.id);
    const loading = (async () => {
      const loaded = doc.createElement('img');
      loaded.decoding = 'async';
      loaded.fetchPriority = 'low';
      loaded.src = outfit.front;
      try {
        if (loaded.decode) await loaded.decode();
        else if (!loaded.complete) await new Promise((resolve, reject) => {
          loaded.onload = resolve;
          loaded.onerror = reject;
        });
        return loaded;
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
    const animation = art.animate(frames, { duration, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' });
    animations.add(animation);
    try { await animation.finished; } catch { /* The component can be hidden or destroyed mid-turn. */ }
    animations.delete(animation);
    animation.cancel();
  }

  async function goTo(index, { animate = true, interaction = true } = {}) {
    if (destroyed || !enabled || busy || !Number.isInteger(index)) return false;
    const destination = wrapOutfitIndex(index);
    if (interaction) markInteracted();
    if (destination === currentIndex) return true;
    const request = ++serial;
    const direction = wrapOutfitIndex(destination - currentIndex) <= OUTFITS.length / 2 ? 1 : -1;
    busy = true;
    stage.setAttribute('aria-busy', 'true');
    const loaded = await preload(destination);
    if (destroyed || !enabled || request !== serial) return false;
    if (!loaded) {
      busy = false;
      stage.setAttribute('aria-busy', 'false');
      status.textContent = OUTFIT_COPY[locale].failure;
      return false;
    }
    if (animate && !reducedMotion()) await animateArt([
      { transform: 'translateX(0) rotateY(0deg)', opacity: 1 },
      { transform: `translateX(${-direction * 22}px) rotateY(${-direction * 66}deg)`, opacity: 0 },
    ], 190);
    if (destroyed || !enabled || request !== serial) return false;
    currentIndex = destination;
    image.src = OUTFITS[currentIndex].front;
    shadowSource.setAttribute('href', OUTFITS[currentIndex].front);
    renderLabels(true);
    onChange(currentIndex, OUTFITS[currentIndex]);
    if (animate && !reducedMotion()) await animateArt([
      { transform: `translateX(${direction * 22}px) rotateY(${direction * 66}deg)`, opacity: 0 },
      { transform: 'translateX(-2px) rotateY(-2deg)', opacity: 1, offset: .82 },
      { transform: 'translateX(0) rotateY(0deg)', opacity: 1 },
    ], 320);
    if (destroyed || !enabled || request !== serial) return false;
    busy = false;
    stage.setAttribute('aria-busy', 'false');
    void preload(currentIndex + 1);
    return true;
  }

  function bounce() {
    if (destroyed || !enabled || busy || reducedMotion() || !stage.animate) return;
    pressAnimation?.cancel();
    pressAnimation = stage.animate([
      { transform: 'translateY(3px) scale(.99)' },
      { transform: 'translateY(-4px) scale(1.004)', offset: .55 },
      { transform: 'translateY(0) scale(1)' },
    ], { duration: 360, easing: 'cubic-bezier(.22,.7,.3,1)' });
    pressAnimation.finished?.catch(() => {});
  }

  bind(stage, 'click', () => { bounce(); void goTo(currentIndex + 1); });
  bind(stage, 'keydown', (event) => {
    const targets = { ArrowLeft: currentIndex - 1, ArrowRight: currentIndex + 1, Home: 0, End: OUTFITS.length - 1 };
    if (!Object.hasOwn(targets, event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    void goTo(targets[event.key]);
  });
  renderLabels();
  void preload(0).then(() => { if (!destroyed) void preload(1); });

  return {
    get index() { return currentIndex; },
    goTo,
    next() { return goTo(currentIndex + 1); },
    previous() { return goTo(currentIndex - 1); },
    setLanguage(nextLanguage) {
      if (destroyed) return;
      locale = nextLanguage === 'ja' ? 'ja' : 'zh';
      renderLabels();
    },
    setEnabled(nextEnabled) {
      if (destroyed) return;
      enabled = Boolean(nextEnabled);
      if (!enabled) {
        serial += 1;
        busy = false;
        animations.forEach((animation) => animation.cancel());
        animations.clear();
        pressAnimation?.cancel();
      }
      renderLabels();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      serial += 1;
      listeners.splice(0).forEach((dispose) => dispose());
      animations.forEach((animation) => animation.cancel());
      animations.clear();
      pressAnimation?.cancel();
      container.replaceChildren();
      container.classList.remove('outfit-showcase');
    },
  };
}
