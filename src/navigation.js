/** Convert wheel line/page units to CSS pixels without depending on a browser. */
export function normalizeWheel(event, viewportHeight = 800, lineHeight = 16) {
  const delta = Number(event.deltaY) || 0;
  return delta * (event.deltaMode === 1 ? lineHeight : event.deltaMode === 2 ? viewportHeight : 1);
}

export function accumulateProgress(current, delta, threshold) {
  if (!(threshold > 0)) return 0;
  return Math.max(-threshold, Math.min(threshold, current + delta));
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
 * Full-screen section navigation, with native scrolling inside taller sections.
 * All DOM access is deferred until this function is called.
 *
 * Callbacks receive (index, { source, from?, signal? }); onProgress receives [-1, 1].
 * goTo resolves true after settling, false if superseded/destroyed. A rejected
 * before-navigation hook rejects goTo while releasing the transition immediately.
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
  let progress = 0;
  let wheelAmount = 0;
  let wheelLocked = false;
  let wheelLockDirection = 0;
  let lastWheelAt = -Infinity;
  let spyFrame = null;
  let touch = null;

  const viewportHeight = () => Math.max(1, win.innerHeight || doc.documentElement.clientHeight || 1);
  const scrollY = () => win.scrollY ?? doc.documentElement.scrollTop ?? 0;
  const maxScroll = () => Math.max(0,
    Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight || 0) - viewportHeight());
  const writeScroll = (top) => win.scrollTo({ top, left: 0, behavior: 'instant' });
  const measure = () => {
    const y = scrollY();
    positions = screens.map((section) => section.getBoundingClientRect().top + y);
  };
  const emitProgress = (value) => {
    const next = Math.max(-1, Math.min(1, value));
    if (next !== progress) {
      progress = next;
      onProgress(next);
    }
  };
  const resetProgress = () => {
    wheelAmount = 0;
    emitProgress(0);
  };
  const setActive = (index, source, force = false) => {
    if (force || index !== activeIndex) {
      activeIndex = index;
      onActive(index, { source });
    }
  };
  const spy = (source = 'scroll', force = false) => {
    if (!destroyed && !operation) {
      setActive(determineActiveIndex(scrollY(), positions, viewportHeight()), source, force);
    }
  };
  const cancelOperation = () => {
    if (!operation) return;
    const previous = operation;
    operation = null;
    if (previous.frame !== null) cancelFrame(previous.frame);
    previous.controller.abort();
    previous.resolve(false);
    resetProgress();
  };
  const interrupt = () => {
    cancelOperation();
    resetProgress();
    spy('interrupt');
  };
  const reportFailure = (error) => win.console?.error('Section navigation failed:', error);

  function navigate(index, { animate = true, source = 'nav' } = {}, explicitTop = null) {
    if (destroyed || !Number.isInteger(index) || index < 0 || index > lastIndex) {
      return Promise.resolve(false);
    }
    cancelOperation();
    resetProgress();
    const from = activeIndex;
    const controller = new AbortController();
    return new Promise((resolve, reject) => {
      const current = { index, frame: null, controller, resolve };
      operation = current;
      const isCurrent = () => !destroyed && operation === current;
      const destination = () => Math.max(0, Math.min(
        explicitTop === 'end' ? maxScroll() : explicitTop ?? positions[index], maxScroll()));
      const finish = () => {
        if (!isCurrent()) return;
        writeScroll(destination());
        operation = null;
        current.frame = null;
        setActive(index, source);
        resolve(true);
        onSettled(index, { source, from });
      };
      const start = async () => {
        try {
          await onBeforeNavigate(index, { source, from, signal: controller.signal });
          if (!isCurrent()) return;
          measure();
          setActive(index, source);
          const startY = scrollY();
          if (!animate || reducedMotion() || Math.abs(destination() - startY) < 1) {
            finish();
            return;
          }
          const startedAt = now();
          const duration = 650;
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
          controller.abort();
          resetProgress();
          spy('error');
          reject(error);
        }
      };
      void start();
    });
  }

  const goTo = (index, options) => navigate(index, options);
  const fireNavigation = (index, options, explicitTop) => {
    void navigate(index, options, explicitTop).catch(reportFailure);
  };
  const editable = (target) => Boolean(target?.closest?.(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-native-scroll]'));
  const interactive = (target) => editable(target) || Boolean(target?.closest?.(
    'button, a[href], summary, [role="button"], [role="slider"], [role="tab"]'));
  const hasScrollableParent = (target, delta = 0) => {
    let node = target?.nodeType === 1 ? target : target?.parentElement;
    while (node && node !== doc.body && node !== doc.documentElement) {
      const overflow = win.getComputedStyle(node).overflowY;
      if (/(auto|scroll|overlay)/.test(overflow) && node.scrollHeight > node.clientHeight + 1) {
        if (!delta || (delta < 0 && node.scrollTop > 0)
          || (delta > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1)) return true;
      }
      node = node.parentElement;
    }
    return false;
  };
  const directionalTarget = (direction) => {
    const y = scrollY();
    if (direction > 0 && y < positions[activeIndex] - 2) return activeIndex;
    if (direction < 0 && y > positions[activeIndex] + 2) return activeIndex;
    return Math.max(0, Math.min(lastIndex, activeIndex + direction));
  };
  // A section can grow beyond one screen on narrow layouts. Its interior remains
  // readable before the wheel resistance takes over at either scrolling edge.
  const sectionEnd = (index) => index === lastIndex ? maxScroll()
    : Math.max(positions[index], positions[index + 1] - viewportHeight());
  const nativeRange = (direction, index = activeIndex, y = scrollY()) => {
    const top = positions[index];
    const end = sectionEnd(index);
    if (direction > 0 && index === lastIndex && y >= top - 2) return { top, end, unbounded: true };
    if (direction > 0 && y >= top - 2 && y < end - 2) return { top, end };
    if (direction < 0 && y > top + 2) return { top, end };
    return null;
  };
  const yieldToModal = () => {
    if (!doc.querySelector?.('dialog[open], [role="dialog"][aria-modal="true"]')) return false;
    interrupt();
    wheelLocked = false;
    touch = null;
    return true;
  };

  const handleWheel = (event) => {
    if (destroyed || yieldToModal() || event.defaultPrevented || event.ctrlKey || editable(event.target)) return;
    const delta = normalizeWheel(event, viewportHeight());
    if (!delta || hasScrollableParent(event.target, delta)) return;
    const direction = Math.sign(delta);
    const timestamp = now();
    const continuedGesture = timestamp - lastWheelAt < 180;
    lastWheelAt = timestamp;
    if (wheelLocked && continuedGesture && direction === wheelLockDirection) {
      event.preventDefault();
      return;
    }
    wheelLocked = false;
    if (operation) interrupt();
    const y = scrollY();
    const range = nativeRange(direction);
    if (range) {
      // Reverse input first cancels resistance already collected at an edge.
      // Only the remainder should return to natural interior scrolling.
      if (wheelAmount && Math.sign(wheelAmount) !== direction) {
        const remainder = wheelAmount + delta;
        event.preventDefault();
        if (!remainder || Math.sign(remainder) === Math.sign(wheelAmount)) {
          wheelAmount = remainder;
          emitProgress(wheelAmount / viewportHeight());
        } else {
          resetProgress();
          writeScroll(Math.max(range.top, Math.min(range.unbounded ? maxScroll() : range.end, y + remainder)));
        }
        return;
      }
      resetProgress();
      if (delta < 0 && y + delta < range.top) {
        event.preventDefault();
        writeScroll(range.top);
      } else if (delta > 0 && !range.unbounded && y + delta > range.end) {
        event.preventDefault();
        writeScroll(range.end);
      }
      return;
    }
    const accumulated = accumulateProgress(wheelAmount, delta, viewportHeight());
    const target = directionalTarget(Math.sign(accumulated) || direction);
    if (target === activeIndex && Math.abs(y - positions[activeIndex]) < 2) {
      resetProgress();
      return;
    }
    event.preventDefault();
    wheelAmount = accumulated;
    emitProgress(wheelAmount / viewportHeight());
    if (Math.abs(wheelAmount) >= viewportHeight()) {
      const intent = Math.sign(wheelAmount);
      const next = directionalTarget(intent);
      wheelLocked = true;
      wheelLockDirection = intent;
      fireNavigation(next, { source: 'wheel' });
    }
  };

  const handleKey = (event) => {
    if (destroyed || yieldToModal() || event.defaultPrevented) return;
    if (event.key === 'Escape') {
      interrupt();
      return;
    }
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey
      || interactive(event.target)) return;
    const key = event.key;
    const direction = key === 'ArrowDown' || key === 'PageDown' || (key === ' ' && !event.shiftKey)
      ? 1 : key === 'ArrowUp' || key === 'PageUp' || (key === ' ' && event.shiftKey) ? -1 : 0;
    if (!direction && key !== 'Home' && key !== 'End') return;
    if (direction && hasScrollableParent(event.target, direction)) return;
    wheelLocked = false;
    if (key === 'Home' || key === 'End') {
      event.preventDefault();
      fireNavigation(key === 'Home' ? 0 : lastIndex, { source: 'keyboard' }, key === 'End' ? 'end' : 0);
      return;
    }
    const range = nativeRange(direction);
    if (range) {
      interrupt();
      if (!range.unbounded) {
        event.preventDefault();
        const step = key.startsWith('Arrow') ? 40 : viewportHeight() * 0.9;
        writeScroll(Math.max(range.top, Math.min(range.end, scrollY() + direction * step)));
      }
      return;
    }
    event.preventDefault();
    fireNavigation(directionalTarget(direction), { source: 'keyboard' });
  };

  const handleTouchStart = (event) => {
    if (destroyed || yieldToModal()) return;
    interrupt();
    wheelLocked = false;
    if (event.touches.length !== 1 || interactive(event.target) || hasScrollableParent(event.target)) {
      touch = null;
      return;
    }
    touch = {
      x: event.touches[0].clientX, y: event.touches[0].clientY,
      index: activeIndex, scrollY: scrollY(),
    };
  };
  const handleTouchEnd = (event) => {
    if (destroyed || yieldToModal()) return;
    if (!touch || !event.changedTouches.length) return;
    const started = touch;
    touch = null;
    const dx = event.changedTouches[0].clientX - started.x;
    const dy = event.changedTouches[0].clientY - started.y;
    if (Math.abs(dy) < 40 || Math.abs(dy) < Math.abs(dx) * 1.2) return;
    const direction = dy < 0 ? 1 : -1;
    const range = nativeRange(direction, started.index, started.scrollY);
    if (range) {
      if (direction < 0 && scrollY() < range.top) fireNavigation(started.index, { source: 'touch' });
      return;
    }
    fireNavigation(Math.max(0, Math.min(lastIndex, started.index + direction)), { source: 'touch' });
  };
  const handleTouchCancel = () => { touch = null; };
  const handleScroll = () => {
    if (spyFrame !== null) return;
    spyFrame = requestFrame(() => {
      spyFrame = null;
      spy();
    });
  };
  const handlePointerDown = () => {
    if (operation) interrupt();
    wheelLocked = false;
  };
  const refresh = () => {
    if (destroyed) return;
    measure();
    if (!operation) spy('refresh');
    emitProgress(wheelAmount / viewportHeight());
  };

  measure();
  activeIndex = determineActiveIndex(scrollY(), positions, viewportHeight());
  win.addEventListener('wheel', handleWheel, { passive: false });
  win.addEventListener('keydown', handleKey);
  win.addEventListener('scroll', handleScroll, { passive: true });
  win.addEventListener('resize', refresh, { passive: true });
  win.addEventListener('pointerdown', handlePointerDown, { passive: true });
  win.addEventListener('touchstart', handleTouchStart, { passive: true });
  win.addEventListener('touchend', handleTouchEnd, { passive: true });
  win.addEventListener('touchcancel', handleTouchCancel, { passive: true });
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
      resetProgress();
      touch = null;
      if (spyFrame !== null) cancelFrame(spyFrame);
      win.removeEventListener('wheel', handleWheel);
      win.removeEventListener('keydown', handleKey);
      win.removeEventListener('scroll', handleScroll);
      win.removeEventListener('resize', refresh);
      win.removeEventListener('pointerdown', handlePointerDown);
      win.removeEventListener('touchstart', handleTouchStart);
      win.removeEventListener('touchend', handleTouchEnd);
      win.removeEventListener('touchcancel', handleTouchCancel);
    },
  };
}
