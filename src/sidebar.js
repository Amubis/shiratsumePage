import { cloverSVG, halftoneShadowSVG } from './scene.js';

/** Hit positions depend on the current page, never the hovered label's size. */
export function getSidebarLayout(count, currentIndex, selectedIndex = currentIndex) {
  return Array.from({ length: Math.max(0, count) }, (_, index) => {
    const currentDistance = index - currentIndex;
    const steps = Math.abs(currentDistance);
    const gap = currentDistance > 0 ? 68 : 62;
    const distantGap = currentDistance > 0 ? 26 : 24;
    const y = steps ? Math.sign(currentDistance) * (gap + (steps - 1) * distantGap) : 0;
    const distance = Math.abs(index - selectedIndex);
    const fontSize = distance === 0 ? 27 : distance === 1 ? 15.5 : distance === 2 ? 10.5 : 9.5;
    const opacity = distance === 0 ? 1 : distance === 1 ? 0.57 : distance === 2 ? 0.32 : 0.23;
    return { index, y, fontSize, scale: fontSize / 27, opacity, hitHeight: 24 };
  });
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

  const selectedIndex = () => pointerIndex ?? focusIndex ?? currentIndex;
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
    const layout = getSidebarLayout(rows.length, currentIndex, selected);
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
        if (valid()) schedule(() => spawn(slot), 160);
      };
      node.addEventListener('animationend', finish, { once: true });
      // A hidden tab or missing animation event must not leave a permanent node.
      fallback = schedule(finish, 1500);
    };
    schedule(() => spawn(0), 350);
    schedule(() => spawn(1), 900);
  }

  const enterPointer = (index, event) => {
    if (event.pointerType === 'touch' || !hoverAllowed() || pointerIndex === index) return;
    pointerIndex = index;
    render('hover');
    spin(true);
    startBubbles();
  };
  const leavePointer = () => {
    if (pointerIndex === null) return;
    pointerIndex = null;
    render('leave');
    spin(false);
    startBubbles();
  };
  rows.forEach((row, index) => {
    bind(row, 'pointerenter', (event) => enterPointer(index, event));
    bind(row, 'focus', () => {
      if (modality !== 'keyboard') return;
      focusIndex = index;
      render('focus');
      spin(true);
      startBubbles();
    });
  });
  bind(list, 'pointerleave', leavePointer);
  bind(list, 'focusout', (event) => {
    if (rows.some((row) => row === event.relatedTarget || row.contains?.(event.relatedTarget))) return;
    if (focusIndex === null) return;
    focusIndex = null;
    render('blur');
    if (pointerIndex === null) spin(false);
    startBubbles();
  });
  bind(root, 'pointerdown', () => { modality = 'pointer'; });
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
      spinSerial += 1;
      spinAnimation?.cancel();
      cleanups.splice(0).forEach((cleanup) => cleanup());
    },
  };
}
