import { cloverSVG } from './scene.js';
import { DEFAULT_OWNER_PROFILE, localizeOwnerText, safeOwnerURL } from './owner-profile.js';

export const PERSONAL_PLATFORMS = Object.freeze([
  Object.freeze({ id: 'xiaohongshu', label: Object.freeze({ zh: '小红书', ja: 'RED / 小紅書' }), icon: './assets/icons/xiaohongshu.svg' }),
  Object.freeze({ id: 'x', label: 'X / Twitter', icon: './assets/icons/x.svg' }),
  Object.freeze({ id: 'vrchat', label: 'VRChat', icon: './assets/icons/vrchat.svg' }),
  Object.freeze({ id: 'pixiv', label: 'pixiv', icon: './assets/icons/pixiv.svg' }),
]);
export const DEFAULT_PERSONAL_PROFILE = Object.freeze({
  ...DEFAULT_OWNER_PROFILE,
  socials: Object.freeze({ xiaohongshu: null, x: null, vrchat: null, pixiv: null }),
  journal: Object.freeze({ mode: 'placeholder', url: null }),
});
const COPY = {
  zh: { eyebrow: 'THE PERSON BEHIND THIS LITTLE GARDEN.', avatar: '作者头像', links: '在别处找到我', pending: '个人主页链接待补充', journal: '碎碎念', journalNote: '想到什么，就写一点。', journalEmpty: '还没有公开的文章', soon: '准备中' },
  ja: { eyebrow: 'THE PERSON BEHIND THIS LITTLE GARDEN.', avatar: '庭の主のアイコン', links: 'ほかの場所でも', pending: 'プロフィールのリンクは準備中です', journal: 'ひとりごと', journalNote: '思いついたことを、少しずつ。', journalEmpty: '公開された記事はまだありません', soon: '準備中' },
};
const webURL = (value) => {
  const url = safeOwnerURL(value);
  return url && /^https?:/i.test(url) ? url : null;
};

/** One content boundary feeds both the header disclosure and the final page. */
export function normalizePersonalProfile(input = DEFAULT_PERSONAL_PROFILE) {
  const data = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const socials = Object.fromEntries(PERSONAL_PLATFORMS.map(platform => [platform.id, webURL(data.socials?.[platform.id])]));
  const contacts = (Array.isArray(data.contacts) ? data.contacts : []).filter(contact => contact && safeOwnerURL(contact.url)).map(contact => ({ label: contact.label, url: safeOwnerURL(contact.url) }));
  for (const platform of PERSONAL_PLATFORMS) {
    if (socials[platform.id] && !contacts.some(contact => contact.url === socials[platform.id])) contacts.push({ label: platform.label, url: socials[platform.id] });
  }
  const journalMode = ['hidden', 'placeholder', 'link'].includes(data.journal?.mode) ? data.journal.mode : 'placeholder';
  return {
    avatar: safeOwnerURL(data.avatar, 'avatar'),
    name: data.name ?? DEFAULT_OWNER_PROFILE.name,
    bio: data.bio ?? DEFAULT_OWNER_PROFILE.bio,
    contacts, socials,
    journal: { mode: journalMode, url: webURL(data.journal?.url) },
  };
}

/** Read-only owner card; an authenticated CMS can later replace the JSON input. */
export function createPersonalPage({ root, profile = DEFAULT_PERSONAL_PROFILE, language = 'zh' } = {}) {
  if (!root?.ownerDocument) throw new TypeError('A personal page root is required.');
  const doc = root.ownerDocument;
  let data = normalizePersonalProfile(profile);
  let locale = language === 'ja' ? 'ja' : 'zh';
  let destroyed = false;
  const element = (tag, className, text) => {
    const node = doc.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const glyph = (className) => {
    const node = element('span', className); node.setAttribute('aria-hidden', 'true');
    node.innerHTML = cloverSVG({ className: 'clover-svg', variant: 'small' });
    return node;
  };
  function render() {
    const copy = COPY[locale];
    const shell = element('div', 'personal-card');
    const eyebrow = element('p', 'personal-eyebrow personal-reveal', copy.eyebrow);
    const avatarWrap = element('div', 'personal-avatar-wrap personal-reveal');
    const avatar = element('div', 'personal-avatar');
    const fallback = () => avatar.replaceChildren(glyph('personal-avatar-fallback'));
    if (data.avatar) {
      const image = element('img', 'personal-avatar-image'); image.src = data.avatar;
      image.alt = copy.avatar; image.width = 192; image.height = 192; image.decoding = 'async';
      image.addEventListener('error', () => { if (!destroyed && avatar.contains(image)) fallback(); }, { once: true });
      avatar.append(image);
    } else { avatar.setAttribute('role', 'img'); avatar.setAttribute('aria-label', copy.avatar); fallback(); }
    avatarWrap.append(glyph('personal-avatar-clover'), avatar, glyph('personal-avatar-sprout'));
    const name = element('h2', 'personal-name personal-reveal', localizeOwnerText(data.name, locale) || localizeOwnerText(DEFAULT_OWNER_PROFILE.name, locale));
    name.id = 'personal-heading';
    const bio = element('p', 'personal-bio personal-reveal', localizeOwnerText(data.bio, locale)); bio.hidden = !bio.textContent;
    const links = element('div', 'personal-socials personal-reveal'); links.setAttribute('role', 'group'); links.setAttribute('aria-label', copy.links);
    for (const platform of PERSONAL_PLATFORMS) {
      const url = data.socials[platform.id];
      const label = localizeOwnerText(platform.label, locale);
      const link = element(url ? 'a' : 'button', `personal-social${url ? '' : ' is-pending'}`);
      if (url) { link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
      else { link.type = 'button'; link.disabled = true; link.title = copy.pending; }
      link.setAttribute('aria-label', url ? label : `${label} · ${copy.pending}`);
      const icon = element('span', `personal-social-icon icon-${platform.id}`); icon.setAttribute('aria-hidden', 'true');
      icon.style.setProperty('--platform-icon', `url("${platform.icon}")`);
      const text = element('span', 'personal-social-label', label);
      link.append(icon, text); links.append(link);
    }
    shell.append(eyebrow, avatarWrap, name, bio, links);
    if (data.journal.mode !== 'hidden') {
      const url = data.journal.mode === 'link' ? data.journal.url : null;
      const journal = element('aside', 'personal-journal personal-reveal'); journal.setAttribute('aria-label', copy.journal);
      const entry = element(url ? 'a' : 'button', 'personal-journal-entry');
      if (url) { entry.href = url; entry.target = '_blank'; entry.rel = 'noopener noreferrer'; }
      else { entry.type = 'button'; entry.disabled = true; entry.title = copy.journalEmpty; }
      entry.append(glyph('personal-journal-clover'), element('span', '', copy.journal), element('small', '', url ? '↗' : copy.soon));
      journal.append(entry, element('p', 'personal-journal-note', copy.journalNote)); shell.append(journal);
    }
    root.classList.add('personal-page'); root.replaceChildren(shell);
  }
  render();
  return {
    setLanguage(next) { if (destroyed) return; locale = next === 'ja' ? 'ja' : 'zh'; render(); },
    update(next) { if (destroyed) return; data = normalizePersonalProfile(next); render(); },
    destroy() { if (destroyed) return; destroyed = true; root.replaceChildren(); root.classList.remove('personal-page'); },
  };
}
