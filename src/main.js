import { CLOVER_PATH, cloverSVG, createCloverScene, createHalftoneSVG } from './scene.js';
import { createVideoPlayer } from './media.js';
import { createSectionNavigator } from './navigation.js';
import { MODELS, COPY, SECTION_IDS, getSelection, escapeXML } from './content.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const root = document.documentElement;
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const reducedMotion = () => motionPreference.matches;
let { model: modelId, language } = getSelection(location.search);
const requestedSection = SECTION_IDS.indexOf(location.hash.slice(1));
let currentIndex = 0;
let userPaused = reducedMotion();
let watching = false;
let hoverIndex = null;
let bubbleTimer;
let introTimers = [];
let introWaiting = false;
let introFallbackTimer;
let mediaStatus = 'poster';
let mediaDetails = {};
let modelGeneration = 0;
let wipeAnimation;
let wipeFade;
let wipeSerial = 0;
let spinAnimation;
const imageSources = new Map($$('[data-model-image]').map((image) => [image, { src: image.getAttribute('src'), alt: image.getAttribute('alt') }]));
const lightboxSources = new Map($$('[data-lightbox]').map((button) => [button, button.dataset.lightbox]));

$$('[data-clover]').forEach((element) => { element.innerHTML = cloverSVG({ className: 'clover-svg' }); });
$('.halftone-vignette').innerHTML = createHalftoneSVG();
const scene = createCloverScene({ container: $('.hero-clovers'), theme: MODELS[modelId].theme, seed: modelId, reducedMotion });

function translate(key) { return COPY[language][key] ?? COPY.zh[key] ?? ''; }
function notify(text) { $('#announcement').textContent = text; }
function applyURL() {
  // The built preview also works from a local file; file origins may forbid
  // history API query changes. URL sharing is enabled on HTTP(S) hosting.
  if (location.protocol === 'file:') return;
  const url = new URL(location.href);
  url.searchParams.set('model', modelId);
  url.searchParams.set('lang', language);
  url.hash = SECTION_IDS[currentIndex];
  try { history.replaceState(null, '', url); } catch { /* restricted preview origin */ }
}

function renderTitle() {
  const model = MODELS[modelId];
  const name = typeof model.name === 'object' ? model.name[language] : model.name;
  $('#model-heading').textContent = name;
  const text = escapeXML(name);
  // The same geometrical group is used for visible clovers and the mask.
  // Both instances share the same CSS animation time, not video pixel samples.
  $('#contrast-title').innerHTML = `<svg class="contrast-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 220" focusable="false"><defs><path id="title-leaf" d="${CLOVER_PATH}"/><g id="title-shapes"><g transform="translate(163 12) scale(1.65)"><g class="title-shape"><use href="#title-leaf"/></g></g><g transform="translate(589 37) scale(1.6)"><g class="title-shape title-shape-alt"><use href="#title-leaf"/></g></g></g><mask id="title-contrast-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="900" height="220" style="mask-type:luminance"><rect width="900" height="220" fill="black"/><use href="#title-shapes" fill="white"/></mask></defs><use href="#title-shapes" fill="var(--theme)" opacity=".94"/><text class="title-base" x="450" y="165" text-anchor="middle" font-size="146" fill="var(--paper)">${text}</text><text class="title-clipped" x="450" y="165" text-anchor="middle" font-size="146" fill="var(--ink)" mask="url(#title-contrast-mask)">${text}</text></svg>`;
  document.title = `${name} · little clover garden`;
}

function applyLanguage() {
  root.lang = language === 'ja' ? 'ja' : 'zh-CN';
  const overrides = MODELS[modelId].preview ? {
    heroDescription: 'previewHero', helloHeading: 'previewHelloHeading', helloDescription: 'previewHelloDescription',
    momentsHeading: 'previewMomentsHeading', momentsNote: 'previewMomentsNote', collectionHeading: 'previewCollectionHeading',
    frameLabel: 'previewFrameLabel', sampleNotice: 'previewNotice',
  } : {};
  $$('[data-i18n]').forEach((element) => {
    const key = overrides[element.dataset.i18n] || element.dataset.i18n;
    element.innerHTML = translate(key);
  });
  $$('[data-i18n-alt]').forEach((element) => { element.alt = translate(MODELS[modelId].preview ? 'previewAlt' : element.dataset.i18nAlt); });
  $('#language-label').textContent = language === 'zh' ? '中文' : '日本語';
  $('.language-other').textContent = language === 'zh' ? 'JP' : '中';
  $('#language-toggle').setAttribute('aria-label', translate('switchLanguage'));
  $('#lightbox-close').setAttribute('aria-label', translate('close'));
  $('.scroll-cue').setAttribute('aria-label', translate('scrollExplore'));
  $('.side-nav').setAttribute('aria-label', translate('menu'));
  $('.topbar').setAttribute('aria-label', translate('menu'));
  $('.top-links').setAttribute('aria-label', translate('menu'));
  updatePlaybackLabel();
  renderTitle();
  updateSideNav();
}

function updatePlaybackLabel(status) {
  if (status) mediaStatus = status;
  $('#watch-label').textContent = translate(watching ? 'returnHome' : 'watch');
  const paused = mediaStatus !== 'playing';
  const label = translate(paused ? 'play' : 'pause');
  $('#pause-toggle').setAttribute('aria-label', label);
  $('#pause-toggle').title = label;
  $('#pause-toggle use').setAttribute('href', paused ? '#icon-play' : '#icon-pause');
  renderVideoNotice();
}

function renderVideoNotice() {
  const notice=$('#video-fallback');
  const visible=currentIndex===0 && !MODELS[modelId].preview && mediaStatus!=='playing';
  notice.hidden=!visible;
  if(!visible)return;
  const keys={loading:'videoLoading',blocked:'videoBlocked',timeout:'videoTimeout',error:'videoError',paused:'videoPaused'};
  const key=keys[mediaStatus] || (reducedMotion()?'videoReduced':'videoReady');
  $('#video-message').textContent=translate(key);
  notice.dataset.state=mediaStatus;
  if(mediaDetails.errorCode)notice.dataset.errorCode=String(mediaDetails.errorCode);else delete notice.dataset.errorCode;
  $('#video-retry').hidden=mediaStatus==='loading';
  $('#video-retry').textContent=translate('play');
  $('#video-open').href=MODELS[modelId].playlist[0] || MODELS[modelId].poster;
  $('#video-open').textContent=translate('openVideo');
}

const player = createVideoPlayer({
  container: $('.hero-media'), playlist: MODELS[modelId].playlist, poster: MODELS[modelId].poster, reducedMotion,
  onStatus(status,details={}) {
    mediaDetails=details;
    updatePlaybackLabel(status);
    if (status === 'playing' && introWaiting && currentIndex === 0) startIntro();
  },
});

function clearIntro() { introTimers.forEach(clearTimeout); introTimers = []; }
function finishIntro() { introWaiting=false;clearTimeout(introFallbackTimer);clearIntro();root.dataset.phase='ready'; }
function startIntro() {
  introWaiting=false;clearTimeout(introFallbackTimer);
  clearIntro();
  if (reducedMotion() || currentIndex > 0) { finishIntro(); return; }
  root.dataset.phase = 'video';
  [[1500,'veil'],[1950,'text'],[2700,'controls'],[3350,'ready']].forEach(([time, phase]) => {
    introTimers.push(setTimeout(() => { root.dataset.phase = phase; }, time));
  });
}

function setWatching(next) {
  finishIntro();
  watching = next;
  document.body.classList.toggle('watch-mode', next);
  $('#watch-toggle').setAttribute('aria-pressed', String(next));
  [$('.hero-copy'),$('.scroll-cue'),$('.model-control'),$('.language-control')].forEach((node) => { node.inert = next; });
  $('.topbar').inert = next || currentIndex !== 0;
  updatePlaybackLabel();
  if (next && !MODELS[modelId].preview) { userPaused = false; void player.resume(); }
}

function setModelMenu(open) {
  $('#model-menu').hidden = !open;
  $('#model-toggle').setAttribute('aria-expanded', String(open));
}

function wait(milliseconds, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(false); return; }
    let timer;
    const end = (result) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(result); };
    const abort = () => end(false);
    timer = setTimeout(() => end(true), milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function runExploreWipe(signal) {
  if (reducedMotion()) return;
  const serial=++wipeSerial;
  wipeFade?.cancel();
  const wipe = $('.transition-wipe');
  const shape = $('.wipe-flower');
  const button = $('#explore');
  const bounds = button.getBoundingClientRect();
  const point = explorePoint || { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  explorePoint = null;
  wipe.style.setProperty('--wipe-x', `${point.x}px`);
  wipe.style.setProperty('--wipe-y', `${point.y}px`);
  const flowerAnimations = $$('.explore-flower').map((flower) => {
    const rect = flower.getBoundingClientRect();
    return flower.animate([
      { transform: getComputedStyle(flower).transform, opacity: .9 },
      { transform: `translate(${point.x - rect.left - rect.width/2}px,${point.y - rect.top - rect.height/2}px) scale(0)`, opacity: 0 },
    ], { duration:180, easing:'cubic-bezier(.4,0,.2,1)', fill:'forwards' });
  });
  const clean = () => {
    if(serial===wipeSerial){wipeAnimation?.cancel();wipe.classList.remove('is-active');}
    flowerAnimations.forEach((animation) => animation.cancel());
  };
  signal?.addEventListener('abort', clean, { once:true });
  if (!await wait(180, signal)) { clean(); return; }
  wipe.classList.add('is-active');
  const farthest = Math.hypot(Math.max(point.x, innerWidth-point.x),Math.max(point.y,innerHeight-point.y));
  const scale = farthest / 5 + 3;
  wipeAnimation = shape.animate([
    { transform:'translate(-50%,-50%) scale(0) rotate(-20deg)' },
    { transform:`translate(-50%,-50%) scale(${scale}) rotate(0)` },
  ], { duration:520, easing:'cubic-bezier(.4,0,.2,1)', fill:'forwards' });
  await wait(520, signal);
  flowerAnimations.forEach((animation) => animation.cancel());
  signal?.removeEventListener('abort', clean);
  if (signal?.aborted) clean();
}

function finishWipe() {
  const wipe = $('.transition-wipe');
  if (!wipe.classList.contains('is-active')) return;
  if (reducedMotion()) { wipe.classList.remove('is-active'); wipeAnimation?.cancel(); return; }
  const serial=wipeSerial;
  wipeFade = wipe.animate([{opacity:1},{opacity:0}], {duration:380,easing:'ease-out'});
  wipeFade.finished.then(() => {if(serial===wipeSerial){wipe.classList.remove('is-active');wipeAnimation?.cancel();}}).catch(() => {});
}

function updateSideNav() {
  const selected = hoverIndex ?? currentIndex;
  const links = $$('.side-links>a');
  links.forEach((link, index) => {
    const distance = index-currentIndex;
    const magnitude = Math.abs(distance);
    let offset = 0;
    for (let step=0;step<magnitude;step++) offset += Math.max(29, (distance > 0 ? 48 : 42)-step*6);
    link.style.setProperty('--nav-y', `${Math.sign(distance)*offset}px`);
    link.style.setProperty('--nav-scale', String(Math.max(.64,1-Math.abs(index-selected)*.14)));
    link.classList.toggle('is-highlighted', index === selected);
    if (index === currentIndex) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
  });
  const highlighted = links[selected];
  if (highlighted) $('.side-highlight').style.setProperty('--highlight-y', highlighted.style.getPropertyValue('--nav-y'));
  $('#mobile-current').textContent = links[currentIndex]?.textContent.trim() || '';
}

function spinHighlight(entering) {
  if (reducedMotion()) return;
  const shape = $('.side-highlight-spin');
  const current = getComputedStyle(shape).transform;
  spinAnimation?.cancel();
  spinAnimation = shape.animate([
    { transform:current },
    { transform:`rotate(${entering ? -190 : 170}deg) scale(1.06)`, offset:.5 },
    { transform:`rotate(${entering ? -372 : 348}deg) scale(1)` },
  ], {duration:450,easing:'cubic-bezier(.4,0,.2,1)'});
}

function stopBubbles() {
  clearTimeout(bubbleTimer);
  bubbleTimer = null;
  $$('.nav-bubble').forEach((bubble) => bubble.remove());
}
function startBubbles(index) {
  stopBubbles();
  if (reducedMotion() || !matchMedia('(hover: hover)').matches) return;
  const spawn = () => {
    if (hoverIndex !== index || document.hidden) return;
    const layer = $('.nav-bubbles');
    const row = $$('.side-links>a')[index];
    if (layer.childElementCount < 2) {
      const bubble = document.createElement('span');
      bubble.className = 'nav-bubble';
      bubble.style.setProperty('--bubble-y', `${parseFloat(row.style.getPropertyValue('--nav-y'))+(Math.random()*8-4)}px`);
      bubble.innerHTML = cloverSVG({className:'clover-svg'});
      layer.append(bubble);
      bubble.addEventListener('animationend', () => bubble.remove(), {once:true});
    }
    bubbleTimer = setTimeout(spawn, 590);
  };
  bubbleTimer = setTimeout(spawn, 350);
}

let navigator;
navigator = createSectionNavigator({
  sections: $$('.page-section'), reducedMotion,
  onActive(index) {
    currentIndex = index;
    if(index!==0 && watching)setWatching(false);
    document.body.classList.toggle('on-home', index === 0);
    $$('.page-section').forEach((section,i) => section.classList.toggle('is-current',i === index));
    $$('.top-links>a').forEach((link,i) => { if(i===index)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current'); });
    $('.topbar').inert = index !== 0 || watching;
    $('.side-nav').inert = index === 0;
    $('.video-controls').inert = index !== 0;
    if (index !== 0) { finishIntro(); player.pause(); } else if (!userPaused) void player.resume();
    hoverIndex = null; stopBubbles(); updateSideNav(); applyURL();
  },
  onProgress(progress) { finishIntro(); root.style.setProperty('--resistance',reducedMotion() ? '0' : String(progress)); },
  async onBeforeNavigate(index,{source,signal}) {
    if(source!=='model' && $('.theme-curtain').classList.contains('is-visible')) {modelGeneration+=1;$('.theme-curtain').classList.remove('is-visible');}
    finishIntro(); setWatching(false); setModelMenu(false); $('.side-nav').classList.remove('is-open'); $('.mobile-menu-toggle').setAttribute('aria-expanded','false');
    if(source === 'explore') await runExploreWipe(signal);
  },
  onSettled(index,{source}) {
    finishWipe();
    if (!reducedMotion() && (source==='wheel' || source==='touch')) {
      const content = index === 0 ? $('.hero-copy') : $$('.section-inner')[index-1];
      content?.animate([{translate:'0 5px'},{translate:'0 -2px',offset:.6},{translate:'0 0'}],{duration:260,easing:'ease-out'});
    }
  },
});
let explorePoint = null;

$$('[data-go]').forEach((link) => link.addEventListener('click', (event) => {
  event.preventDefault();
  void navigator.goTo(Number(link.dataset.go), {source:'nav'}).catch(console.error);
}));
$('#explore').addEventListener('click', (event) => {
  explorePoint = event.detail ? {x:event.clientX,y:event.clientY} : null;
  void navigator.goTo(1,{source:'explore',animate:false}).catch(console.error);
});
$('.skip-link').addEventListener('click', (event) => {
  event.preventDefault();
  void navigator.goTo(1,{animate:false,source:'keyboard'}).then(() => { $('#hello-heading').tabIndex=-1; $('#hello-heading').focus({preventScroll:true}); });
});

$$('.side-links>a').forEach((link,index) => {
  const enter = () => { hoverIndex = index; updateSideNav(); spinHighlight(true); startBubbles(index); };
  link.addEventListener('pointerenter', (event) => { if(event.pointerType !== 'touch') enter(); });
  link.addEventListener('focus', enter);
});
const leaveSide = () => { hoverIndex=null;stopBubbles();updateSideNav();spinHighlight(false); };
$('.side-links').addEventListener('pointerleave', leaveSide);
$('.side-links').addEventListener('focusout', (event) => { if(!$('.side-links').contains(event.relatedTarget))leaveSide(); });
$('.mobile-menu-toggle').addEventListener('click', () => {
  const open = $('.side-nav').classList.toggle('is-open');
  $('.mobile-menu-toggle').setAttribute('aria-expanded',String(open));
});

$('#watch-toggle').addEventListener('click', () => setWatching(!watching));
$('#pause-toggle').addEventListener('click', () => {
  finishIntro();
  userPaused = !player.paused;
  if(userPaused) player.pause();else void player.resume();
  updatePlaybackLabel();
});
$('#video-retry').addEventListener('click', () => {
  finishIntro();userPaused=false;void player.resume();
});
$('#model-toggle').addEventListener('click', () => { finishIntro();setModelMenu($('#model-menu').hidden); });
document.addEventListener('click', (event) => {
  if(!$('.model-control').contains(event.target))setModelMenu(false);
  if(!$('.side-nav').contains(event.target)) { $('.side-nav').classList.remove('is-open');$('.mobile-menu-toggle').setAttribute('aria-expanded','false'); }
});

async function switchModel(nextId) {
  if (nextId === modelId || !Object.hasOwn(MODELS,nextId)) {setModelMenu(false);return;}
  const token = ++modelGeneration;
  finishIntro();setWatching(false);setModelMenu(false);stopBubbles();
  $('.theme-curtain').classList.add('is-visible');
  await wait(reducedMotion()?0:240);
  if(token !== modelGeneration)return;
  modelId = nextId;
  applyTheme();
  player.setPlaylist(MODELS[modelId].playlist,MODELS[modelId].poster);
  await navigator.goTo(0,{animate:false,source:'model'});
  if(token !== modelGeneration)return;
  if(!userPaused)void player.resume();
  await wait(100);
  if(token !== modelGeneration)return;
  $('.theme-curtain').classList.remove('is-visible');
  notify(MODELS[modelId].preview ? translate('previewNotice') : 'しらつめ');
}
$$('[data-model]').forEach((button) => button.addEventListener('click', () => { void switchModel(button.dataset.model); }));

function applyTheme() {
  const model=MODELS[modelId];
  root.style.setProperty('--theme',model.theme);root.style.setProperty('--theme-rgb',model.rgb);root.style.setProperty('--theme-dark',model.dark);root.style.setProperty('--paper',model.paper);
  $('meta[name="theme-color"]').content=model.theme;
  document.body.classList.toggle('theme-preview',model.preview);
  $('#theme-status').hidden=!model.preview;
  $('#pause-toggle').disabled=model.preview;
  $('#watch-toggle').disabled=model.preview;
  // Reserved art slot: a future model can provide its own PNG/SVG without
  // changing the button's hit area, text, menu behavior or transition logic.
  const switchArt=$('.model-switch-art');
  if(model.switchArt){
    const image=document.createElement('img');image.src=model.switchArt;image.alt='';switchArt.replaceChildren(image);
  }else switchArt.innerHTML=cloverSVG({className:'clover-svg'});
  imageSources.forEach((original,image) => {image.src=model.preview?model.poster:original.src;});
  lightboxSources.forEach((original,button) => {button.dataset.lightbox=model.preview?model.poster:original;});
  $$('[data-model]').forEach((button) => button.setAttribute('aria-pressed',String(button.dataset.model===modelId)));
  scene.setTheme(model.theme,modelId);
  applyLanguage();applyURL();
}

$('#language-toggle').addEventListener('click', () => {
  finishIntro();language=language==='zh'?'ja':'zh';applyLanguage();applyURL();navigator.refresh();
});
$$('[data-lightbox]').forEach((button) => button.addEventListener('click', () => {
  finishIntro();
  const image=$('#lightbox>img');image.src=button.dataset.lightbox;image.alt=button.querySelector('img').alt;
  $('#lightbox').showModal();
  document.body.classList.add('modal-open');
}));
$('#lightbox').addEventListener('close', () => document.body.classList.remove('modal-open'));
$('#lightbox-close').addEventListener('click', () => $('#lightbox').close());
$('#lightbox').addEventListener('click', (event) => {if(event.target===$('#lightbox'))$('#lightbox').close();});
document.addEventListener('keydown', (event) => {
  if(event.key==='Tab' && root.dataset.phase!=='ready')finishIntro();
  if(event.key==='Escape') {if(watching)setWatching(false);setModelMenu(false);finishWipe();$('.side-nav').classList.remove('is-open');$('.mobile-menu-toggle').setAttribute('aria-expanded','false');}
});
document.addEventListener('visibilitychange', () => {document.body.classList.toggle('is-background',document.hidden);if(document.hidden)stopBubbles();else if(hoverIndex!==null)startBubbles(hoverIndex);});
const onMotionPreferenceChange=() => {finishIntro();scene.setTheme(MODELS[modelId].theme,modelId);if(reducedMotion()){stopBubbles();player.pause();userPaused=true;}updatePlaybackLabel();};
if(typeof motionPreference.addEventListener==='function')motionPreference.addEventListener('change',onMotionPreferenceChange);
else motionPreference.addListener?.(onMotionPreferenceChange);
window.addEventListener('resize', () => {navigator.refresh();});
window.addEventListener('hashchange', () => {const index=SECTION_IDS.indexOf(location.hash.slice(1));if(index>=0)void navigator.goTo(index,{source:'history'});});

applyTheme();
if(requestedSection>0) {finishIntro();void navigator.goTo(requestedSection,{animate:false,source:'history'});} else {
  if(reducedMotion())finishIntro();
  else {
    root.dataset.phase='video';introWaiting=true;
    introFallbackTimer=setTimeout(()=>{if(introWaiting)startIntro();},2000);
  }
  void player.start();
}
window.addEventListener('load', () => navigator.refresh(), {once:true});
document.fonts?.ready.then(() => navigator.refresh());
