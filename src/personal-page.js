import { cloverSVG } from './scene.js';
import { DEFAULT_OWNER_PROFILE, localizeOwnerText, safeOwnerURL } from './owner-profile.js';
import { createAnonymousComments, normalizeCommentsCopy } from './comments.js';

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
export const PERSONAL_COPY = Object.freeze({
  zh: Object.freeze({ eyebrow: 'ABOUT THE CREATOR.', avatar: '作者头像', links: '在别处找到我', pending: '个人主页链接待补充', journal: '碎碎念', journalNote: '想到什么，就写一点。', journalEmpty: '还没有公开的文章', soon: '准备中', journalMore: '加载更多', journalLoaded: '已显示全部碎碎念', viewImage: '查看图片', closeImage: '关闭图片', imageUnavailable: '图片暂时无法加载' }),
  ja: Object.freeze({ eyebrow: 'ABOUT THE CREATOR.', avatar: '庭の主のアイコン', links: 'ほかの場所でも', pending: 'プロフィールのリンクは準備中です', journal: 'ひとりごと', journalNote: '思いついたことを、少しずつ。', journalEmpty: '公開された記事はまだありません', soon: '準備中', journalMore: 'もっと見る', journalLoaded: 'すべてのひとりごとを表示しました', viewImage: '画像を見る', closeImage: '画像を閉じる', imageUnavailable: '画像を読み込めませんでした' }),
});
const copyDictionary = (input) => Object.fromEntries(['zh', 'ja'].map(locale => [locale,
  Object.fromEntries(Object.entries(PERSONAL_COPY[locale]).map(([key, fallback]) =>
    [key, typeof input?.[locale]?.[key] === 'string' ? input[locale][key] : fallback])),
]));
const JOURNAL_PAGE_SIZE = 6;

function publishedPosts(input) {
  return (Array.isArray(input) ? input : []).filter(post => post?.published === true).map(post => {
    const title = post.title;
    const body = post.body;
    const images = (Array.isArray(post.images) ? post.images : []).flatMap(image => {
      const url = safeOwnerURL(image?.url, 'avatar');
      return url ? [{ url, alt: image.alt }] : [];
    });
    const timestamp = typeof post.createdAt === 'string' ? Date.parse(post.createdAt) : NaN;
    return { id: typeof post.id === 'string' && post.id.trim() ? post.id : null, title, body, images, timestamp: Number.isFinite(timestamp) ? timestamp : 0, dated: Number.isFinite(timestamp) };
  }).filter(post => ['zh', 'ja'].some(locale => localizeOwnerText(post.body, locale).trim()) || post.images.length).sort((a, b) => b.timestamp - a.timestamp);
}
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
  const journalMode = ['hidden', 'placeholder', 'link', 'feed'].includes(data.journal?.mode) ? data.journal.mode : 'placeholder';
  return {
    avatar: safeOwnerURL(data.avatar, 'avatar'),
    name: data.name ?? DEFAULT_OWNER_PROFILE.name,
    bio: data.bio ?? DEFAULT_OWNER_PROFILE.bio,
    contacts, socials,
    journal: { mode: journalMode, url: webURL(data.journal?.url) },
  };
}

/** Published notes and the owner card share one public content boundary. */
export function createPersonalPage({ root, profile = DEFAULT_PERSONAL_PROFILE, language = 'zh', copy, posts = [], commentsService = null, commentsCopy } = {}) {
  if (!root?.ownerDocument) throw new TypeError('A personal page root is required.');
  const doc = root.ownerDocument;
  let data = normalizePersonalProfile(profile);
  let locale = language === 'ja' ? 'ja' : 'zh';
  let dictionary = copyDictionary(copy);
  let entries = publishedPosts(posts);
  let visibleCount = JOURNAL_PAGE_SIZE;
  let closeViewer = () => {};
  let destroyed = false;
  let commentService = commentsService;
  let commentDictionary = normalizeCommentsCopy(commentsCopy);
  const commentSections = new Set();
  const commentDrafts = new Map();
  const openComments = new Set();
  function disposeComments() {
    for (const section of commentSections) {
      if (section.id && section.panel) commentDrafts.set(section.id, section.panel.draft);
      section.unsubscribe(); section.panel?.destroy();
    }
    commentSections.clear();
  }
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

  function createJournalFeed(journal, words) {
    journal.classList.add('has-feed');
    const heading = element('h3', 'personal-journal-heading');
    heading.append(glyph('personal-journal-clover'), element('span', '', words.journal));
    const list = element('div', 'personal-journal-posts');
    const more = element('button', 'personal-journal-more');
    more.type = 'button';
    more.hidden = entries.length <= JOURNAL_PAGE_SIZE;
    journal.append(heading, element('p', 'personal-journal-note', words.journalNote), list, more);

    let dialog = null;
    let opener = null;
    let image = null;
    let errorMessage = null;
    let keyHandler = null;
    let viewerActive = false;
    const clearViewer = () => {
      if (!dialog || !viewerActive) return;
      viewerActive = false;
      doc.body?.classList.remove('modal-open');
      if (keyHandler) doc.removeEventListener('keydown', keyHandler);
      keyHandler = null;
      if (image) image.removeAttribute('src');
      opener?.focus?.({ preventScroll: true });
      opener = null;
    };
    closeViewer = () => {
      if (!dialog) return;
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      clearViewer();
    };
    const openViewer = (picture, button) => {
      if (destroyed) return;
      if (!dialog) {
        dialog = element('dialog', 'personal-image-viewer');
        dialog.setAttribute('aria-label', words.viewImage);
        const close = element('button', 'personal-image-close', '×');
        close.type = 'button'; close.setAttribute('aria-label', words.closeImage);
        image = element('img', 'personal-image-full'); image.decoding = 'async';
        errorMessage = element('p', 'personal-image-error', words.imageUnavailable);
        errorMessage.hidden = true; errorMessage.setAttribute('role', 'status');
        image.addEventListener('error', () => { errorMessage.hidden = false; image.hidden = true; });
        close.addEventListener('click', closeViewer);
        dialog.addEventListener('close', () => { if (!dialog.open) clearViewer(); });
        dialog.addEventListener('click', event => { if (event.target === dialog) closeViewer(); });
        dialog.append(close, image, errorMessage);
        root.append(dialog);
      }
      opener = button;
      viewerActive = true;
      image.hidden = false; errorMessage.hidden = true;
      image.src = picture.url; image.alt = picture.alt;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else {
        dialog.setAttribute('open', '');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        keyHandler = event => { if (event.key === 'Escape') closeViewer(); };
        doc.addEventListener('keydown', keyHandler);
      }
      doc.body?.classList.add('modal-open');
    };
    const createPost = post => {
      const postTitle = localizeOwnerText(post.title, locale);
      const postBody = localizeOwnerText(post.body, locale);
      const article = element('article', 'personal-journal-post');
      if (post.dated) {
        const date = new Date(post.timestamp);
        const time = element('time', 'personal-journal-date', date.toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }));
        time.dateTime = date.toISOString(); article.append(time);
      }
      if (postTitle.trim()) article.append(element('h4', 'personal-journal-title', postTitle));
      if (postBody.trim()) article.append(element('p', 'personal-journal-body', postBody));
      if (post.images.length) {
        const gallery = element('div', 'personal-journal-images');
        for (const source of post.images) {
          const picture = { ...source, alt: localizeOwnerText(source.alt, locale) };
          const button = element('button', 'personal-journal-image-button');
          button.type = 'button'; button.setAttribute('aria-label', picture.alt ? `${words.viewImage} · ${picture.alt}` : words.viewImage);
          const thumbnail = element('img', 'personal-journal-image');
          thumbnail.src = picture.url; thumbnail.alt = picture.alt;
          thumbnail.loading = 'lazy'; thumbnail.decoding = 'async';
          button.append(thumbnail);
          button.addEventListener('click', () => openViewer(picture, button));
          gallery.append(button);
        }
        article.append(gallery);
      }
      const details = element('details', 'personal-post-comments');
      const summary = element('summary', 'personal-post-comments-summary');
      const commentRoot = element('div', 'personal-post-comments-content');
      const section = { id: post.id, panel: null, unsubscribe: () => {} };
      const updateSummary = () => {
        const enabled = Boolean(commentService?.enabled && post.id);
        summary.textContent = commentDictionary[locale][enabled ? 'open' : 'unavailable'];
        summary.setAttribute('aria-disabled', String(!enabled));
      };
      const setService = next => {
        section.unsubscribe(); section.panel?.setService(next);
        section.unsubscribe = typeof next?.subscribe === 'function' ? next.subscribe(updateSummary) : () => {};
        updateSummary();
      };
      section.setService = setService;
      section.updateCopy = () => { updateSummary(); section.panel?.setCopy(commentDictionary); };
      const ensurePanel = () => {
        if (!section.panel) {
          section.panel = createAnonymousComments({ container: commentRoot, service: commentService, targetType: 'note', targetId: post.id, language: locale, copy: commentDictionary });
          if (post.id) section.panel.setDraft(commentDrafts.get(post.id));
        } else section.panel.setActive(true);
      };
      summary.addEventListener('click', event => { if (!details.open && (!commentService?.enabled || !post.id)) event.preventDefault?.(); });
      details.addEventListener('toggle', () => {
        if (details.open) { if (post.id) openComments.add(post.id); ensurePanel(); }
        else { if (post.id) openComments.delete(post.id); section.panel?.setActive(false); }
      });
      details.append(summary, commentRoot); article.append(details); commentSections.add(section); setService(commentService);
      if (post.id && openComments.has(post.id)) { details.open = true; ensurePanel(); }
      return article;
    };
    const appendEntries = () => {
      const end = Math.min(visibleCount, entries.length);
      for (let index = list.children.length; index < end; index++) list.append(createPost(entries[index]));
      more.disabled = end >= entries.length;
      more.textContent = more.disabled ? words.journalLoaded : words.journalMore;
    };
    more.addEventListener('click', () => { visibleCount += JOURNAL_PAGE_SIZE; appendEntries(); });
    appendEntries();
  }

  function render() {
    disposeComments();
    closeViewer(); closeViewer = () => {};
    const copy = dictionary[locale];
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
      if (data.journal.mode !== 'link' && entries.length) createJournalFeed(journal, copy);
      else {
        const entry = element(url ? 'a' : 'button', 'personal-journal-entry');
        if (url) { entry.href = url; entry.target = '_blank'; entry.rel = 'noopener noreferrer'; }
        else { entry.type = 'button'; entry.disabled = true; entry.title = copy.journalEmpty; }
        entry.append(glyph('personal-journal-clover'), element('span', '', copy.journal), element('small', '', url ? '↗' : copy.soon));
        journal.append(entry, element('p', 'personal-journal-note', copy.journalNote));
      }
      shell.append(journal);
    }
    root.classList.add('personal-page'); root.replaceChildren(shell);
  }
  render();
  return {
    setLanguage(next) { if (destroyed) return; locale = next === 'ja' ? 'ja' : 'zh'; render(); },
    setCopy(next) { if (destroyed) return; dictionary = copyDictionary(next); render(); },
    setCommentsService(next) { if (destroyed) return; commentService = next; commentSections.forEach(section => section.setService(next)); },
    setCommentsCopy(next) { if (destroyed) return; commentDictionary = normalizeCommentsCopy(next); commentSections.forEach(section => section.updateCopy()); },
    setPosts(next) { if (destroyed) return; entries = publishedPosts(next); visibleCount = JOURNAL_PAGE_SIZE; render(); },
    update(next) { if (destroyed) return; data = normalizePersonalProfile(next); render(); },
    destroy() { if (destroyed) return; closeViewer(); disposeComments(); commentDrafts.clear(); openComments.clear(); destroyed = true; root.replaceChildren(); root.classList.remove('personal-page'); },
  };
}
