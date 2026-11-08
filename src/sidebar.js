import { cloverSVG, halftoneShadowSVG } from './scene.js';

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const offsetFromFocus = (distance) => {
  const steps = Math.abs(distance);
  const gap = distance > 0 ? 68 : 62;
  const distantGap = distance > 0 ? 26 : 24;
  return Math.sign(distance) * (Math.min(1, steps) * gap + Math.max(0, steps - 1) * distantGap);
};
const interpolateFalloff = (distance, values) => {
  const position = clamp(distance, 0, values.length - 1);
  const lower = Math.floor(position);
  const fraction = position - lower;
  return values[lower] + ((values[lower + 1] ?? values[lower]) - values[lower]) * fraction;
};

/** Size and spacing share one visual focus; aria-current is managed separately. */
export function getSidebarLayout(count, currentIndex, selectedIndex = currentIndex, { focusPosition = selectedIndex, anchors, range } = {}) {
  count = Math.max(0, count);
  const selected = clamp(Math.round(selectedIndex), 0, count - 1);
  const focus = clamp(focusPosition, 0, count - 1);
  let anchor = anchors?.[selected] ?? offsetFromFocus(selected - currentIndex);
  const focusedOffset = offsetFromFocus(selected - focus);
  const offsets = Array.from({ length: count }, (_, index) => offsetFromFocus(index - focus) - focusedOffset);
  if (range && offsets.length) {
    // Asymmetric near gaps must not accumulate into off-panel drift when a
    // visitor repeatedly moves between the same two painted labels.
    const lower = range.min - Math.min(...offsets);
    const upper = range.max - Math.max(...offsets);
    anchor = lower <= upper ? clamp(anchor, lower, upper) : (lower + upper) / 2;
  }
  return Array.from({ length: count }, (_, index) => {
    const y = anchor + offsets[index];
    const distance = Math.abs(index - focus);
    const fontSize = index === selected ? 27 : interpolateFalloff(distance, [27, 15.5, 10.5, 9.5]);
    const opacity = index === selected ? 1 : interpolateFalloff(distance, [1, .85, .68, .55]);
    return { index, y, fontSize, scale: fontSize / 27, opacity, hitHeight: 24 };
  });
}

/** Fractional proximity between the currently painted label centers. */
export function getSidebarPointerPosition(y, anchors) {
  if (anchors.length < 2 || y <= anchors[0]) return 0;
  const last = anchors.length - 1;
  if (y >= anchors[last]) return last;
  const upper = anchors.findIndex((anchor) => anchor >= y);
  const lower = upper - 1;
  return lower + (y - anchors[lower]) / (anchors[upper] - anchors[lower]);
}

export function getSidebarPointerIndex(y, anchors, previousIndex = null, hysteresis = 7) {
  if (!anchors.length) return -1;
  if (Number.isInteger(previousIndex) && previousIndex >= 0 && previousIndex < anchors.length) {
    const lowerGap = anchors[previousIndex] - anchors[previousIndex - 1];
    const upperGap = anchors[previousIndex + 1] - anchors[previousIndex];
    const lower = previousIndex ? (anchors[previousIndex - 1] + anchors[previousIndex]) / 2 - Math.min(hysteresis, lowerGap / 4) : -Infinity;
    const upper = previousIndex < anchors.length - 1 ? (anchors[previousIndex] + anchors[previousIndex + 1]) / 2 + Math.min(hysteresis, upperGap / 4) : Infinity;
    if (y >= lower && y <= upper) return previousIndex;
  }
  return Math.round(getSidebarPointerPosition(y, anchors));
}

/** Read the visible pose before cancelling a running Web Animation. */
export function getTransformPose(transform = '') {
  const matrix = String(transform).match(/^matrix(3d)?\(([^)]+)\)$/);
  if (matrix) {
    const values = matrix[2].split(',').map(Number);
    const a = values[0];
    const b = values[1];
    if (Number.isFinite(a) && Number.isFinite(b)) {
      return { rotation: Math.atan2(b, a) * 180 / Math.PI, scale: Math.hypot(a, b) || 1 };
    }
  }
  return {
    rotation: Number(String(transform).match(/rotate\((-?[\d.]+)deg\)/)?.[1]) || 0,
    scale: Number(String(transform).match(/scale\(([\d.]+)\)/)?.[1]) || 1,
  };
}

/**
 * Manage sidebar presentation only; existing links retain their click behavior.
 * onSelect(index, { source }) reports visual hover/focus/current selection.
 */
export function createSidebar({ root, links, highlight, bubbles, reducedMotion = () => false, onSelect } = {}) {
  if (!root) throw new TypeError('A sidebar root is required.');
  const rows = Array.from(links || root.querySelectorAll('.side-links>a'));
  if (!rows.length) throw new TypeError('The sidebar needs at least one link.');
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const list = rows[0].parentElement;
  highlight ||= root.querySelector('.side-highlight');
  bubbles ||= root.querySelector('.nav-bubbles');
  if (!highlight || !bubbles) throw new TypeError('Sidebar highlight and bubble layers are required.');
  const shape = highlight.querySelector('.side-highlight-spin') || highlight;
  shape.innerHTML = halftoneShadowSVG({ id: 'sidebar-clover-shadow' });
  const timers = new Set();
  const slotNodes = [null, null];
  const cleanups = [];
  let currentIndex = Math.max(0, rows.findIndex((row) => row.getAttribute('aria-current') === 'page'));
  let pointerIndex = null;
  let focusIndex = null;
  let modality = 'keyboard';
  let lastSelected = null;
  let spinAnimation = null;
  let spinSerial = 0;
  let bubbleSerial = 0;
  let destroyed = false;
  let bubbleAnchor = { x: 130, y: 0 };
  let lastLayout = null;
  let pointerAnchors = null;
  let pointerPosition = null;
  let pointerFrame = null;
  let pendingPointer = null;
  let forwardingClick = false;
  let touchPointer = false;
  let lastPointerY = null;

  const selectedIndex = () => modality === 'keyboard' && focusIndex !== null ? focusIndex : pointerIndex ?? focusIndex ?? currentIndex;
  const hoverAllowed = () => win.matchMedia?.('(hover: hover)').matches ?? true;
  const bind = (node, type, handler, options) => {
    node.addEventListener(type, handler, options);
    cleanups.push(() => node.removeEventListener(type, handler, options));
  };
  const schedule = (callback, delay) => {
    const timer = win.setTimeout(() => { timers.delete(timer); callback(); }, delay);
    timers.add(timer);
    return timer;
  };
  const clearTimer = (timer) => {
    win.clearTimeout(timer);
    timers.delete(timer);
  };
  const stopBubbles = () => {
    bubbleSerial += 1;
    timers.forEach((timer) => win.clearTimeout(timer));
    timers.clear();
    slotNodes.forEach((node, slot) => { node?.remove(); slotNodes[slot] = null; });
  };

  function render(source) {
    if (destroyed) return;
    const selected = selectedIndex();
    const panelHeight = list.getBoundingClientRect().height;
    const layout = getSidebarLayout(rows.length, currentIndex, selected, {
      focusPosition: pointerIndex !== null && modality === 'pointer' ? pointerPosition ?? selected : selected,
      anchors: pointerIndex !== null && modality === 'pointer' ? pointerAnchors : undefined,
      range: panelHeight > 36 ? { min: -panelHeight / 2 + 18, max: panelHeight / 2 - 18 } : undefined,
    });
    lastLayout = layout;
    rows.forEach((row, index) => {
      const item = layout[index];
      row.style.setProperty('--nav-y', `${item.y}px`);
      row.style.setProperty('--nav-font-size', `${item.fontSize}px`);
      row.style.setProperty('--nav-scale', String(item.scale));
      row.style.setProperty('--nav-opacity', String(item.opacity));
      row.classList.toggle('is-highlighted', index === selected);
      if (index === currentIndex) row.setAttribute('aria-current', 'page');
      else row.removeAttribute('aria-current');
    });
    const label = rows[selected].querySelector('span') || rows[selected];
    const labelRect = label.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    const computedFont = parseFloat(win.getComputedStyle(label).fontSize) || layout[selected].fontSize;
    // CSS font transitions can still be at their starting size during this read.
    const targetWidth = labelRect.width ? labelRect.width * layout[selected].fontSize / computedFont
      : Math.max(1, label.textContent.trim().length) * layout[selected].fontSize;
    const labelLeft = labelRect.left - listRect.left;
    const center = labelLeft + targetWidth / 2;
    const size = Math.max(105, Math.min(115, targetWidth + 12));
    highlight.style.setProperty('--highlight-y', `${layout[selected].y}px`);
    highlight.style.setProperty('--highlight-x', `${center}px`);
    highlight.style.setProperty('--highlight-size', `${size}px`);
    bubbleAnchor = { x: labelLeft + targetWidth + 12, y: layout[selected].y };
    const mobileLabel = root.querySelector('#mobile-current');
    if (mobileLabel) mobileLabel.textContent = rows[currentIndex].textContent.trim();
    if (selected !== lastSelected) {
      lastSelected = selected;
      onSelect?.(selected, { source });
    }
  }

  function spin(entering) {
    const pose = getTransformPose(win.getComputedStyle(shape).transform);
    const serial = ++spinSerial;
    spinAnimation?.cancel();
    spinAnimation = null;
    shape.style.transform = `rotate(${pose.rotation}deg) scale(${pose.scale})`;
    if (reducedMotion() || !shape.animate) {
      shape.style.transform = `rotate(${pose.rotation}deg) scale(1)`;
      return;
    }
    const direction = entering ? -1 : 1;
    const end = pose.rotation + direction * 360;
    const animation = shape.animate([
      { transform: `rotate(${pose.rotation}deg) scale(${pose.scale})` },
      { transform: `rotate(${pose.rotation + direction * 180}deg) scale(1.06)`, offset: 0.5 },
      { transform: `rotate(${end}deg) scale(1)` },
    ], { duration: 450, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
    spinAnimation = animation;
    animation.finished.then(() => {
      if (destroyed || serial !== spinSerial) return;
      shape.style.transform = `rotate(${end % 360}deg) scale(1)`;
      animation.cancel();
      spinAnimation = null;
    }).catch(() => {});
  }

  function roll(previous, selected) {
    const pose = getTransformPose(win.getComputedStyle(shape).transform);
    const serial = ++spinSerial;
    spinAnimation?.cancel();
    spinAnimation = null;
    // One visible turn per target change, independent of skipped label count.
    // Read the in-flight pose above so rapid reversals never snap or queue spins.
    const turn = Math.sign(selected - previous) * 360;
    const end = pose.rotation + turn;
    shape.style.transform = `rotate(${pose.rotation}deg) scale(${pose.scale})`;
    if (reducedMotion() || !shape.animate) {
      shape.style.transform = `rotate(${pose.rotation}deg) scale(1)`;
      return;
    }
    const animation = shape.animate([
      { transform: `rotate(${pose.rotation}deg) scale(${pose.scale})` },
      { transform: `rotate(${end + Math.sign(turn) * 10}deg) scale(1.065)`, offset: .68 },
      { transform: `rotate(${end - Math.sign(turn) * 2}deg) scale(.995)`, offset: .86 },
      { transform: `rotate(${end}deg) scale(1)` },
    ], { duration: 520, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
    spinAnimation = animation;
    animation.finished.then(() => {
      if (destroyed || serial !== spinSerial) return;
      shape.style.transform = `rotate(${end % 360}deg) scale(1)`;
      animation.cancel();
      spinAnimation = null;
    }).catch(() => {});
  }

  function startBubbles() {
    stopBubbles();
    if (destroyed || reducedMotion() || !hoverAllowed() || doc.hidden
      || (pointerIndex === null && focusIndex === null)) return;
    const serial = bubbleSerial;
    // Snapshot the start positions once per selection, not once per child count.
    const anchor = { ...bubbleAnchor };
    const valid = () => !destroyed && serial === bubbleSerial && !doc.hidden && !reducedMotion();
    const spawn = (slot) => {
      if (!valid() || slotNodes[slot]) return;
      const node = doc.createElement('span');
      node.className = 'nav-bubble';
      node.dataset.slot = String(slot);
      node.setAttribute('aria-hidden', 'true');
      node.style.setProperty('--bubble-x', `${anchor.x + slot * 17}px`);
      node.style.setProperty('--bubble-y', `${anchor.y + (slot ? 6 : -6)}px`);
      node.style.setProperty('--bubble-size', `${slot ? 12 : 17}px`);
      node.innerHTML = cloverSVG({ className: 'clover-svg', variant: 'small' });
      slotNodes[slot] = node;
      bubbles.append(node);
      let fallback;
      const finish = () => {
        if (slotNodes[slot] !== node) return;
        clearTimer(fallback);
        node.remove();
        slotNodes[slot] = null;
        if (valid()) schedule(() => spawn(slot), 1200);
      };
      node.addEventListener('animationend', finish, { once: true });
      // A hidden tab or missing animation event must not leave a permanent node.
      fallback = schedule(finish, 3400);
    };
    schedule(() => spawn(0), 500);
    schedule(() => spawn(1), 1400);
  }

  const paintedLabels = () => {
    const bounds = list.getBoundingClientRect();
    const center = bounds.top + bounds.height / 2;
    const rects = rows.map((row) => (row.querySelector('span') || row).getBoundingClientRect());
    const anchors = rects.map((rect, index) => Number.isFinite(rect.top) && rect.height > 0
      ? rect.top + rect.height / 2 - center : lastLayout[index].y);
    return { center, rects, anchors };
  };
  const enterPointer = (index, event) => {
    if (event.pointerType === 'touch' || !hoverAllowed()) return;
    const previous = pointerIndex;
    if (!pointerAnchors || previous !== index) pointerAnchors = paintedLabels().anchors;
    touchPointer = false;
    modality = 'pointer';
    pointerIndex = index;
    pointerPosition = index;
    list.classList.toggle('is-pointer-tracking', true);
    render('hover');
    if (previous === null) spin(true);
    else if (previous !== index) roll(previous, index);
    if (previous !== index) startBubbles();
  };
  const leavePointer = () => {
    if (pointerIndex === null) return;
    pointerIndex = null;
    pointerAnchors = null;
    pointerPosition = null;
    lastPointerY = null;
    pendingPointer = null;
    if (pointerFrame !== null) win.cancelAnimationFrame?.(pointerFrame);
    pointerFrame = null;
    list.classList.toggle('is-pointer-tracking', false);
    render('leave');
    spin(false);
    startBubbles();
  };
  const paintPointer = (event, { force = false } = {}) => {
    if (destroyed || event.pointerType === 'touch' || !hoverAllowed() || !Number.isFinite(event.clientY)) return;
    // CSS can move a label under a stationary cursor. Only real vertical input
    // or an explicit click is allowed to reconsider the latched selection.
    if (!force && pointerIndex !== null && modality === 'pointer' && lastPointerY !== null
      && Math.abs(event.clientY - lastPointerY) < .5) return;
    lastPointerY = event.clientY;
    touchPointer = false;
    const { center, rects, anchors } = paintedLabels();
    const y = event.clientY - center;
    const previous = pointerIndex;
    let index = getSidebarPointerIndex(y, anchors, previous);
    // A visible neighboring label is an unambiguous target, even near a
    // magnetic boundary. Prefer the nearest actual glyph box over its old slot.
    const direct = rects.map((rect, item) => ({ rect, item }))
      .filter(({ rect }) => event.clientY >= rect.top - 2 && event.clientY <= rect.top + rect.height + 2)
      .sort((a, b) => Math.abs(anchors[a.item] - y) - Math.abs(anchors[b.item] - y))[0]?.item;
    if (direct !== undefined && (previous === null || Math.abs(anchors[direct] - y) < Math.abs(anchors[previous] - y))) index = direct;
    if (!pointerAnchors || previous !== index) pointerAnchors = anchors;
    modality = 'pointer';
    pointerIndex = index;
    // Keep the continuous water-like response subtle around a firm item snap.
    pointerPosition = previous === index
      ? index + clamp(getSidebarPointerPosition(y, anchors) - index, -.12, .12) : index;
    list.classList.toggle('is-pointer-tracking', true);
    render('hover');
    if (previous === null) spin(true);
    else if (previous !== index) roll(previous, index);
    if (previous !== index) startBubbles();
  };
  const queuePointer = (event) => {
    if (!win.requestAnimationFrame) { paintPointer(event); return; }
    pendingPointer = { clientY: event.clientY, pointerType: event.pointerType };
    if (pointerFrame !== null) return;
    pointerFrame = win.requestAnimationFrame(() => {
      pointerFrame = null;
      const next = pendingPointer;
      pendingPointer = null;
      if (next) paintPointer(next);
    });
  };
  rows.forEach((row, index) => {
    // Pointer events caused by the moving row bounds cannot change selection.
    // The fallback supports hover implementations without pointer coordinates.
    bind(row, 'pointerenter', (event) => { if (!Number.isFinite(event.clientY)) enterPointer(index, event); });
    bind(row, 'focus', () => {
      if (modality !== 'keyboard') return;
      focusIndex = index;
      render('focus');
      spin(true);
      startBubbles();
    });
  });
  bind(list, 'pointerenter', paintPointer);
  bind(list, 'pointermove', queuePointer);
  bind(list, 'pointerleave', leavePointer);
  bind(list, 'click', (event) => {
    if (forwardingClick || event.detail === 0 || event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
      || touchPointer || event.pointerType === 'touch' || !hoverAllowed()) return;
    if (pointerFrame !== null) win.cancelAnimationFrame?.(pointerFrame);
    pointerFrame = null;
    const latest = Number.isFinite(event.clientY) ? event : pendingPointer;
    pendingPointer = null;
    if (latest) paintPointer(latest, { force: true });
    if (pointerIndex === null || !rows[selectedIndex()].click) return;
    // The panel owns pointer hit testing. Forward to the same logical link that
    // owns the clover, even while its visual label is springing to its new gap.
    event.preventDefault();
    event.stopPropagation();
    forwardingClick = true;
    try { rows[selectedIndex()].click(); } finally { forwardingClick = false; }
  }, { capture: true });
  bind(list, 'focusout', (event) => {
    if (rows.some((row) => row === event.relatedTarget || row.contains?.(event.relatedTarget))) return;
    if (focusIndex === null) return;
    focusIndex = null;
    render('blur');
    if (pointerIndex === null) spin(false);
    startBubbles();
  });
  bind(root, 'pointerdown', (event) => {
    modality = 'pointer';
    if (event.pointerType === 'touch') {
      touchPointer = true;
      focusIndex = null;
      leavePointer();
    }
  });
  bind(doc, 'keydown', () => { modality = 'keyboard'; });
  bind(doc, 'visibilitychange', () => {
    if (doc.hidden) stopBubbles();
    else startBubbles();
  });

  function refresh() {
    if (destroyed) return;
    render('refresh');
    if (reducedMotion()) {
      spinSerial += 1;
      spinAnimation?.cancel();
      spinAnimation = null;
    }
    startBubbles();
  }
  bind(win, 'resize', refresh, { passive: true });
  render('init');

  return {
    setCurrent(index) {
      if (destroyed || !Number.isInteger(index) || index < 0 || index >= rows.length) return false;
      const changed = currentIndex !== index;
      currentIndex = index;
      if (changed) {
        pointerIndex = null;
        focusIndex = null;
        pointerAnchors = null;
        pointerPosition = null;
        lastPointerY = null;
        pendingPointer = null;
        if (pointerFrame !== null) win.cancelAnimationFrame?.(pointerFrame);
        pointerFrame = null;
        list.classList.toggle('is-pointer-tracking', false);
        stopBubbles();
      }
      render('current');
      return true;
    },
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopBubbles();
      if (pointerFrame !== null) win.cancelAnimationFrame?.(pointerFrame);
      list.classList.toggle('is-pointer-tracking', false);
      spinSerial += 1;
      spinAnimation?.cancel();
      cleanups.splice(0).forEach((cleanup) => cleanup());
    },
  };
}
