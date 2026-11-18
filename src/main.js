import { cloverSVG, createCloverScene, createHalftoneSVG, createHalftoneSeamSVG, halftoneShadowSVG, HALFTONE_GEOMETRY } from './scene.js';
import { createSidebar } from './sidebar.js';
import { createContrastLayer } from './contrast.js';
import { coverScale, exploreGrowthFrames, EXPLORE_TIMING } from './motion.js';
import { createPageReveal } from './transition-preview.js';
import { createOwnerProfile, readOwnerProfileData } from './owner-profile.js';
import { createVideoReveal } from './video-reveal.js';
import { createVideoPlayer } from './media.js';
import { createSectionNavigator } from './navigation.js';
import { MODELS, COPY, SECTION_IDS, getSelection } from './content.js';
import { createOutfitShowcase, normalizeOutfits, MODEL_PROFILE, OUTFITS, OUTFIT_COPY } from './outfits.js';
import { createHeroInteractions } from './hero-interactions.js';
import { createIntroEntrance } from './intro-entrance.js';
import { createAlbum, ALBUM_MEDIA, ALBUM_COPY } from './album.js';
import { createAlbumTransition } from './album-transition.js';
import { createAlbumScroll } from './album-scroll.js';
import { createPersonalPage, normalizePersonalProfile } from './personal-page.js';
import { createTopbarDock } from './topbar-dock.js';
import { createPersonalEntrance } from './personal-entrance.js';
import { OWNER_COPY } from './owner-profile.js';
import { PERSONAL_COPY } from './personal-page.js';
import { COMMENTS_COPY, createCommentService } from './comments.js';
import { normalizeGardenContent, resolveGardenMedia } from './garden-content.js';
import { FIXED_COPY, readGardenData, setGardenText, loadPublishedGarden, acceptGardenPreview } from './garden-runtime.js';
import { createWaterFooter } from './water-footer.js';
import { createModelSwitchMotion, modelSpacePose } from './model-switch-motion.js';
import { createLanguageTransition, languageTextTargets } from './language-transition.js';
import { createOwnerTools } from './owner-tools.js';
import { createContentAvailability } from './content-availability.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const root = document.documentElement;
const gardenDefaults = readGardenData(document, {
  schemaVersion:1, texts:{site:COPY,album:ALBUM_COPY,outfits:OUTFIT_COPY,owner:OWNER_COPY,personal:PERSONAL_COPY,comments:COMMENTS_COPY,fixed:FIXED_COPY},
  modelProfile:MODEL_PROFILE,owner:readOwnerProfileData(document),outfits:OUTFITS,media:ALBUM_MEDIA,journal:[],
});
let activeGarden = resolveGardenMedia(gardenDefaults);
for (const locale of ['zh','ja']) Object.assign(COPY[locale],activeGarden.texts.site[locale]);
const previewToken = new URLSearchParams(location.search).get('editor-preview');
let previewReceived = false;
let publicSceneStarted = false;
const commentsService = createCommentService({baseUrl:null});
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const reducedMotion = () => motionPreference.matches;
let { model: modelId, language } = getSelection(location.search);
let requestedLanguage = language;
const requestedSection = SECTION_IDS.indexOf(location.hash.slice(1));
let initialRoutePending = requestedSection > 0;
let currentIndex = 0;
let userPaused = reducedMotion();
let watching = false;
let sidebar;
let contrastLayer;
let ownerProfile;
let ownerTools;
let contentAvailability;
let personalPage;
let personalEntrance;
let topbarDock;
let waterFooter;
let videoReveal;
let introTimers = [];
let introWaiting = false;
let introFallbackTimer;
let mediaStatus = 'poster';
let mediaDetails = {};
let modelGeneration = 0;
let pendingModelChange=null;
let wipeAnimation;
let wipeFade;
let wipeSerial = 0;
let pageReveal;
let outfitShowcase;
let languageTransition;
let modelSwitchMotion;
let outfitGroundObserver;
let heroInteractions;
let introEntrance;
let album;
let albumTransition;
let albumScroll;
let detachIntroSnapshot;
let introInWipe = false;
let pendingAlbumNavigation = null;
let pendingAlbumMedia;
let pendingNativeEntry = null;
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
  if (initialRoutePending || location.protocol === 'file:') return;
  const url = new URL(location.href);
  url.searchParams.set('model', modelId);
  url.searchParams.set('lang', language);
  url.hash = SECTION_IDS[currentIndex];
  try { history.replaceState(null, '', url); } catch { /* restricted preview origin */ }
}

function renderTitle() {
  const model=MODELS[modelId];
  const configuredName=model.preview?model.name:activeGarden.modelProfile.name;
  const name=typeof configuredName==='object'?(configuredName[language] || configuredName.zh):configuredName;
  $('#model-heading').textContent=name;
  document.title=`${name} · Avatar Portfolio`;
}

function selectedOutfit(){
  const record=activeGarden.outfits.find(outfit=>outfit.id===outfitShowcase?.outfitId);
  return record ? normalizeOutfits([record])[0] || null : null;
}

function syncOutfitGround(outfit=selectedOutfit()){
  const container=$('#outfit-showcase');
  const pair=container.querySelector('.outfit-pair');
  const stage=container.querySelector('.outfit-stage');
  const visible=Boolean(outfit && pair && stage);
  container.classList.toggle('has-outfit-ground',visible);
  if(!visible || !container.offsetWidth || !pair.offsetHeight)return;
  container.style.setProperty('--outfit-ground-x','44%');
  container.style.setProperty('--outfit-ground-y',`${(pair.offsetTop+pair.offsetHeight*2500/2560).toFixed(3)}px`);
}

function ensureOutfitShowcase(){
  if(!outfitShowcase){
    outfitShowcase=createOutfitShowcase({container:$('#outfit-showcase'),language,reducedMotion,outfits:activeGarden.outfits,copy:activeGarden.texts.outfits,preloadEnabled:publicSceneStarted,onChange(_index,outfit){syncOutfitGround(outfit);}});
    syncOutfitGround();
    if(typeof ResizeObserver==='function'){
      outfitGroundObserver=new ResizeObserver(()=>syncOutfitGround());
      outfitGroundObserver.observe($('#outfit-showcase'));
    }
    introEntrance?.refresh();
  }
  return outfitShowcase;
}

function applyLanguage() {
  root.lang = language === 'ja' ? 'ja' : 'zh-CN';
  const overrides = MODELS[modelId].preview ? {
    heroDescription: 'previewHero', helloHeading: 'previewHelloHeading', helloDescription: 'previewHelloDescription',
    momentsHeading: 'previewMomentsHeading', momentsNote: 'previewMomentsNote', collectionHeading: 'previewCollectionHeading',
    frameLabel: 'previewFrameLabel', sampleNotice: 'previewNotice', navCollection: 'previewNavCollection',
  } : {};
  $$('[data-i18n]').forEach((element) => {
    const key = overrides[element.dataset.i18n] || element.dataset.i18n;
    setGardenText(element,translate(key));
  });
  $$('[data-i18n-alt]').forEach((element) => { element.alt = translate(MODELS[modelId].preview ? 'previewAlt' : element.dataset.i18nAlt); });
  $('#language-label').textContent = language === 'zh' ? '中文' : '日本語';
  $('.language-other').textContent = language === 'zh' ? 'JP' : '中';
  $('#language-toggle').setAttribute('aria-label', translate('switchLanguage'));
  const choiceName=MODELS[modelId].preview?MODELS.preview.name:activeGarden.modelProfile.name;
  const currentChoiceName=typeof choiceName==='object'?(choiceName[language]||choiceName.zh):choiceName;
  $('#model-toggle').setAttribute('aria-label',`${translate('switchModel')} · ${currentChoiceName}`);
  $('.model-toggle-label').textContent=translate('switchModel');
  $('#lightbox-close').setAttribute('aria-label', translate('close'));
  $('.scroll-cue').setAttribute('aria-label', translate('scrollExplore'));
  $('.side-nav').setAttribute('aria-label', translate('menu'));
  $('.topbar').setAttribute('aria-label', translate('menu'));
  $('.top-links').setAttribute('aria-label', translate('menu'));
  updatePlaybackLabel();
  renderTitle();
  ownerProfile?.setLanguage(language);
  personalPage?.setLanguage(language);
  applyFixedText();
  outfitShowcase?.setLanguage(language);
  album?.setLanguage(language);
  const profile = activeGarden.modelProfile[language];
  $('.model-intro-eyebrow').textContent = profile.eyebrow;
  $('#hello-heading').textContent = profile.heading;
  $('.model-intro-lead').textContent = profile.lead;
  $('.model-intro-description').textContent = profile.description;
  introEntrance?.refresh();
  prepareIntroOffscreen();
  sidebar?.refresh();
  contrastLayer?.refresh();
  ownerTools?.setLanguage(language);
  contentAvailability?.setLanguage();
}

function applyFixedText() {
  if (MODELS[modelId].preview) { $('.top-links a[data-go="3"] small').textContent='COLLECTION'; return; }
  const copy = activeGarden.texts.fixed[language];
  const targets = { homeEyebrow:'.hero-copy>.eyebrow', coordinatePages:'.hero-coordinate span', modelReading:'.model-intro-reading', modelFooter:'.primary-intro>.section-footer>span:first-child', modelPage:'.primary-intro>.section-footer>span:last-child' };
  for (const [key,selector] of Object.entries(targets)) if ($(selector)) $(selector).textContent=copy[key] ?? FIXED_COPY[language][key];
  const coordinate=$('.hero-coordinate');
  coordinate.firstChild.textContent=`${copy.coordinate ?? FIXED_COPY[language].coordinate} `;
  ['Home','Hello','Moments','Collection'].forEach((key,index)=>{$(`.top-links a[data-go="${index}"] small`).textContent=copy[`nav${key}Subtitle`] ?? FIXED_COPY[language][`nav${key}Subtitle`];});
  $('.hero-native')?.setAttribute('aria-label',copy.videoLabel ?? FIXED_COPY[language].videoLabel);
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

function markModelSwitch(selection=modelId,busy=false){
  $('#model-toggle').dataset.selection=selection==='preview'?'right':'left';
  $('#model-toggle').setAttribute('aria-busy',String(busy));
  document.body.classList.toggle('is-model-switching',busy);
  heroInteractions?.refresh();contrastLayer?.refresh();
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
    void introEntrance?.enter({delay:Math.round(EXPLORE_TIMING.grow*.4),durationScale:1.25});
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
  if (!pendingAlbumMedia || !album || albumTransition?.busy || (albumScroll?.busy && !albumScroll.isArriving) || pendingAlbumNavigation) return;
  const media = pendingAlbumMedia; pendingAlbumMedia = null;
  album.setMedia(media);
}

function enterAlbum() {
  return albumTransition?.enter().then(completed => { flushAlbumMedia(); return completed; });
}

function syncPersonalEntrance() {
  if (!publicSceneStarted) return;
  if (!personalEntrance) return;
  if (MODELS[modelId].preview) { personalEntrance.finish(); return; }
  if (currentIndex !== 3) { personalEntrance.prepare(); return; }
  if (pendingNativeEntry === 3) return;
  if (pendingAlbumNavigation || albumScroll?.busy || albumTransition?.busy || navigator?.transitioning) return;
  void personalEntrance.enter();
}

function prepareIntroOffscreen() {
  if (!introEntrance || currentIndex === 1 || introInWipe || albumScroll?.busy || MODELS[modelId].preview) return;
  const rect = $('#hello').getBoundingClientRect();
  if (rect.bottom <= 0 || rect.top >= innerHeight) introEntrance.prepare();
}


let navigator;
navigator = createSectionNavigator({
  sections: $$('.page-section'), reducedMotion,
  onActive(index,{source,atStart=true,programmatic=false}) {
    const previousIndex = currentIndex;
    currentIndex = index;
    const canEnter=publicSceneStarted&&!initialRoutePending;
    const nativeInterior=canEnter&&!atStart&&!programmatic&&!pendingAlbumNavigation&&!albumScroll?.busy;
    if(previousIndex!==index || atStart)pendingNativeEntry=null;
    if(nativeInterior&&!MODELS[modelId].preview){
      if($('#'+SECTION_IDS[index]).getBoundingClientRect().top>8)pendingNativeEntry=index;
      else{
        pendingNativeEntry=null;
        if(index===1)introEntrance?.finish();
        if(index===2){albumTransition?.reset({prepare:false});flushAlbumMedia();}
        if(index===3)personalEntrance?.finish();
      }
    }
    if (canEnter && index !== 1 && previousIndex === 1) introEntrance?.finish();
    else if (canEnter && atStart && index === 1 && previousIndex !== 1 && !introInWipe && !albumScroll?.busy && !MODELS[modelId].preview) {
      introEntrance?.prepare(); void introEntrance?.enter();
    }
    // Native touch scrolling has no intercepted navigation preparation. It
    // starts the same paper choreography after the chapter becomes current.
    if (canEnter && !MODELS[modelId].preview && !pendingAlbumNavigation && !albumScroll?.busy) {
      if (atStart && index === 2 && previousIndex !== 2) enterAlbum();
      else if (previousIndex === 2 && index !== 2) albumTransition?.reset({prepare:true});
    }
    heroInteractions?.refresh();
    if(index!==0){videoReveal?.cancel();ownerProfile?.close();}
    if(index!==0 && watching)setWatching(false);
    document.body.classList.toggle('on-home', index === 0);
    document.body.classList.toggle('on-album', index === 2 && !MODELS[modelId].preview);
    document.body.classList.toggle('on-personal', index === 3 && !MODELS[modelId].preview);
    (index === 0 ? $('.topbar') : $('.language-dock')).append(languageControl);
    topbarDock?.refresh();
    $$('.page-section').forEach((section,i) => section.classList.toggle('is-current',i === index));
    $$('.top-links>a').forEach((link,i) => { if(i===index)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current'); });
    $('.topbar').inert = index !== 0 || watching;
    $('.side-nav').inert = index === 0;
    $('.video-controls').inert = index !== 0;
    if (index !== 0) { if(publicSceneStarted)finishIntro(); player.pause(); } else if (publicSceneStarted&&!userPaused) void player.resume();
    sidebar?.setCurrent(index);contrastLayer?.refresh();applyURL();
    if(!nativeInterior || pendingNativeEntry!==index)syncPersonalEntrance();
  },
  onProgress(progress) {
    if(!publicSceneStarted)return;
    if(progress !== 0)finishIntro();
    root.style.setProperty('--resistance',reducedMotion() ? '0' : String(progress));
    if (currentIndex === 1 && !MODELS[modelId].preview && !albumScroll?.busy) albumTransition?.setProgress(Math.max(0,progress) * .3);
  },
  onChapterWheel(details,{allowStart=true}={}) {
    if(!publicSceneStarted)return false;
    if (MODELS[modelId].preview) return false;
    if(!allowStart && !albumScroll?.busy)return false;
    const wasBusy = albumScroll?.busy;
    const handled=albumScroll?.wheel(details) || false;
    if(handled){finishIntro();if(!wasBusy && albumScroll?.busy)introEntrance?.finish();}
    return handled;
  },
  onInterrupt() {
    if(albumScroll?.busy){albumScroll.cancel();flushAlbumMedia();}
    syncPersonalEntrance();
  },
  async onBeforeNavigate(index,{source,from,signal}) {
    if(!publicSceneStarted)return {animate:false};
    languageTransition?.finish();
    pendingNativeEntry=null;
    if(source==='album-scroll')return {animate:false};
    if(source==='model'){pendingAlbumNavigation=null;albumTransition?.reset({prepare:true});return {animate:false};}
    if(albumScroll?.busy)albumScroll.cancel();
    if(index===3 && currentIndex!==3 && !MODELS[modelId].preview)personalEntrance?.prepare();
    ownerProfile?.close();
    if(source!=='model' && $('.theme-curtain').classList.contains('is-visible')) {modelGeneration+=1;pendingModelChange=null;$('.theme-curtain').classList.remove('is-visible');markModelSwitch();modelSwitchMotion?.setSelection(modelId==='preview'?'right':'left',{animate:false});}
    finishIntro(); setWatching(false);  $('.side-nav').classList.remove('is-open'); $('.mobile-menu-toggle').setAttribute('aria-expanded','false');
    pendingAlbumNavigation = null;
    if (!MODELS[modelId].preview && from !== index && (index === 2 || from === 2)) {
      const operation = {kind:index === 2 ? 'enter' : 'reveal',index,direction:Math.sign(index-from)};
      pendingAlbumNavigation = operation;
      signal.addEventListener('abort', () => {
        if (pendingAlbumNavigation === operation) pendingAlbumNavigation = null;
        albumTransition?.cancel();
      }, {once:true});
      introEntrance?.finish();
      const completed = index === 2
        ? await albumTransition.cover({signal,outgoing:$('#' + SECTION_IDS[from]),direction:operation.direction})
        : await albumTransition.leave({signal,retainHidden:true});
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
  onSettled(index,{source}) {
    if(!publicSceneStarted || (initialRoutePending&&source==='history'))return;
    if(source==='album-scroll')return;
    finishWipe();
    if (index !== 1 && !MODELS[modelId].preview) introEntrance?.prepare();
    else if(index===1&&!MODELS[modelId].preview&&!introInWipe&&['idle','prepared'].includes(introEntrance?.state))void introEntrance.enter();
    const pending = pendingAlbumNavigation;
    pendingAlbumNavigation = null;
    if (pending?.index === index) {
      if (pending.kind === 'enter') enterAlbum();
      else void albumTransition?.reveal({direction:pending.direction}).then(() => {flushAlbumMedia();syncPersonalEntrance();});
    } else {flushAlbumMedia();syncPersonalEntrance();}
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
document.addEventListener('click', (event) => {
  if(!$('.side-nav').contains(event.target)) { $('.side-nav').classList.remove('is-open');$('.mobile-menu-toggle').setAttribute('aria-expanded','false'); }
});

function paintModelChange({progress}){
  const change=pendingModelChange;
  if(!change)return;
  const curtain=$('.theme-curtain');
  const space=modelSpacePose(progress);
  const position=space.stage==='enter'?change.startPosition*(-space.position):change.direction*105*space.position;
  if(curtain.dataset.modelSpaceStage!==space.stage)curtain.dataset.modelSpaceStage=space.stage;
  curtain.style.setProperty('--model-loader-alpha',String(change.startedCovered && space.stage==='enter'?1:space.loaderAlpha));
  curtain.style.transform=`translateX(${position}%) skewX(-11deg)`;
  if(!change.committed && space.covered){
    change.committed=true;modelId=change.nextId;
    applyTheme();
    player.setPlaylist(MODELS[modelId].playlist,MODELS[modelId].poster);
    void navigator.goTo(0,{animate:false,source:'model'});
    if(!userPaused)void player.resume();
  }
  if(progress===1){
    pendingModelChange=null;curtain.classList.remove('is-visible');markModelSwitch();
    notify(MODELS[modelId].preview?translate('previewNotice'):'しらつめ');
  }
}
function switchModel(nextId){
  languageTransition?.finish();
  if(!Object.hasOwn(MODELS,nextId))return;
  if(nextId===pendingModelChange?.nextId || (!pendingModelChange && nextId===modelId))return;
  const token=++modelGeneration;
  finishIntro();setWatching(false);sidebar?.setCurrent(currentIndex);
  const selection=nextId==='preview'?'right':'left';
  const curtain=$('.theme-curtain'),direction=selection==='right'?1:-1;
  const visible=curtain.classList.contains('is-visible');
  const previousPosition=Number(curtain.style.transform.match(/translateX\(([-.\d]+)%\)/)?.[1]);
  const startPosition=visible&&Number.isFinite(previousPosition)?previousPosition:direction*-105;
  pendingModelChange={token,nextId,committed:false,direction,startPosition,startedCovered:visible&&Math.abs(startPosition)<5};
  curtain.style.backgroundColor=MODELS[nextId].theme;
  root.style.setProperty('--model-space-fill',MODELS[nextId].theme);
  curtain.style.setProperty('--model-loading-ink',MODELS[nextId].dark);
  curtain.style.transform=`translateX(${startPosition}%) skewX(-11deg)`;
  notify(language==='ja'?'モデルを切り替えています…':'正在切换模型…');
  curtain.classList.add('is-visible');markModelSwitch(nextId,true);
  const changed=modelSwitchMotion?.setSelection(selection);
  if(!changed)paintModelChange({progress:1,travel:1});
}
$('#model-toggle').addEventListener('click',()=>switchModel($('#model-toggle').dataset.selection==='right'?'shiratsume':'preview'));

function applyTheme() {
  const model=MODELS[modelId];
  introEntrance?.finish();
  albumScroll?.cancel();
  pendingAlbumNavigation = null;
  albumTransition?.cancel();
  root.style.setProperty('--theme',model.theme);root.style.setProperty('--theme-rgb',model.rgb);root.style.setProperty('--theme-dark',model.dark);root.style.setProperty('--paper',model.paper);
  $('meta[name="theme-color"]').content=model.theme;
  document.body.classList.toggle('theme-preview',model.preview);
  $('.primary-intro').hidden=model.preview;
  $('.preview-intro').hidden=!model.preview;
  $('#hello').setAttribute('aria-labelledby',model.preview?'preview-hello-heading':'hello-heading');
  if(!model.preview)ensureOutfitShowcase();
  outfitShowcase?.setEnabled(!model.preview);
  $('.primary-album').hidden=model.preview;
  $('.preview-album').hidden=!model.preview;
  $('#moments').setAttribute('aria-labelledby',model.preview?'moments-heading':'album-heading');
  $('.primary-personal').hidden=model.preview;
  $('.preview-collection').hidden=!model.preview;
  $('#collection').setAttribute('aria-labelledby',model.preview?'collection-heading':'personal-heading');
  album?.setModel(modelId);
  album?.setEnabled(!model.preview);
  albumTransition?.setEnabled(!model.preview);
  personalEntrance?.setEnabled(!model.preview);
  personalEntrance?.setTheme(model.theme,modelId);
  $('#theme-status').hidden=!model.preview;
  $('#pause-toggle').disabled=model.preview;
  $('#watch-toggle').disabled=model.preview;
  $('#model-toggle').dataset.selection=modelId==='preview'?'right':'left';
  imageSources.forEach((original,image) => {image.src=model.preview?model.poster:original.src;});
  lightboxSources.forEach((original,button) => {button.dataset.lightbox=model.preview?model.poster:original;});
  $('#model-toggle').setAttribute('aria-checked',String(model.preview));
  scene.setTheme(model.theme,modelId);
  heroInteractions?.refresh();
  renderHalftone();
  $$('[data-clover-shadow]').forEach(element=>{
    element.innerHTML=halftoneShadowSVG({id:element.dataset.cloverShadow,profile:model.preview?'soft':'connected'});
  });
  applyLanguage();applyURL();
  if (!model.preview && currentIndex !== 1) introEntrance?.prepare();
  syncPersonalEntrance();
}

$('#language-toggle').addEventListener('click', () => {
  finishIntro();introEntrance?.finish();if(albumScroll?.busy)albumScroll.cancel();
  requestedLanguage=(languageTransition?.busy?requestedLanguage:language)==='zh'?'ja':'zh';
  const nextLanguage=requestedLanguage;
  const commit=()=>{language=nextLanguage;applyLanguage();applyURL();navigator.refresh();syncPersonalEntrance();};
  if(languageTransition)void languageTransition.run(commit);else commit();
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
  if(event.key==='Escape') {videoReveal?.cancel();introEntrance?.finish();albumTransition?.cancel();if(watching)setWatching(false);finishWipe();prepareIntroOffscreen();$('.side-nav').classList.remove('is-open');$('.mobile-menu-toggle').setAttribute('aria-expanded','false');}
});
document.addEventListener('visibilitychange', () => {document.body.classList.toggle('is-background',document.hidden);if(document.hidden&&albumScroll?.busy)albumScroll.cancel();contrastLayer?.refresh();personalEntrance?.refresh();if(!document.hidden)syncPersonalEntrance();queueMicrotask(prepareIntroOffscreen);});
const onMotionPreferenceChange=() => {videoReveal?.cancel();introEntrance?.finish();albumScroll?.cancel();albumTransition?.cancel();finishIntro();scene.setTheme(MODELS[modelId].theme,modelId);heroInteractions?.refresh();personalEntrance?.refresh();waterFooter?.refresh();modelSwitchMotion?.refresh();languageTransition?.finish();if(reducedMotion()){player.pause();userPaused=true;}sidebar?.refresh();updatePlaybackLabel();prepareIntroOffscreen();syncPersonalEntrance();};
if(typeof motionPreference.addEventListener==='function')motionPreference.addEventListener('change',onMotionPreferenceChange);
else motionPreference.addListener?.(onMotionPreferenceChange);
window.addEventListener('resize',()=>{renderHalftone();sidebar?.refresh();navigator.refresh();queueMicrotask(prepareIntroOffscreen);});
function startDeferredNativeEntry(){
  const index=pendingNativeEntry;
  if(index===null || index!==currentIndex || navigator?.transitioning || albumScroll?.busy)return;
  const rect=$('#'+SECTION_IDS[index]).getBoundingClientRect();
  if(rect.top>8)return;
  pendingNativeEntry=null;
  if(rect.bottom<=0 || MODELS[modelId].preview)return;
  if(index===1){introEntrance?.prepare();void introEntrance?.enter();}
  else if(index===2)void enterAlbum();
  else if(index===3)syncPersonalEntrance();
}
window.addEventListener('scroll',()=>{
  if(!publicSceneStarted)return;
  if(pendingNativeEntry!==null)requestAnimationFrame(startDeferredNativeEntry);
  if(root.dataset.phase!=='ready')finishIntro();
  if(introEntrance?.state==='complete')prepareIntroOffscreen();
},{passive:true});
window.addEventListener('hashchange', () => {const index=SECTION_IDS.indexOf(location.hash.slice(1));if(index>=0)void navigator.goTo(index,{source:'history'});});

sidebar=createSidebar({root:$('.side-nav'),links:$$('.side-links>a'),highlight:$('.side-highlight'),bubbles:$('.nav-bubbles'),reducedMotion});
contrastLayer=createContrastLayer({scene:$('.hero'),targets:$$('[data-contrast]'),reducedMotion,isActive:()=>currentIndex===0&&!watching&&root.dataset.phase!=='video'&&!document.body.classList.contains('is-model-switching')});
const initialOwnerProfile=normalizePersonalProfile(activeGarden.owner);
ownerProfile=createOwnerProfile({root:$('#owner-profile'),profile:initialOwnerProfile,language,copy:activeGarden.texts.owner});
personalPage=createPersonalPage({root:$('#personal-page'),profile:initialOwnerProfile,language,copy:activeGarden.texts.personal,posts:activeGarden.journal,commentsService,commentsCopy:activeGarden.texts.comments});
function applyOwnerProfile(profile) {
  if(profile?.schemaVersion!==1)return;
  const data=normalizePersonalProfile(profile);
  ownerProfile.update(data);personalPage.update(data);
}
if(!MODELS[modelId].preview)ensureOutfitShowcase();
introEntrance=createIntroEntrance({section:$('#hello'),reducedMotion,isEnabled:()=>!MODELS[modelId].preview});
// The reminder starts only once the real chapter has completed its entrance;
// snapshots and chapters outside the viewport cannot start its idle timer.
const outfitHintSection=$('#hello');
const refreshOutfitHint=()=>outfitShowcase?.setHintActive?.(outfitHintSection.classList.contains('is-current')&&outfitHintSection.classList.contains('intro-float-ready'));
const outfitHintObserver=new MutationObserver(refreshOutfitHint);
outfitHintObserver.observe(outfitHintSection,{attributes:true,attributeFilter:['class']});
refreshOutfitHint();
album=createAlbum({container:$('#album-showcase'),language,modelId,media:activeGarden.media,copy:activeGarden.texts.album,commentsService,commentsCopy:activeGarden.texts.comments,reducedMotion,onReady({reason}){
  $('.album-title').id='album-heading';
  if (albumTransition && !['page','view','filter','order','language','copy','player-return','inline-edit'].includes(reason)) albumTransition.reset({prepare:currentIndex !== 2});
}});
albumTransition=createAlbumTransition({section:$('#moments'),previous:$('#hello'),reducedMotion});
albumScroll=createAlbumScroll({
  transition:{
    previewExit(amount,{direction}){root.style.setProperty('--resistance',String(reducedMotion()?0:direction*amount));},
    beforeExit(options,{signal}){
      root.style.setProperty('--resistance','0');
      return albumTransition.leave({signal,retainHidden:true});
    },
    seekBoundary(progress,options){
      if(progress===0 && options.to===2 && currentIndex!==2){
        albumTransition.cancel();
        // Reveal the dotted background first. Keep every paper/photo hidden
        // until the wheel wave finishes, then play its own entrance clock.
        albumTransition.prepare();
      }
      return albumTransition.seekBoundary(progress,{
        ...options,
        outgoing:$('#'+SECTION_IDS[options.from]),
        incoming:$('#'+SECTION_IDS[options.to]),
      });
    },
    holdCover(){return albumTransition.holdCover();},
    cancel(){root.style.setProperty('--resistance','0');albumTransition.cancel();if(currentIndex!==2)albumTransition.prepare();},
  },
  reducedMotion,
  navigate(index){return navigator.goTo(index,{source:'album-scroll',animate:false});},
  onHandoff({to}){if(to===1)introEntrance?.finish();},
  onComplete({to}){
    if(to===2)return enterAlbum();
    else {
      albumTransition.reset({prepare:true});
      if(to===1)introEntrance?.finish();
      else prepareIntroOffscreen();
      flushAlbumMedia();
      syncPersonalEntrance();
    }
  },
});
videoReveal=createVideoReveal({
  hero:$('.hero'),button:$('#watch-toggle'),reducedMotion,
  targets:[$('.hero-copy'),$('.topbar'),$('.model-control'),$('.hero-clovers'),$('.hero-wash'),$('.halftone-vignette'),$('.hero-edge-shade'),$('.scroll-cue'),$('.hero-coordinate'),$('.hero-treatment')],
  onStart(){finishIntro();ownerProfile.close();userPaused=false;void player.resume();},
  onComplete(){setWatching(true);},
});
heroInteractions=createHeroInteractions({
  hero:$('.hero'),exploreButton:$('#explore'),exploreWrap:$('.explore-wrap'),reducedMotion,
  isActive:()=>currentIndex===0 && !watching && !MODELS[modelId].preview && root.dataset.phase==='ready'
    && !document.body.classList.contains('is-model-switching') && !document.body.classList.contains('watch-reveal-animating') && !$('.transition-wipe').classList.contains('is-active'),
});
personalEntrance=createPersonalEntrance({section:$('#collection'),reducedMotion,isEnabled:()=>!MODELS[modelId].preview,theme:MODELS[modelId].theme,seed:modelId});
waterFooter=createWaterFooter({container:$('.personal-water-footer'),reducedMotion});
modelSwitchMotion=createModelSwitchMotion({root:$('#model-toggle'),reducedMotion,themes:{left:MODELS.shiratsume.theme,right:MODELS.preview.theme},onFrame:paintModelChange});
topbarDock=createTopbarDock({topbar:$('.topbar'),hero:$('.hero'),reducedMotion});
languageTransition=createLanguageTransition({root:document.body,reducedMotion:()=>reducedMotion()||Boolean(pendingModelChange),getTargets:()=>languageTextTargets(document.body)});
if(!previewToken)ownerTools=createOwnerTools({root:document.body,getContent:()=>activeGarden,getLanguage:()=>language,onPublished:content=>applyGardenContent(content,{inline:true}),onSession:session=>commentsService.setOwnerSession(session)});
function applyGardenContent(next,{inline=false}={}) {
  const previous=activeGarden;
  activeGarden=resolveGardenMedia(normalizeGardenContent(next,gardenDefaults));
  const changed=key=>JSON.stringify(previous[key])!==JSON.stringify(activeGarden[key]);
  const changedCopy=key=>JSON.stringify(previous.texts[key])!==JSON.stringify(activeGarden.texts[key]);
  if(changed('owner'))applyOwnerProfile(activeGarden.owner);
  if(changedCopy('owner'))ownerProfile.setCopy(activeGarden.texts.owner);
  if(changedCopy('personal'))personalPage.setCopy(activeGarden.texts.personal);
  if(changed('journal'))personalPage.setPosts(activeGarden.journal);
  if(changed('outfits') && outfitShowcase?.setOutfits(activeGarden.outfits)){syncOutfitGround();introEntrance.refresh();}
  if(changedCopy('outfits'))outfitShowcase?.setCopy(activeGarden.texts.outfits);
  if(changedCopy('album'))album.setCopy(activeGarden.texts.album);
  if(changed('media')){if(inline)album.setMedia(activeGarden.media,{preservePlayer:true});else{pendingAlbumMedia=activeGarden.media;flushAlbumMedia();}}
  if(changedCopy('comments')){album.setCommentsCopy(activeGarden.texts.comments);personalPage.setCommentsCopy(activeGarden.texts.comments);}
  if(changedCopy('site') || changedCopy('fixed') || changed('modelProfile')) {
    for(const locale of ['zh','ja'])Object.assign(COPY[locale],activeGarden.texts.site[locale]);
    applyLanguage();
  }
  navigator.refresh();personalEntrance?.refresh();
}
window.addEventListener('message',event=>{
  const content=acceptGardenPreview(event,{token:previewToken,origin:location.origin,parent:window.parent===window?null:window.parent,defaults:gardenDefaults});
  if(content){
    previewReceived=true;commentsService.setBaseUrl(null);
    const nextLanguage=event.data.language;
    const languageChanged=['zh','ja'].includes(nextLanguage)&&nextLanguage!==language;
    if(languageChanged){languageTransition?.cancel();language=nextLanguage;requestedLanguage=language;}
    applyGardenContent(content);
    if(languageChanged){applyLanguage();applyURL();}
  }
});
let publishedGardenRequest=null,publishedGardenConnected=false,lastPublishedAttempt=0;
contentAvailability=createContentAvailability({root:document.body,getLanguage:()=>language,onRetry:()=>void refreshPublishedGarden()});
function updateGardenRuntime(runtime){
  ownerProfile?.setAdminUrl(runtime.adminUrl);
  ownerTools?.setRuntime(runtime);
}
function refreshPublishedGarden(){
  if(location.protocol==='file:' || previewToken || previewReceived)return Promise.resolve();
  if(publishedGardenRequest)return publishedGardenRequest;
  lastPublishedAttempt=Date.now();
  contentAvailability.loading();
  publishedGardenRequest=loadPublishedGarden({defaults:gardenDefaults,pageURL:location.href,onRuntime:updateGardenRuntime}).then(({content,runtime,connected})=>{
    publishedGardenConnected=connected;
    if(previewReceived)return;
    if(!connected){contentAvailability.error();return;}
    commentsService.setBaseUrl(runtime.apiBaseUrl || new URL('/',location.href).href);
    applyGardenContent(content);
    contentAvailability.ready();
    beginPublicScene();
  }).catch(()=>{
    publishedGardenConnected=false;
    if(!previewReceived)contentAvailability.error();
  }).finally(()=>{publishedGardenRequest=null;});
  return publishedGardenRequest;
}
function retryPublishedGarden(){
  if(!previewToken&&!publishedGardenConnected&&Date.now()-lastPublishedAttempt>=5000)void refreshPublishedGarden();
}
window.addEventListener('online',retryPublishedGarden);
window.addEventListener('focus',retryPublishedGarden);
applyTheme();
function beginPublicScene(){
  if(publicSceneStarted)return;
  publicSceneStarted=true;
  outfitShowcase?.setPreloadEnabled?.(true);
  if(requestedSection>0) {
    finishIntro();
    // Keep the original fragment until the first verified chapter settles.
    const releaseInitialRoute=()=>{
      initialRoutePending=false;applyURL();
      if(MODELS[modelId].preview)return;
      if(requestedSection===1){introEntrance?.prepare();void introEntrance?.enter();}
      else if(requestedSection===2)void enterAlbum();
      else if(requestedSection===3){personalEntrance?.prepare();syncPersonalEntrance();}
    };
    void navigator.goTo(requestedSection,{animate:false,source:'history'}).then(releaseInitialRoute,releaseInitialRoute);
  } else {
    if(reducedMotion() || !root.classList.contains('is-booting'))finishIntro();
    else if(MODELS[modelId].preview)startIntro();
    else {
      root.dataset.phase='video';root.classList.remove('is-booting');introWaiting=true;
      introFallbackTimer=setTimeout(()=>{if(introWaiting)startIntro();},2000);
    }
    void player.start();
  }
}
if(previewToken || location.protocol==='file:'){
  contentAvailability.ready(previewToken?'preview':'static');
  beginPublicScene();
} else void refreshPublishedGarden();
window.addEventListener('load', () => navigator.refresh(), {once:true});
document.fonts?.ready.then(()=>{navigator.refresh();sidebar?.refresh();contrastLayer?.refresh();});
