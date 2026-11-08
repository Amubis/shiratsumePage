import { cloverSVG, createCloverScene, createHalftoneSVG, createHalftoneSeamSVG, halftoneShadowSVG, HALFTONE_GEOMETRY } from './scene.js';
import { createSidebar } from './sidebar.js';
import { createContrastLayer } from './contrast.js';
import { coverScale, exploreGrowthFrames, EXPLORE_TIMING } from './motion.js';
import { createPageReveal } from './transition-preview.js';
import { createOwnerProfile } from './owner-profile.js';
import { createVideoReveal } from './video-reveal.js';
import { createVideoPlayer } from './media.js';
import { createSectionNavigator } from './navigation.js';
import { MODELS, COPY, SECTION_IDS, getSelection } from './content.js';
import { createOutfitShowcase, MODEL_PROFILE } from './outfits.js';
import { createHeroInteractions } from './hero-interactions.js';
import { createIntroEntrance } from './intro-entrance.js';
import { createAlbum, ALBUM_MEDIA } from './album.js';
import { createAlbumTransition } from './album-transition.js';

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
let sidebar;
let contrastLayer;
let ownerProfile;
let videoReveal;
let introTimers = [];
let introWaiting = false;
let introFallbackTimer;
let mediaStatus = 'poster';
let mediaDetails = {};
let modelGeneration = 0;
let wipeAnimation;
let wipeFade;
let wipeSerial = 0;
let pageReveal;
let outfitShowcase;
let heroInteractions;
let introEntrance;
let album;
let albumTransition;
let detachIntroSnapshot;
let introInWipe = false;
let pendingAlbumNavigation = null;
let pendingAlbumMedia;
const languageControl = $('.language-control');
const imageSources = new Map($$('[data-model-image]').map((image) => [image, { src: image.getAttribute('src'), alt: image.getAttribute('alt') }]));
const lightboxSources = new Map($$('[data-lightbox]').map((button) => [button, button.dataset.lightbox]));

$$('[data-clover]').forEach((element) => {
  element.innerHTML = element.dataset.cloverShadow
    ? halftoneShadowSVG({id:element.dataset.cloverShadow})
    : cloverSVG({className:'clover-svg',variant:element.dataset.cloverVariant || 'small'});
});
function renderHalftone(){
  $('.halftone-vignette').innerHTML=createHalftoneSVG({width:innerWidth,height:innerHeight,profile:MODELS[modelId].preview?'soft':'connected'});
  root.style.setProperty('--shade-rx',`${HALFTONE_GEOMETRY.innerWidth / HALFTONE_GEOMETRY.innerScale * 50}%`);
  root.style.setProperty('--shade-ry',`${HALFTONE_GEOMETRY.innerHeight / HALFTONE_GEOMETRY.innerScale * 50}%`);
  if (!MODELS[modelId].preview) $('.intro-halftone-seam').innerHTML=createHalftoneSeamSVG({width:innerWidth,height:innerHeight});
  introEntrance?.refresh();
}
renderHalftone();
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
  const model=MODELS[modelId];
  const name=typeof model.name==='object'?model.name[language]:model.name;
  $('#model-heading').textContent=name;
  document.title=`${name} · little clover garden`;
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
  ownerProfile?.setLanguage(language);
  outfitShowcase?.setLanguage(language);
  album?.setLanguage(language);
  const profile = MODEL_PROFILE[language];
  $('.model-intro-eyebrow').textContent = profile.eyebrow;
  $('#hello-heading').textContent = profile.heading;
  $('.model-intro-lead').textContent = profile.lead;
  $('.model-intro-description').textContent = profile.description;
  introEntrance?.refresh();
  prepareIntroOffscreen();
  sidebar?.refresh();
  contrastLayer?.refresh();
}

function updatePlaybackLabel(status) {
  if (status) mediaStatus = status;
  $('#watch-label').textContent = translate(watching ? 'returnHome' : 'watch');
  $('#watch-toggle').setAttribute('aria-label',$('#watch-label').textContent);
  $('#watch-toggle .round-icon use').setAttribute('href',watching?'#icon-return':'#icon-play');
  const paused = mediaStatus !== 'playing';
  const label = translate(paused ? 'play' : 'pause');
  $('#pause-toggle').setAttribute('aria-label', label);
  $('#pause-toggle use').setAttribute('href', paused ? '#icon-play' : '#icon-pause');
  renderVideoNotice();
  contrastLayer?.refresh();
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
    if (introWaiting && currentIndex === 0) {
      if (status === 'playing') startIntro();
      else if (['blocked','error','timeout'].includes(status)) finishIntro();
    }
  },
});

function clearIntro() { introTimers.forEach(clearTimeout); introTimers = []; }
function finishIntro() { const changed=root.dataset.phase!=='ready';introWaiting=false;clearTimeout(introFallbackTimer);clearIntro();root.dataset.phase='ready';root.classList.remove('is-booting');if(changed){contrastLayer?.refresh();heroInteractions?.refresh();} }
function startIntro() {
  introWaiting=false;clearTimeout(introFallbackTimer);
  clearIntro();
  if (reducedMotion() || currentIndex > 0) { finishIntro(); return; }
  root.dataset.phase = 'video';
  root.classList.remove('is-booting');
  [[1500,'veil'],[1950,'text'],[2700,'controls'],[3350,'ready']].forEach(([time, phase]) => {
    introTimers.push(setTimeout(() => { root.dataset.phase=phase;contrastLayer?.refresh();if(phase==='ready')heroInteractions?.refresh(); },time));
  });
}

function setWatching(next) {
  if(!next)videoReveal?.cancel();
  finishIntro();
  watching = next;
  document.body.classList.toggle('watch-mode', next);
  heroInteractions?.refresh();
  $('#watch-toggle').setAttribute('aria-pressed', String(next));
  [$('.hero-copy'),$('.scroll-cue'),$('.model-control'),$('.language-control')].forEach((node) => { node.inert = next; });
  $('.topbar').inert = next || currentIndex !== 0;
  updatePlaybackLabel();
  contrastLayer?.refresh();
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
  wipeAnimation?.cancel();
  detachIntroSnapshot?.(); detachIntroSnapshot = null;
  pageReveal?.destroy();
  introInWipe = !MODELS[modelId].preview;
  if (introInWipe) introEntrance?.prepare();
  const wipe = $('.transition-wipe');
  wipe.classList.remove('is-active');
  const shape = $('.wipe-flower');
  // Both paints share the same path and transform: the incoming page's color
  // cannot appear outside the expanding clover, even during a slow reveal.
  const outline=shape.querySelector('path');
  shape.querySelector('.wipe-next-background')?.remove();
  const nextBackground=outline.cloneNode(false);
  nextBackground.classList.add('wipe-next-background');
  nextBackground.setAttribute('fill',getComputedStyle($('#hello')).backgroundColor);
  nextBackground.style.opacity='0';
  outline.parentElement.append(nextBackground);
  const button = $('#explore');
  const bounds = button.getBoundingClientRect();
  const point = explorePoint || { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  explorePoint = null;
  wipe.style.setProperty('--wipe-x', `${point.x}px`);
  wipe.style.setProperty('--wipe-y', `${point.y}px`);
  const poses = $$('.explore-flower').map((flower) => {
    const rect = flower.getBoundingClientRect();
    return {flower,base:getComputedStyle(flower).transform,dx:point.x-rect.left-rect.width/2,dy:point.y-rect.top-rect.height/2};
  });
  const animations=[];
  let reveal;
  const clean = () => {
    if(serial===wipeSerial){wipeAnimation?.cancel();wipe.classList.remove('is-active');}
    detachIntroSnapshot?.(); detachIntroSnapshot = null;
    introInWipe = false;
    introEntrance?.finish();
    reveal?.destroy();
    animations.forEach((animation)=>animation.cancel());
  };
  signal?.addEventListener('abort', clean, { once:true });

  // Let the two leaves gather energy before the visibly slower contraction.
  for(const {flower,base} of poses)animations.push(flower.animate([
    {transform:base},
    {transform:`${base} scale(1.14)`,offset:.65},
    {transform:`${base} scale(1.08)`},
  ],{duration:EXPLORE_TIMING.bump,easing:'cubic-bezier(.3,0,.3,1)',fill:'forwards'}));
  if(!await wait(EXPLORE_TIMING.bump,signal)){clean();return;}
  animations.push(button.animate([{opacity:1},{opacity:0}],{duration:160,fill:'forwards'}));
  for(const {flower,base,dx,dy} of poses)animations.push(flower.animate([
    {transform:`${base} scale(1.08)`,opacity:1},
    {transform:`translate(${dx}px,${dy}px) ${base} scale(.018)`,opacity:1},
  ],{duration:EXPLORE_TIMING.collapse,easing:'cubic-bezier(.55,0,.65,1)',fill:'forwards'}));
  if(!await wait(EXPLORE_TIMING.collapse,signal)){clean();return;}

  // Keep the tiny meeting point on screen before a single clover grows out.
  wipe.classList.add('is-active');
  wipeAnimation=shape.animate([{transform:'translate(-50%,-50%) scale(.035)'}],{duration:1,fill:'forwards'});
  if(!await wait(EXPLORE_TIMING.hold,signal)){clean();return;}
  const scale=coverScale(point,{width:innerWidth,height:innerHeight});
  wipeAnimation.cancel();
  wipeAnimation=shape.animate(exploreGrowthFrames(scale),{duration:EXPLORE_TIMING.grow,easing:'linear',fill:'forwards'});
  reveal=createPageReveal({container:wipe,shape,section:$('#hello')});
  pageReveal=reveal;
  if (introInWipe) {
    detachIntroSnapshot = introEntrance?.attach(reveal.element.querySelector('.page-section'));
    void introEntrance?.enter();
  }
  reveal.start();
  animations.push(reveal.element.animate([
    {opacity:0,offset:0},{opacity:.8,offset:.5},{opacity:1,offset:.78},{opacity:1,offset:1},
  ],{duration:EXPLORE_TIMING.grow,easing:'cubic-bezier(.4,0,.2,1)',fill:'forwards'}));
  animations.push(nextBackground.animate([
    {opacity:0,offset:0},
    {opacity:.8,offset:.5},
    {opacity:1,offset:.78},
    {opacity:1,offset:1},
  ],{duration:EXPLORE_TIMING.grow,easing:'cubic-bezier(.4,0,.2,1)',fill:'forwards'}));
  await wait(EXPLORE_TIMING.grow,signal);
  if(!signal?.aborted){nextBackground.style.opacity='1';reveal.element.style.opacity='1';reveal.seal();}
  animations.forEach((animation)=>animation.cancel());
  signal?.removeEventListener('abort', clean);
  if (signal?.aborted) clean();
}

function finishWipe() {
  const wipe = $('.transition-wipe');
  if (!wipe.classList.contains('is-active')) return;
  const release = () => { detachIntroSnapshot?.();detachIntroSnapshot=null;introInWipe=false;pageReveal?.destroy(); };
  if (reducedMotion()) { wipe.classList.remove('is-active'); wipeAnimation?.cancel();release();return; }
  const serial=wipeSerial;
  wipeFade = wipe.animate([{opacity:1},{opacity:0}], {duration:EXPLORE_TIMING.reveal,easing:'cubic-bezier(.4,0,.2,1)'});
  wipeFade.finished.then(() => {if(serial===wipeSerial){wipe.classList.remove('is-active');wipeAnimation?.cancel();release();}}).catch(() => {});
}

function flushAlbumMedia() {
  if (!pendingAlbumMedia || !album || albumTransition?.busy || pendingAlbumNavigation) return;
  const media = pendingAlbumMedia; pendingAlbumMedia = null;
  album.setMedia(media);
}

function enterAlbum() {
  void albumTransition?.enter().then(flushAlbumMedia);
}

function prepareIntroOffscreen() {
  if (!introEntrance || currentIndex === 1 || introInWipe || MODELS[modelId].preview) return;
  const rect = $('#hello').getBoundingClientRect();
  if (rect.bottom <= 0 || rect.top >= innerHeight) introEntrance.prepare();
}


let navigator;
navigator = createSectionNavigator({
  sections: $$('.page-section'), reducedMotion,
  onActive(index,{source}) {
    const previousIndex = currentIndex;
    currentIndex = index;
    if (index !== 1 && previousIndex === 1) introEntrance?.finish();
    else if (index === 1 && previousIndex !== 1 && !introInWipe && !MODELS[modelId].preview) {
      introEntrance?.prepare(); void introEntrance?.enter();
    }
    // Native touch scrolling has no intercepted navigation preparation. It
    // starts the same paper choreography after the chapter becomes current.
    if (!MODELS[modelId].preview && !pendingAlbumNavigation) {
      if (index === 2 && previousIndex !== 2) enterAlbum();
      else if (previousIndex === 2 && index !== 2) albumTransition?.reset({prepare:true});
    }
    heroInteractions?.refresh();
    if(index!==0){videoReveal?.cancel();ownerProfile?.close();}
    if(index!==0 && watching)setWatching(false);
    document.body.classList.toggle('on-home', index === 0);
    document.body.classList.toggle('on-album', index === 2 && !MODELS[modelId].preview);
    (index === 0 ? $('.topbar') : $('.language-dock')).append(languageControl);
    $$('.page-section').forEach((section,i) => section.classList.toggle('is-current',i === index));
    $$('.top-links>a').forEach((link,i) => { if(i===index)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current'); });
    $('.topbar').inert = index !== 0 || watching;
    $('.side-nav').inert = index === 0;
    $('.video-controls').inert = index !== 0;
    if (index !== 0) { finishIntro(); player.pause(); } else if (!userPaused) void player.resume();
    sidebar?.setCurrent(index);contrastLayer?.refresh();applyURL();
  },
  onProgress(progress) {
    if(progress !== 0)finishIntro();
    root.style.setProperty('--resistance',reducedMotion() ? '0' : String(progress));
    if (currentIndex === 1 && !MODELS[modelId].preview) albumTransition?.setProgress(Math.max(0,progress) * .3);
  },
  async onBeforeNavigate(index,{source,from,signal}) {
    ownerProfile?.close();
    if(source!=='model' && $('.theme-curtain').classList.contains('is-visible')) {modelGeneration+=1;$('.theme-curtain').classList.remove('is-visible');}
    finishIntro(); setWatching(false); setModelMenu(false); $('.side-nav').classList.remove('is-open'); $('.mobile-menu-toggle').setAttribute('aria-expanded','false');
    pendingAlbumNavigation = null;
    if (!MODELS[modelId].preview && from !== index && (index === 2 || from === 2)) {
      const operation = {kind:index === 2 ? 'enter' : 'reveal',index};
      pendingAlbumNavigation = operation;
      signal.addEventListener('abort', () => {
        if (pendingAlbumNavigation === operation) pendingAlbumNavigation = null;
        albumTransition?.cancel();
      }, {once:true});
      introEntrance?.finish();
      const completed = index === 2
        ? await albumTransition.cover({signal,outgoing:$('#' + SECTION_IDS[from])})
        : await albumTransition.leave({signal});
      if (!completed || signal.aborted) {
        if (pendingAlbumNavigation === operation) pendingAlbumNavigation = null;
        // If a language or motion change settles the decorative controller,
        // finish the requested navigation immediately instead of resuming an
        // unrelated animated scroll beneath an absent cover.
        return {animate:false};
      }
      return {animate:false};
    }
    albumTransition?.reset({prepare:index !== 2});
    if (index === 1 && from !== index && source !== 'explore' && !MODELS[modelId].preview) introEntrance?.prepare();
    if(source === 'explore') await runExploreWipe(signal);
  },
  onSettled(index) {
    finishWipe();
    if (index !== 1 && !MODELS[modelId].preview) introEntrance?.prepare();
    const pending = pendingAlbumNavigation;
    pendingAlbumNavigation = null;
    if (pending?.index === index) {
      if (pending.kind === 'enter') enterAlbum();
      else void albumTransition?.reveal().then(flushAlbumMedia);
    } else flushAlbumMedia();
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
  void navigator.goTo(1,{animate:false,source:'keyboard'}).then(() => { const heading = $(MODELS[modelId].preview ? '#preview-hello-heading' : '#hello-heading'); heading.tabIndex=-1; heading.focus({preventScroll:true}); });
});

$('.mobile-menu-toggle').addEventListener('click', () => {
  const open = $('.side-nav').classList.toggle('is-open');
  $('.mobile-menu-toggle').setAttribute('aria-expanded',String(open));
});

$('#watch-toggle').addEventListener('click',()=>{
  if(watching)setWatching(false);
  else void videoReveal.enter();
});
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
  finishIntro();setWatching(false);setModelMenu(false);sidebar?.setCurrent(currentIndex);
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
  introEntrance?.finish();
  pendingAlbumNavigation = null;
  albumTransition?.cancel();
  root.style.setProperty('--theme',model.theme);root.style.setProperty('--theme-rgb',model.rgb);root.style.setProperty('--theme-dark',model.dark);root.style.setProperty('--paper',model.paper);
  $('meta[name="theme-color"]').content=model.theme;
  document.body.classList.toggle('theme-preview',model.preview);
  $('.primary-intro').hidden=model.preview;
  $('.preview-intro').hidden=!model.preview;
  $('#hello').setAttribute('aria-labelledby',model.preview?'preview-hello-heading':'hello-heading');
  outfitShowcase?.setEnabled(!model.preview);
  $('.primary-album').hidden=model.preview;
  $('.preview-album').hidden=!model.preview;
  $('#moments').setAttribute('aria-labelledby',model.preview?'moments-heading':'album-heading');
  album?.setModel(modelId);
  album?.setEnabled(!model.preview);
  albumTransition?.setEnabled(!model.preview);
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
  heroInteractions?.refresh();
  renderHalftone();
  $$('[data-clover-shadow]').forEach(element=>{
    element.innerHTML=halftoneShadowSVG({id:element.dataset.cloverShadow,profile:model.preview?'soft':'connected'});
  });
  applyLanguage();applyURL();
  if (!model.preview && currentIndex !== 1) introEntrance?.prepare();
}

$('#language-toggle').addEventListener('click', () => {
  finishIntro();introEntrance?.finish();language=language==='zh'?'ja':'zh';applyLanguage();applyURL();navigator.refresh();
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
// The navigator's window listener must abort its pending handoff before Escape
// resolves a decorative controller's promise in this later listener.
window.addEventListener('keydown', (event) => {
  if(event.key==='Tab' && root.dataset.phase!=='ready')finishIntro();
  if(event.key==='Escape') {videoReveal?.cancel();introEntrance?.finish();albumTransition?.cancel();if(watching)setWatching(false);setModelMenu(false);finishWipe();prepareIntroOffscreen();$('.side-nav').classList.remove('is-open');$('.mobile-menu-toggle').setAttribute('aria-expanded','false');}
});
document.addEventListener('visibilitychange', () => {document.body.classList.toggle('is-background',document.hidden);contrastLayer?.refresh();queueMicrotask(prepareIntroOffscreen);});
const onMotionPreferenceChange=() => {videoReveal?.cancel();introEntrance?.finish();albumTransition?.cancel();finishIntro();scene.setTheme(MODELS[modelId].theme,modelId);heroInteractions?.refresh();if(reducedMotion()){player.pause();userPaused=true;}sidebar?.refresh();updatePlaybackLabel();prepareIntroOffscreen();};
if(typeof motionPreference.addEventListener==='function')motionPreference.addEventListener('change',onMotionPreferenceChange);
else motionPreference.addListener?.(onMotionPreferenceChange);
window.addEventListener('resize',()=>{renderHalftone();sidebar?.refresh();navigator.refresh();queueMicrotask(prepareIntroOffscreen);});
window.addEventListener('scroll',()=>{
  if(root.dataset.phase!=='ready')finishIntro();
  if(introEntrance?.state==='complete')prepareIntroOffscreen();
},{passive:true});
window.addEventListener('hashchange', () => {const index=SECTION_IDS.indexOf(location.hash.slice(1));if(index>=0)void navigator.goTo(index,{source:'history'});});

sidebar=createSidebar({root:$('.side-nav'),links:$$('.side-links>a'),highlight:$('.side-highlight'),bubbles:$('.nav-bubbles'),reducedMotion});
contrastLayer=createContrastLayer({scene:$('.hero'),targets:$$('[data-contrast]'),reducedMotion,isActive:()=>currentIndex===0&&!watching&&root.dataset.phase!=='video'});
ownerProfile=createOwnerProfile({root:$('#owner-profile'),language});
outfitShowcase=createOutfitShowcase({container:$('#outfit-showcase'),language,reducedMotion});
introEntrance=createIntroEntrance({section:$('#hello'),reducedMotion,isEnabled:()=>!MODELS[modelId].preview});
album=createAlbum({container:$('#album-showcase'),language,modelId,media:ALBUM_MEDIA,reducedMotion,onReady(){
  $('.album-title').id='album-heading';
  if (albumTransition) albumTransition.reset({prepare:currentIndex !== 2});
}});
albumTransition=createAlbumTransition({section:$('#moments'),previous:$('#hello'),reducedMotion});
// The public manifest is the content boundary for a future authenticated CMS.
// Relative media URLs resolve against this page on project GitHub Pages too.
if (location.protocol !== 'file:') fetch('./data/album.json').then(response=>{
  if(!response.ok)throw new Error('Album manifest unavailable');
  return response.json();
}).then(manifest=>{
  if(manifest.schemaVersion!==1 || !Array.isArray(manifest.media))return;
  pendingAlbumMedia=manifest.media;flushAlbumMedia();
}).catch(()=>{/* The bundled four-still preview also works offline. */});
videoReveal=createVideoReveal({
  hero:$('.hero'),button:$('#watch-toggle'),reducedMotion,
  targets:[$('.hero-copy'),$('.topbar'),$('.model-control'),$('.hero-clovers'),$('.hero-wash'),$('.halftone-vignette'),$('.hero-edge-shade'),$('.scroll-cue'),$('.hero-coordinate'),$('.hero-treatment')],
  onStart(){finishIntro();ownerProfile.close();userPaused=false;void player.resume();},
  onComplete(){setWatching(true);},
});
heroInteractions=createHeroInteractions({
  hero:$('.hero'),exploreButton:$('#explore'),exploreWrap:$('.explore-wrap'),reducedMotion,
  isActive:()=>currentIndex===0 && !watching && !MODELS[modelId].preview && root.dataset.phase==='ready'
    && !document.body.classList.contains('watch-reveal-animating') && !$('.transition-wipe').classList.contains('is-active'),
});
applyTheme();
if(requestedSection>0) {finishIntro();void navigator.goTo(requestedSection,{animate:false,source:'history'});} else {
  if(reducedMotion() || !root.classList.contains('is-booting'))finishIntro();
  else if(MODELS[modelId].preview)startIntro();
  else {
    root.dataset.phase='video';introWaiting=true;
    introFallbackTimer=setTimeout(()=>{if(introWaiting)startIntro();},2000);
  }
  void player.start();
}
window.addEventListener('load', () => navigator.refresh(), {once:true});
document.fonts?.ready.then(()=>{navigator.refresh();sidebar?.refresh();contrastLayer?.refresh();});
