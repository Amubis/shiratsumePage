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
 * Native scrolling owns wheel, touch and keyboard movement. CSS may provide
 * proximity snapping; only explicit goTo() requests animate programmatically.
 *
 * Callbacks receive (index, { source, from?, signal? }); onProgress only resets
 * to zero. goTo resolves true on settling and false if interrupted/superseded.
 * An asynchronous before-navigation hook receives an AbortSignal for cleanup.
 */
export function createSectionNavigator({
  sections,
  onActive = () => {},
  onProgress = () => {},
  onBeforeNavigate = () => {},
  onSettled = () => {},
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
    spy('interrupt');
  };

  function goTo(index, { animate = true, source = 'nav' } = {}) {
    if (destroyed || !Number.isInteger(index) || index < 0 || index > lastIndex) {
      return Promise.resolve(false);
    }
    cancelOperation();
    onProgress(0);
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
          await onBeforeNavigate(index, { source, from, signal: controller.signal });
          if (!isCurrent()) return;
          measure();
          const startY = scrollY();
          if (!animate || reducedMotion() || Math.abs(destination() - startY) < 1) {
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
  const handleWheel = (event) => {
    if (destroyed || yieldToModal() || event.ctrlKey || event.metaKey) return;
    const delta = normalizeWheel(event, viewportHeight());
    const horizontal = normalizeWheel({ deltaY: event.deltaX, deltaMode: event.deltaMode }, viewportHeight());
    if (!Number.isFinite(delta) || !delta || Math.abs(horizontal) > Math.abs(delta)) return;
    // Never cancel the event: the very input that stops goTo continues natively.
    interrupt();
  };
  const handleKey = (event) => {
    if (destroyed || yieldToModal()) return;
    if (['Escape', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'Home', 'End'].includes(event.key)) interrupt();
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
    measure();
    spy('refresh');
  };

  measure();
  activeIndex = determineActiveIndex(scrollY(), positions, viewportHeight());
  win.addEventListener('wheel', handleWheel, { passive: true });
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
