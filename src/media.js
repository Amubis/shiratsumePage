/** Two managed layers, reusing the native HTML video that works without JS. */
export function createVideoPlayer({ container, playlist = [], poster, reducedMotion = () => false, onStatus = () => {}, loadingTimeout = 8000 }) {
  const doc = container.ownerDocument;
  const posterImage = container.querySelector('img.poster');
  const primary = container.querySelector('video[data-hero-primary]');
  const timeout = Math.max(1, Number(loadingTimeout) || 8000);
  const videos = [primary || doc.createElement('video'), doc.createElement('video')];
  videos.forEach((video, index) => {
    video.className = `hero-video hero-video--${index ? 'b' : 'a'}`;
    video.controls = false;
    video.autoplay = false;
    video.removeAttribute('autoplay');
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('aria-hidden', 'true');
    video.tabIndex = -1;
    video.preload = 'auto';
    Object.assign(video.style, {
      position: 'absolute', inset: '0', width: '100%', height: '100%',
      objectFit: 'cover', opacity: '0', transition: 'opacity 700ms ease', pointerEvents: 'none',
    });
    container.append(video);
  });
  container.classList.add('is-managed');
  let list = [];
  let active = 0;
  let generation = 0;
  let explicitlyPaused = true;
  let destroyed = false;
  let started = false;
  let configuring = false;
  let request = null;
  let transition = null;
  let recycleTimer;
  let currentStatus = '';
  let currentDetails = {};

  function status(value, details = {}) {
    if (destroyed || (currentStatus === value && currentDetails.reason === details.reason && currentDetails.errorCode === details.errorCode)) return;
    currentStatus = value;
    currentDetails = details;
    container.dataset.videoState = value;
    if (details.reason) container.dataset.videoReason = details.reason;
    else delete container.dataset.videoReason;
    onStatus(value, details);
  }
  function canPlay() { return !destroyed && !explicitlyPaused && !doc.hidden; }
  function showPoster() {
    container.classList.remove('has-video');
    if (posterImage) posterImage.style.opacity = '1';
    videos.forEach((video) => { video.style.opacity = '0'; });
  }
  function showVideo() {
    container.classList.add('has-video');
    if (posterImage) posterImage.style.opacity = '0';
  }
  function choose(exclude) {
    const candidates = list.filter((url) => url !== exclude);
    return candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : list[0];
  }
  function load(video, url) {
    video.pause();
    delete video.dataset.failed;
    video.dataset.clip = url || '';
    if (!url) video.removeAttribute('src');
    else video.src = url;
    video.load();
  }
  function cancelRequest() {
    if (!request) return;
    clearTimeout(request.timer);
    request.resolve(false);
    request = null;
  }
  function cancelTransition() {
    clearTimeout(recycleTimer);
    if (!transition) return;
    const previous = transition;
    transition = null;
    clearTimeout(previous.timer);
    if (previous.committed) {
      previous.previous.style.opacity = '0';
      previous.previous.style.zIndex = '0';
      previous.next.style.zIndex = '1';
      previous.previous.pause();
      // A canceled fade still leaves a reusable next layer at its beginning.
      if (previous.previous.readyState) previous.previous.currentTime = 0;
    } else {
      previous.next.pause();
      previous.next.style.opacity = '0';
    }
  }
  function mediaDetails(video, error) {
    const code = video.error?.code;
    const names = { 1: 'aborted', 2: 'network', 3: 'decode', 4: 'unsupported' };
    return {
      reason: code ? names[code] || 'media-error' : error?.name || 'play-error',
      ...(code ? { errorCode: code } : {}),
    };
  }
  function confirmPlaying(video) {
    if (destroyed || configuring) return;
    if (!canPlay()) { video.pause(); return; }
    if (transition?.next === video && !transition.committed) { commitTransition(transition); return; }
    if (video !== videos[active]) { video.pause(); return; }
    // A timed-out attempt remains eligible to recover on a real playing event.
    if (request?.video === video) {
      clearTimeout(request.timer);
      request.resolve(true);
      request = null;
    }
    video.style.opacity = '1';
    showVideo();
    status('playing');
  }
  function rejectPlayback(attempt, error) {
    if (request !== attempt || attempt.generation !== generation || !canPlay()) return;
    clearTimeout(attempt.timer);
    attempt.resolve(false);
    request = null;
    showPoster();
    const blocked = error?.name === 'NotAllowedError';
    status(blocked ? 'blocked' : 'error', blocked ? { reason: 'NotAllowedError' } : mediaDetails(attempt.video, error));
  }
  function playActive() {
    if (!canPlay() || !list.length) {
      status(list.length ? 'paused' : 'poster', list.length ? {} : { reason: 'empty-playlist' });
      return Promise.resolve(false);
    }
    const video = videos[active];
    if (currentStatus === 'playing' && !video.paused && video.readyState >= 2) return Promise.resolve(true);
    cancelRequest();
    let resolve;
    const result = new Promise((settle) => { resolve = settle; });
    const attempt = { video, generation, resolve, timer: null };
    request = attempt;
    status('loading');
    attempt.timer = setTimeout(() => {
      if (request !== attempt || generation !== attempt.generation || !canPlay()) return;
      attempt.resolve(false);
      showPoster();
      status('timeout', { reason: 'loading-timeout' });
      // Do not pause: a late playing event can still recover this request.
    }, timeout);
    try {
      Promise.resolve(video.play()).then(() => {
        if (request !== attempt || generation !== attempt.generation || !canPlay()) return;
        // Modern browsers emit playing first. This covers legacy play() and
        // media implementations that have a ready frame but omit that event.
        if (video.readyState >= 2 && !video.paused) confirmPlaying(video);
      }, (error) => rejectPlayback(attempt, error));
    } catch (error) { rejectPlayback(attempt, error); }
    return result;
  }
  function repeatCurrent() {
    const video = videos[active];
    video.loop = true;
    if (video.ended) video.currentTime = 0;
    return playActive();
  }
  function commitTransition(operation) {
    if (transition !== operation || operation.generation !== generation || !canPlay()) return;
    operation.committed = true;
    clearTimeout(operation.timer);
    cancelRequest();
    active = operation.nextIndex;
    const { next, previous } = operation;
    showVideo();
    next.style.zIndex = '2';
    previous.style.zIndex = '1';
    next.style.transition = reducedMotion() ? 'none' : 'opacity 700ms ease';
    next.style.opacity = '1';
    // A new top layer fades over an opaque old frame, avoiding a dark midpoint.
    previous.style.opacity = '1';
    status('playing');
    recycleTimer = setTimeout(() => {
      if (transition !== operation || operation.generation !== generation || destroyed) return;
      previous.style.opacity = '0';
      previous.style.zIndex = '0';
      next.style.zIndex = '1';
      load(previous, choose(next.dataset.clip));
      previous.loop = false;
      transition = null;
    }, reducedMotion() ? 0 : 700);
  }
  function failTransition(operation, markFailed = true) {
    if (transition !== operation || operation.generation !== generation || operation.committed) return;
    if (markFailed) operation.next.dataset.failed = 'true';
    cancelTransition();
    if (canPlay()) void repeatCurrent();
  }
  function advance(force = false) {
    if (transition || !canPlay() || list.length < 2) return;
    const previous = videos[active];
    const nextIndex = 1 - active;
    const next = videos[nextIndex];
    if (next.dataset.failed) { if (force) void repeatCurrent(); return; }
    if (!force && next.readyState < 2) return;
    const operation = { previous, next, nextIndex, generation, committed: false, timer: null };
    transition = operation;
    operation.timer = setTimeout(() => failTransition(operation, false), timeout);
    try {
      Promise.resolve(next.play()).then(() => {
        if (transition !== operation || operation.committed || generation !== operation.generation || !canPlay()) return;
        if (next.readyState >= 2 && !next.paused) commitTransition(operation);
      }, () => failTransition(operation));
    } catch { failTransition(operation); }
  }
  const listeners = videos.map((video, index) => {
    const handlers = {
      timeupdate() {
        if (index === active && Number.isFinite(video.duration) && video.duration - video.currentTime <= 0.9) advance();
      },
      ended() { if (index === active) advance(true); },
      playing() { confirmPlaying(video); },
      loadeddata() {
        if (request?.video === video && video.readyState >= 2 && !video.paused) confirmPlaying(video);
      },
      error() {
        if (configuring || destroyed || !video.dataset.clip) return;
        video.dataset.failed = 'true';
        if (transition?.next === video && !transition.committed) failTransition(transition);
        else if (index === active) {
          cancelRequest();
          if (canPlay()) { showPoster(); status('error', mediaDetails(video)); }
        }
      },
    };
    Object.entries(handlers).forEach(([name, handler]) => video.addEventListener(name, handler));
    return handlers;
  });
  function pauseVideos() {
    cancelRequest();
    cancelTransition();
    videos.forEach((video) => video.pause());
    status('paused');
  }
  function onVisibility() {
    if (doc.hidden) pauseVideos();
    else if (started && !explicitlyPaused) void playActive();
  }
  doc.addEventListener('visibilitychange', onVisibility);

  function setPlaylist(nextList, nextPoster = poster) {
    if (destroyed) return;
    generation += 1;
    cancelRequest();
    cancelTransition();
    configuring = true;
    list = [...new Set((nextList || []).filter((url) => typeof url === 'string' && url.trim()).map((url) => url.trim()))];
    poster = nextPoster;
    if (posterImage && poster) posterImage.src = poster;
    active = 0;
    videos.forEach((video, index) => {
      video.style.opacity = '0';
      video.style.zIndex = index === 0 ? '1' : '0';
      video.loop = list.length === 1;
      if (poster) video.poster = poster;
    });
    showPoster();
    const first = choose();
    load(videos[0], first);
    load(videos[1], list.length > 1 ? choose(first) : undefined);
    configuring = false;
    status('poster', list.length ? {} : { reason: 'empty-playlist' });
    if (started && canPlay()) void playActive();
  }
  setPlaylist(playlist, poster);
  return {
    async start() {
      if (destroyed) return false;
      started = true;
      explicitlyPaused = Boolean(reducedMotion());
      if (explicitlyPaused) { status('poster', { reason: 'reduced-motion' }); return false; }
      return playActive();
    },
    pause() { explicitlyPaused = true; pauseVideos(); },
    async resume() {
      if (destroyed) return false;
      started = true;
      explicitlyPaused = false;
      return playActive();
    },
    setPlaylist,
    get paused() { return explicitlyPaused || doc.hidden || currentStatus !== 'playing'; },
    destroy() {
      if (destroyed) return;
      generation += 1;
      cancelRequest();
      cancelTransition();
      doc.removeEventListener('visibilitychange', onVisibility);
      destroyed = true;
      videos.forEach((video, index) => {
        Object.entries(listeners[index]).forEach(([name, handler]) => video.removeEventListener(name, handler));
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.remove();
      });
      showPoster();
      container.classList.remove('is-managed');
    },
  };
}
