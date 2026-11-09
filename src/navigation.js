/** Convert wheel line/page units to CSS pixels without depending on a browser. */
export function normalizeWheel(event, viewportHeight = 800, lineHeight = 16) {
  const delta = Number(event.deltaY) || 0;
  return delta * (event.deltaMode === 1 ? lineHeight : event.deltaMode === 2 ? viewportHeight : 1);
}

/** A section becomes current when its top reaches the upper third of the view. */
export function determineActiveIndex(scrollY, positions, viewportHeight = 0) {
  if (!positions.length) return -1;
  const marker = scrollY + viewportHeight / 3 + 1;
  let index = 0;
  for (let i = 1; i < positions.length; i += 1) {
    if (positions[i] > marker) break;
    index = i;
  }
  return index;
}

/**
 * Fine-pointer wheel gestures briefly pull against the current screen before
 * advancing one chapter. Touch and content taller than the screen stay native.
 *
 * Callbacks receive (index, { source, from?, signal? }); onProgress receives a
 * signed resistance amount in [-1, 1]. goTo resolves false when interrupted.
 * An asynchronous before-navigation hook receives an AbortSignal for cleanup.
 */
export function createSectionNavigator({
  sections,
  onActive = () => {},
  onProgress = () => {},
  onBeforeNavigate = () => {},
  onSettled = () => {},
  onChapterWheel = () => false,
  onInterrupt = () => {},
  reducedMotion = () => false,
} = {}) {
  if (!sections?.length) throw new TypeError('At least one section is required.');
  const win = window;
  const doc = win.document;
  const screens = Array.from(sections);
  const lastIndex = screens.length - 1;
  const now = () => win.performance?.now() ?? Date.now();
  const requestFrame = win.requestAnimationFrame.bind(win);
  const cancelFrame = win.cancelAnimationFrame.bind(win);
  let positions = [];
  let activeIndex = 0;
  let operation = null;
  let destroyed = false;
  let spyFrame = null;
  let resistanceFrame = null;
  let resistance = null;
  let gestureLocked = false;
  let lastWheelAt = -Infinity;
  const gestureGap = 220;
  const resistanceThreshold = 64;
  const resistancePreview = 80;

  const viewportHeight = () => Math.max(1, win.innerHeight || doc.documentElement.clientHeight || 1);
  const scrollY = () => win.scrollY ?? doc.documentElement.scrollTop ?? 0;
  const maxScroll = () => Math.max(0,
    Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight || 0) - viewportHeight());
  const writeScroll = (top) => win.scrollTo({ top, left: 0, behavior: 'instant' });
  const markProgrammatic = (enabled) => {
    doc.documentElement.classList?.toggle('is-programmatic-scroll', enabled);
  };
  const measure = () => {
    const y = scrollY();
    positions = screens.map((section) => section.getBoundingClientRect().top + y);
  };
  const clearResistance = () => {
    if (resistanceFrame !== null) cancelFrame(resistanceFrame);
    resistanceFrame = null;
    resistance = null;
    onProgress(0);
  };
  const setActive = (index, source, force = false) => {
    if (force || index !== activeIndex) {
      activeIndex = index;
      onActive(index, { source });
    }
  };
  const spy = (source = 'scroll', force = false) => {
    if (!destroyed) setActive(determineActiveIndex(scrollY(), positions, viewportHeight()), source, force);
  };
  const cancelOperation = () => {
    if (!operation) return;
    const previous = operation;
    operation = null;
    if (previous.frame !== null) cancelFrame(previous.frame);
    markProgrammatic(false);
    previous.controller.abort();
    previous.resolve(false);
    onProgress(0);
  };
  const interrupt = () => {
    cancelOperation();
    clearResistance();
    gestureLocked = false;
    spy('interrupt');
    onInterrupt();
  };

  function goTo(index, { animate = true, source = 'nav' } = {}) {
    if (destroyed || !Number.isInteger(index) || index < 0 || index > lastIndex) {
      return Promise.resolve(false);
    }
    cancelOperation();
    clearResistance();
    const from = activeIndex;
    const controller = new AbortController();
    return new Promise((resolve, reject) => {
      const current = { index, source, frame: null, controller, resolve };
      operation = current;
      markProgrammatic(true);
      const isCurrent = () => !destroyed && operation === current;
      const destination = () => Math.max(0, Math.min(positions[index], maxScroll()));
      const finish = () => {
        if (!isCurrent()) return;
        writeScroll(destination());
        operation = null;
        current.frame = null;
        markProgrammatic(false);
        setActive(index, source);
        resolve(true);
        onSettled(index, { source, from });
      };
      const start = async () => {
        try {
          const preparation = await onBeforeNavigate(index, { source, from, signal: controller.signal });
          if (!isCurrent()) return;
          measure();
          const startY = scrollY();
          if (!animate || preparation?.animate === false || reducedMotion() || Math.abs(destination() - startY) < 1) {
            finish();
            return;
          }
          const startedAt = now();
          const duration = 520;
          const tick = (timestamp) => {
            if (!isCurrent()) return;
            const t = Math.max(0, Math.min(1, (timestamp - startedAt) / duration));
            const eased = t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
            writeScroll(startY + (destination() - startY) * eased);
            if (t < 1) current.frame = requestFrame(tick);
            else finish();
          };
          current.frame = requestFrame(tick);
        } catch (error) {
          if (!isCurrent()) return;
          operation = null;
          if (current.frame !== null) cancelFrame(current.frame);
          markProgrammatic(false);
          controller.abort();
          onProgress(0);
          spy('error');
          reject(error);
        }
      };
      void start();
    });
  }

  const yieldToModal = () => {
    if (!doc.querySelector?.('dialog[open], [role="dialog"][aria-modal="true"]')) return false;
    interrupt();
    return true;
  };
  const desktopInput = () => !win.matchMedia || win.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const interactiveTarget = (target) => Boolean(target?.closest?.('input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="spinbutton"]'));
  const nativeWheelTarget = (target) => {
    if (target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-native-scroll]')) return true;
    for (let node = target; node && node !== doc.body && node !== doc.documentElement; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight + 2) {
        const overflow = win.getComputedStyle?.(node)?.overflowY;
        if (overflow === 'auto' || overflow === 'scroll') return true;
      }
    }
    return false;
  };
  const currentGeometry = () => {
    const y = scrollY();
    const height = viewportHeight();
    let index = 0;
    for (let i = 1; i < positions.length; i += 1) {
      if (positions[i] > y + 8) break;
      index = i;
    }
    const rect = screens[index].getBoundingClientRect();
    const sectionHeight = rect.height || screens[index].offsetHeight || (positions[index + 1] - positions[index]) || height;
    const bottom = positions[index] + sectionHeight;
    return { index, y, height, sectionHeight, top: positions[index], bottom };
  };
  const readingBoundary = (delta) => {
    const { index, y, height, sectionHeight, top, bottom } = currentGeometry();
    const tall = sectionHeight > height + 32;
    // Native reading may reach a chapter edge, but one oversized wheel packet
    // must not carry the reader through the chapters beyond it.
    if (delta < 0 && (tall || index === lastIndex) && y > top + 8 && y + delta <= top) return top;
    if (delta > 0 && tall && index < lastIndex && y + height < bottom - 8 && y + delta >= bottom - height) return bottom - height;
    return null;
  };
  const wheelDestination = (direction) => {
    const { index, y, height, sectionHeight, bottom } = currentGeometry();
    // Every pixel of long chapters remains available before changing screens.
    if (direction > 0 && (index === lastIndex || (sectionHeight > height + 32 && y + height < bottom - 8))) return null;
    if (direction < 0 && (sectionHeight > height + 32 || index === lastIndex) && y > positions[index] + 8) return null;
    // A restored or natively interrupted offset returns to its own section first.
    const destination = direction < 0 && y > positions[index] + 12 ? index : index + direction;
    return destination < 0 || destination > lastIndex ? null : destination;
  };
  const beginResistance = (direction, amount, destination) => {
    const timestamp = now();
    if (!resistance || resistance.direction !== direction) {
      clearResistance();
      resistance = { direction, amount: 0, startedAt: timestamp, destination };
    }
    resistance.amount = Math.min(resistanceThreshold, resistance.amount + Math.min(Math.abs(amount), 120));
    resistance.destination = destination;
    onProgress(direction * resistance.amount / resistanceThreshold);
    if (resistanceFrame !== null) return;
    const tick = (time) => {
      resistanceFrame = null;
      if (!resistance || destroyed) return;
      if (resistance.amount >= resistanceThreshold && time - resistance.startedAt >= resistancePreview) {
        const index = resistance.destination;
        gestureLocked = true;
        void goTo(index, { source: 'wheel' }).catch(() => { gestureLocked = false; });
      } else if (time - lastWheelAt >= gestureGap) clearResistance();
      else resistanceFrame = requestFrame(tick);
    };
    resistanceFrame = requestFrame(tick);
  };
  const handleWheel = (event) => {
    if (destroyed || event.defaultPrevented || yieldToModal() || event.ctrlKey || event.metaKey) return;
    const delta = normalizeWheel(event, viewportHeight());
    const horizontal = normalizeWheel({ deltaY: event.deltaX, deltaMode: event.deltaMode }, viewportHeight());
    if (!Number.isFinite(delta) || !delta || Math.abs(horizontal) > Math.abs(delta)) return;
    if (event.cancelable === false) { interrupt(); return; }
    if (!desktopInput() || nativeWheelTarget(event.target)) { interrupt(); return; }
    const intentTime = now();
    const allowStart = !(operation && operation.source !== 'album-scroll')
      && !(gestureLocked && intentTime - lastWheelAt <= gestureGap);
    if (onChapterWheel({delta,from:activeIndex,destination:wheelDestination(Math.sign(delta))},{allowStart})) {
      event.preventDefault();
      return;
    }
    if (operation && operation.source !== 'wheel') { interrupt(); return; }
    const timestamp = now();
    if (timestamp - lastWheelAt > gestureGap && !operation) {
      gestureLocked = false;
      clearResistance();
    }
    lastWheelAt = timestamp;
    if (gestureLocked || operation?.source === 'wheel') {
      event.preventDefault();
      return;
    }
    const boundary = readingBoundary(delta);
    if (boundary !== null) {
      event.preventDefault();
      clearResistance();
      gestureLocked = true;
      // Both edges of an oversized snap area are valid native snap positions.
      // Keep the full chapter visible before a new gesture can turn the page.
      writeScroll(boundary);
      return;
    }
    const direction = Math.sign(delta);
    const destination = wheelDestination(direction);
    if (destination === null) { clearResistance(); return; }
    event.preventDefault();
    beginResistance(direction, delta, destination);
  };
  const handleKey = (event) => {
    if (destroyed || event.defaultPrevented || yieldToModal()) return;
    if (event.key === 'Escape') { interrupt(); return; }
    if (!desktopInput() || event.ctrlKey || event.metaKey || event.altKey || interactiveTarget(event.target)) return;
    const down = ['ArrowDown', 'PageDown', ' '].includes(event.key) && !(event.key === ' ' && event.shiftKey);
    const up = ['ArrowUp', 'PageUp'].includes(event.key) || (event.key === ' ' && event.shiftKey);
    let destination = down || up ? wheelDestination(down ? 1 : -1) : null;
    if (event.key === 'Home') destination = 0;
    if (event.key === 'End' && scrollY() < positions[lastIndex] - 8) destination = lastIndex;
    if (destination === null) { interrupt(); return; }
    event.preventDefault();
    if (!event.repeat && !operation) void goTo(destination, { source: 'keyboard' }).catch(() => {});
  };
  const handleTouchStart = () => {
    if (destroyed || yieldToModal()) return;
    interrupt();
  };
  const handlePointerDown = () => {
    if (!destroyed) interrupt();
  };
  const handleScroll = () => {
    if (spyFrame !== null) return;
    spyFrame = requestFrame(() => {
      spyFrame = null;
      spy();
    });
  };
  const refresh = () => {
    if (destroyed) return;
    clearResistance();
    measure();
    spy('refresh');
  };

  measure();
  activeIndex = determineActiveIndex(scrollY(), positions, viewportHeight());
  win.addEventListener('wheel', handleWheel, { passive: false });
  win.addEventListener('keydown', handleKey);
  win.addEventListener('scroll', handleScroll, { passive: true });
  win.addEventListener('resize', refresh, { passive: true });
  win.addEventListener('pointerdown', handlePointerDown, { passive: true });
  win.addEventListener('touchstart', handleTouchStart, { passive: true });
  queueMicrotask(() => {
    if (!destroyed && !operation) spy('init', true);
  });

  return {
    goTo,
    refresh,
    get activeIndex() { return activeIndex; },
    get transitioning() { return operation !== null; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelOperation();
      clearResistance();
      markProgrammatic(false);
      if (spyFrame !== null) cancelFrame(spyFrame);
      win.removeEventListener('wheel', handleWheel);
      win.removeEventListener('keydown', handleKey);
      win.removeEventListener('scroll', handleScroll);
      win.removeEventListener('resize', refresh);
      win.removeEventListener('pointerdown', handlePointerDown);
      win.removeEventListener('touchstart', handleTouchStart);
    },
  };
}
