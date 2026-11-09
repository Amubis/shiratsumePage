import { cloverSVG } from './scene.js';

/** Replace this one data object with CMS-provided owner information later. */
export const DEFAULT_OWNER_PROFILE = Object.freeze({
  avatar: null,
  name: Object.freeze({ zh: '关于我', ja: 'この庭について' }),
  bio: Object.freeze({ zh: '欢迎来到我的小庭院。', ja: '小さな庭へようこそ。' }),
  contacts: Object.freeze([]),
});

const OWNER_COPY = {
  zh: { contacts: '联系方式', empty: '暂未公开联系方式' },
  ja: { contacts: '連絡先', empty: '連絡先はまだ公開していません' },
};
let ownerProfileSerial = 0;

/** Public build-time data is a fallback when the separately editable JSON is unavailable. */
export function readOwnerProfileData(doc = globalThis.document) {
  try {
    const profile = JSON.parse(doc?.getElementById?.('owner-profile-data')?.textContent || 'null');
    return profile?.schemaVersion === 1 ? profile : null;
  } catch { return null; }
}

export function localizeOwnerText(value, language = 'zh') {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  for (const key of [language, 'zh', 'ja']) {
    if (typeof value[key] === 'string') return value[key];
  }
  return '';
}

/** Avatars allow relative images; contact links require an explicit safe scheme. */
export function safeOwnerURL(value, kind = 'contact') {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || /[\u0000-\u001f\u007f\\]/.test(text)) return null;
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(text);
  if (kind === 'avatar' && !hasScheme) {
    if (/^(\/\/|#|\?)/.test(text)) return null;
    try {
      const url = new URL(text, 'https://owner-profile.invalid/base/');
      return url.origin === 'https://owner-profile.invalid' ? text : null;
    } catch { return null; }
  }
  try {
    const url = new URL(text);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
    if (kind === 'contact' && (url.protocol === 'mailto:' || url.protocol === 'tel:') && url.pathname) return url.href;
  } catch { /* Invalid and executable schemes are omitted rather than rendered. */ }
  return null;
}

/** Non-modal owner disclosure. No persistence or fabricated contact data. */
export function createOwnerProfile({ root, profile = DEFAULT_OWNER_PROFILE, language = 'zh' } = {}) {
  if (!root?.ownerDocument) throw new TypeError('An owner profile root is required.');
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const id = `owner-profile-${++ownerProfileSerial}`;
  const disposers = [];
  let data = profile && typeof profile === 'object' ? profile : DEFAULT_OWNER_PROFILE;
  let locale = language === 'ja' ? 'ja' : 'zh';
  let opened = false;
  let openedBy = null;
  let closeTimer = null;
  let inputMode = 'keyboard';
  let suppressFocusOpen = false;
  let destroyed = false;

  const element = (tag, className) => {
    const node = doc.createElement(tag);
    node.className = className;
    return node;
  };
  const button = element('button', 'owner-avatar');
  button.type = 'button';
  button.setAttribute('aria-controls', `${id}-card`);
  button.setAttribute('aria-expanded', 'false');
  const card = element('section', 'owner-card');
  card.id = `${id}-card`;
  card.setAttribute('aria-labelledby', `${id}-name`);
  card.setAttribute('aria-hidden', 'true');
  card.hidden = true;
  const name = element('h2', 'owner-name');
  name.id = `${id}-name`;
  const bio = element('p', 'owner-bio');
  const contactsHeading = element('h3', 'owner-contacts-heading');
  const contacts = element('ul', 'owner-contacts');
  const empty = element('p', 'owner-empty');
  card.append(name, bio, contactsHeading, contacts, empty);
  root.classList.add('owner-profile');
  root.replaceChildren(button, card);

  const bind = (node, type, handler, options) => {
    node.addEventListener(type, handler, options);
    disposers.push(() => node.removeEventListener(type, handler, options));
  };
  const clearClose = () => {
    if (closeTimer !== null) win.clearTimeout(closeTimer);
    closeTimer = null;
  };
  const close = () => {
    clearClose();
    opened = false;
    openedBy = null;
    button.setAttribute('aria-expanded', 'false');
    card.setAttribute('aria-hidden', 'true');
    card.hidden = true;
    root.classList.remove('is-open');
  };
  const open = (source) => {
    if (destroyed) return;
    clearClose();
    // Focus/hover can precede the first click. That click pins the card open;
    // only another explicit click toggles it closed.
    if (!opened || source === 'click') openedBy = source;
    opened = true;
    button.setAttribute('aria-expanded', 'true');
    card.setAttribute('aria-hidden', 'false');
    card.hidden = false;
    root.classList.add('is-open');
  };
  const scheduleClose = () => {
    clearClose();
    closeTimer = win.setTimeout(() => {
      closeTimer = null;
      if (inputMode === 'keyboard' && root.contains(doc.activeElement)) return;
      close();
    }, 150);
  };
  const fallbackAvatar = () => {
    const glyph = element('span', 'owner-avatar-fallback');
    glyph.setAttribute('aria-hidden', 'true');
    glyph.innerHTML = cloverSVG({ className: 'clover-svg', variant: 'small' });
    return glyph;
  };

  function render() {
    const title = localizeOwnerText(data.name, locale) || localizeOwnerText(DEFAULT_OWNER_PROFILE.name, locale);
    name.textContent = title;
    bio.textContent = localizeOwnerText(data.bio ?? DEFAULT_OWNER_PROFILE.bio, locale);
    bio.hidden = !bio.textContent;
    button.setAttribute('aria-label', title);
    button.title = title;
    const avatarURL = safeOwnerURL(data.avatar, 'avatar');
    if (avatarURL) {
      const image = element('img', 'owner-avatar-image');
      image.alt = '';
      image.decoding = 'async';
      image.draggable = false;
      image.src = avatarURL;
      image.addEventListener('error', () => {
        if (!destroyed && button.contains(image)) button.replaceChildren(fallbackAvatar());
      }, { once: true });
      button.replaceChildren(image);
    } else button.replaceChildren(fallbackAvatar());
    contactsHeading.textContent = OWNER_COPY[locale].contacts;
    empty.textContent = OWNER_COPY[locale].empty;
    const items = [];
    for (const contact of Array.isArray(data.contacts) ? data.contacts : []) {
      if (!contact || typeof contact !== 'object') continue;
      const url = safeOwnerURL(contact.url, 'contact');
      if (!url) continue;
      const item = element('li', 'owner-contact');
      const link = element('a', 'owner-contact-link');
      link.href = url;
      link.textContent = localizeOwnerText(contact.label, locale) || url;
      if (/^https?:/i.test(url)) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
      item.append(link);
      items.push(item);
    }
    contacts.replaceChildren(...items);
    contacts.hidden = items.length === 0;
    empty.hidden = items.length > 0;
  }

  bind(button, 'pointerenter', (event) => {
    if (event.pointerType !== 'touch') open('hover');
  });
  bind(root, 'pointerenter', clearClose);
  bind(root, 'pointerleave', (event) => {
    if (event.pointerType !== 'touch') scheduleClose();
  });
  bind(root, 'focusin', () => {
    if (!suppressFocusOpen) open('focus');
  });
  bind(root, 'focusout', (event) => {
    if (!root.contains(event.relatedTarget)) scheduleClose();
  });
  bind(button, 'click', () => {
    if (opened && openedBy === 'click') close();
    else open('click');
  });
  bind(doc, 'pointerdown', () => { inputMode = 'pointer'; }, { passive: true });
  bind(doc, 'click', (event) => {
    if (!root.contains(event.target)) close();
  });
  bind(doc, 'keydown', (event) => {
    inputMode = 'keyboard';
    if (event.key !== 'Escape' || !opened) return;
    const restoreFocus = card.contains(doc.activeElement);
    close();
    if (restoreFocus) {
      suppressFocusOpen = true;
      try { button.focus({ preventScroll: true }); }
      finally { suppressFocusOpen = false; }
    }
  });
  render();

  return {
    setLanguage(nextLanguage) {
      if (destroyed) return;
      locale = nextLanguage === 'ja' ? 'ja' : 'zh';
      render();
    },
    update(nextProfile) {
      if (destroyed) return;
      data = nextProfile && typeof nextProfile === 'object' ? nextProfile : DEFAULT_OWNER_PROFILE;
      render();
    },
    close,
    destroy() {
      if (destroyed) return;
      close();
      destroyed = true;
      disposers.splice(0).forEach((dispose) => dispose());
    },
  };
}
