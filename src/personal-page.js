import { cloverSVG } from './scene.js';
import { DEFAULT_OWNER_PROFILE, localizeOwnerText, safeOwnerURL } from './owner-profile.js';
import { createAnonymousComments, normalizeCommentsCopy } from './comments.js';
import { createJournalViewer } from './journal-viewer.js';

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
  zh: Object.freeze({ eyebrow: 'ABOUT THE CREATOR.', avatar: '作者头像', links: '在别处找到我', pending: '个人主页链接待补充', journal: '碎碎念', journalNote: '想到什么，就写一点。', journalEmpty: '还没有公开的文章', soon: '准备中', journalMore: '加载更多', journalLoaded: '已显示全部碎碎念', journalPagination: '碎碎念分页', journalPrevious: '上一页', journalNext: '下一页', journalPage: '第 {page} 页，共 {pages} 页', viewImage: '查看图片', closeImage: '关闭图片', viewPost: '查看碎碎念', closePost: '关闭碎碎念', previousPost: '上一条碎碎念', nextPost: '下一条碎碎念', previousImage: '上一张图片', nextImage: '下一张图片', imageUnavailable: '图片暂时无法加载' }),
  ja: Object.freeze({ eyebrow: 'ABOUT THE CREATOR.', avatar: '庭の主のアイコン', links: 'ほかの場所でも', pending: 'プロフィールのリンクは準備中です', journal: 'ひとりごと', journalNote: '思いついたことを、少しずつ。', journalEmpty: '公開された記事はまだありません', soon: '準備中', journalMore: 'もっと見る', journalLoaded: 'すべてのひとりごとを表示しました', journalPagination: 'ひとりごとのページ', journalPrevious: '前のページ', journalNext: '次のページ', journalPage: '{page}ページ、全{pages}ページ', viewImage: '画像を見る', closeImage: '画像を閉じる', viewPost: 'ひとりごとを開く', closePost: 'ひとりごとを閉じる', previousPost: '前のひとりごと', nextPost: '次のひとりごと', previousImage: '前の画像', nextImage: '次の画像', imageUnavailable: '画像を読み込めませんでした' }),
});
const copyDictionary = (input) => Object.fromEntries(['zh', 'ja'].map(locale => [locale,
  Object.fromEntries(Object.entries(PERSONAL_COPY[locale]).map(([key, fallback]) =>
    [key, typeof input?.[locale]?.[key] === 'string' ? input[locale][key] : fallback])),
]));
const JOURNAL_PAGE_SIZE = 5;
let journalSerial = 0;

function journalPageItems(page, total) {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, null, total];
  if (page >= total - 3) return [1, null, total - 4, total - 3, total - 2, total - 1, total];
  return [1, null, page - 1, page, page + 1, null, total];
}

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
  let pageIndex = 0;
  let cancelPageMotion = () => {};
  let returnToPost = () => null;
  let destroyed = false;
  let commentService = commentsService;
  let commentDictionary = normalizeCommentsCopy(commentsCopy);
  const commentSections = new Set();
  const commentDrafts = new Map();
  const expandedComments = new Set();
  const commentReplies = new Map();
  function disposeComment(section) {
    if (section.id && section.panel) {
      commentDrafts.set(section.id, section.panel.draft);
      commentReplies.set(section.id, section.panel.replyExpansion || []);
      if (section.panel.expanded) expandedComments.add(section.id); else expandedComments.delete(section.id);
    }
    section.panel?.destroy();
  }
  function disposeComments() {
    for (const section of commentSections) disposeComment(section);
    commentSections.clear();
  }
  const element = (tag, className, text) => {
    const node = doc.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const languageText = (tag, className, text) => {
    const node = element(tag, className, text); node.setAttribute('data-language-text', ''); return node;
  };
  const glyph = (className) => {
    const node = element('span', className); node.setAttribute('aria-hidden', 'true');
    node.innerHTML = cloverSVG({ className: 'clover-svg', variant: 'small' });
    return node;
  };

  function findSection(post) {
    return [...commentSections].find(section => post.id ? section.id === post.id : section.post === post) || null;
  }
  function getSection(post) {
    let section = findSection(post);
    if (!section) {
      const commentRoot = element('div', 'personal-post-comments-content');
      const panel = createAnonymousComments({ container: commentRoot, service: commentService, targetType: 'note', targetId: post.id, language: locale, copy: commentDictionary, previewLimit: 3, compact: true, onOpenThread: () => viewer.open(post) });
      if (post.id) { panel.setDraft(commentDrafts.get(post.id)); panel.setExpanded(expandedComments.has(post.id)); panel.setReplyExpansion?.(commentReplies.get(post.id) || []); }
      section = { id: post.id, post, root: commentRoot, panel, host: null, locale, setService: next => panel.setService(next), updateCopy: () => panel.setCopy(commentDictionary) };
      commentSections.add(section);
    }
    section.post = post;
    section.panel.setOpenThreadHandler?.(() => viewer.open(post));
    if (section.locale !== locale) { section.panel.setLanguage(locale); section.locale = locale; }
    return section;
  }
  function createPost(post, { detail = false } = {}) {
    const words = dictionary[locale], postTitle = localizeOwnerText(post.title, locale), postBody = localizeOwnerText(post.body, locale);
    const article = element('article', `personal-journal-post${detail ? ' journal-detail-post' : ''}`);
    article.setAttribute('data-journal-id', post.id || '');
    if (post.dated) {
      const date = new Date(post.timestamp);
      const time = languageText('time', 'personal-journal-date', date.toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }));
      time.dateTime = date.toISOString(); article.append(time);
    }
    if (postTitle.trim()) {
      const title = element('h4', 'personal-journal-title');
      if (detail) { title.setAttribute('data-language-text', ''); title.textContent = postTitle; }
      else {
        const open = languageText('button', 'personal-journal-open', postTitle); open.type = 'button';
        open.setAttribute('aria-haspopup', 'dialog'); open.addEventListener('click', () => viewer.open(post, open)); title.append(open);
      }
      article.append(title);
    }
    if (postBody.trim()) article.append(languageText('p', 'personal-journal-body', postBody));
    if (post.images.length) {
      const gallery = element('div', `personal-journal-images${post.images.length === 1 ? ' is-single' : ''}`);
      gallery.setAttribute('data-image-count', String(post.images.length));
      gallery.style.setProperty('--journal-image-columns', post.images.length === 2 || post.images.length === 4 ? '2' : '3');
      for (const [index, source] of post.images.entries()) {
        const alt = localizeOwnerText(source.alt, locale), button = element('button', 'personal-journal-image-button');
        button.type = 'button'; button.setAttribute('aria-label', alt ? `${words.viewImage} · ${alt}` : words.viewImage);
        button.setAttribute('aria-haspopup', 'dialog');
        const thumbnail = element('img', 'personal-journal-image'); thumbnail.src = source.url; thumbnail.alt = alt;
        thumbnail.loading = 'lazy'; thumbnail.decoding = 'async'; thumbnail.draggable = false;
        button.append(thumbnail); button.addEventListener('click', () => viewer.openImage(post, index, button)); gallery.append(button);
      }
      article.append(gallery);
    }
    if (!detail) {
      if (!postTitle.trim()) {
        const open = languageText('button', 'personal-journal-open personal-journal-open-untitled', words.viewPost); open.type = 'button';
        open.setAttribute('aria-haspopup', 'dialog'); open.addEventListener('click', () => viewer.open(post, open)); article.append(open);
      }
      const host = element('section', 'personal-post-comments'), section = getSection(post);
      section.panel.setCompact?.(true); section.host = host; host.append(section.root); article.append(host);
    }
    return article;
  }
  const viewer = createJournalViewer({ document: doc, mount: root, getEntries: () => entries, getWords: () => dictionary[locale], getLocale: () => locale,
    renderArticle: createPost,
    takeComments(post) { const section = getSection(post); section.panel.setCompact?.(false); return section.root; },
    releaseComments(post) { const section = findSection(post); if (!section) return; section.panel.setCompact?.(true); section.host?.append(section.root); },
    onReturn(post) { return returnToPost(post); },
  });

  function createJournalFeed(journal, words) {
    journal.classList.add('has-feed');
    const heading = element('h3', 'personal-journal-heading');
    heading.append(glyph('personal-journal-clover'), languageText('span', '', words.journal));
    const list = element('div', 'personal-journal-posts');
    list.id = `personal-journal-posts-${++journalSerial}`;
    list.tabIndex = -1;
    const pagination = element('nav', 'personal-journal-pagination');
    pagination.setAttribute('aria-label', words.journalPagination);
    const pageCount = Math.max(1, Math.ceil(entries.length / JOURNAL_PAGE_SIZE));
    pageIndex = Math.min(pageIndex, pageCount - 1);
    pagination.hidden = pageCount <= 1;
    journal.append(heading, languageText('p', 'personal-journal-note', words.journalNote), list, pagination);
    let pageBusy = false, motionSequence = 0, pageAnimation = null;
    const win = doc.defaultView;
    const reducedMotion = () => Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    cancelPageMotion = () => { ++motionSequence; pageAnimation?.cancel(); pageAnimation = null; pageBusy = false; };

    const renderPagination = () => {
      const pageButton = (target, label, className, accessibleLabel) => {
        const button = element('button', `personal-journal-page${className ? ` ${className}` : ''}`, label);
        button.type = 'button';
        button.disabled = pageBusy || target < 0 || target >= pageCount;
        button.setAttribute('aria-controls', list.id);
        button.setAttribute('aria-label', accessibleLabel);
        if (!className && target === pageIndex) button.setAttribute('aria-current', 'page');
        button.addEventListener('click', () => changePage(target));
        return button;
      };
      const items = journalPageItems(pageIndex + 1, pageCount).map(page => {
        if (page === null) {
          const ellipsis = element('span', 'personal-journal-ellipsis', '…');
          ellipsis.setAttribute('aria-hidden', 'true');
          return ellipsis;
        }
        return pageButton(page - 1, String(page), '', words.journalPage.replace('{page}', String(page)).replace('{pages}', String(pageCount)));
      });
      pagination.replaceChildren(
        pageButton(pageIndex - 1, '〈', 'is-previous personal-journal-previous', words.journalPrevious),
        ...items,
        pageButton(pageIndex + 1, '〉', 'is-next personal-journal-next', words.journalNext),
      );
      pagination.setAttribute('aria-busy', String(pageBusy));
    };
    const renderEntries = () => {
      list.replaceChildren(...entries.slice(pageIndex * JOURNAL_PAGE_SIZE, (pageIndex + 1) * JOURNAL_PAGE_SIZE).map(post => createPost(post)));
    };
    returnToPost = post => {
      const index = entries.findIndex(item => item === post || item.id && item.id === post.id);
      if (index < 0 || destroyed) return null;
      pageIndex = Math.floor(index / JOURNAL_PAGE_SIZE); cancelPageMotion(); renderEntries(); renderPagination();
      const article = [...list.querySelectorAll('.personal-journal-post')].find(node => node.getAttribute('data-journal-id') === (post.id || ''));
      article?.scrollIntoView?.({ block: 'nearest', behavior: reducedMotion() ? 'instant' : 'smooth' });
      return article?.querySelector('.personal-journal-open') || list;
    };
    function changePage(next) {
      if (destroyed || pageBusy || next < 0 || next >= pageCount || next === pageIndex) return;
      const sequence = ++motionSequence;
      const active = () => !destroyed && sequence === motionSequence && root.contains(journal);
      pageBusy = true; renderPagination(); list.setAttribute('aria-busy', 'true');
      let committed = false;
      const commit = () => {
        if (!active()) return;
        viewer.closeImage(true); pageIndex = next; renderEntries(); renderPagination(); committed = true;
        list.focus?.({ preventScroll: true });
        list.scrollIntoView?.({ block: 'start', behavior: reducedMotion() ? 'instant' : 'smooth' });
      };
      const finish = () => {
        if (!active()) return;
        pageAnimation?.cancel(); pageAnimation = null;
        pageBusy = false; list.removeAttribute('aria-busy'); renderPagination();
      };
      if (typeof list.animate !== 'function' || reducedMotion() || doc.hidden) { commit(); finish(); return; }
      void (async () => {
        try {
          pageAnimation = list.animate([{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-9px)' }], { duration: 150, easing: 'cubic-bezier(.4,0,.7,1)', fill: 'both' });
          await pageAnimation.finished;
          if (!active()) return;
          pageAnimation.cancel(); pageAnimation = null; commit();
          pageAnimation = list.animate([{ opacity: 0, transform: 'translateY(13px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 260, easing: 'cubic-bezier(.2,.75,.3,1)', fill: 'both' });
          await pageAnimation.finished;
        } catch { /* Animation support or cancellation must not strand the selected page. */ }
        finally { if (active()) { if (!committed) commit(); finish(); } }
      })();
    }
    renderEntries(); renderPagination();
  }

  function render() {
    cancelPageMotion(); cancelPageMotion = () => {};
    viewer.closeImage(true);
    const ids = new Set(entries.map(post => post.id));
    for (const section of [...commentSections]) if (!ids.has(section.id)) { disposeComment(section); commentSections.delete(section); }
    const copy = dictionary[locale];
    const shell = element('div', 'personal-card');
    const eyebrow = languageText('p', 'personal-eyebrow personal-reveal', copy.eyebrow);
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
    const name = languageText('h2', 'personal-name personal-reveal', localizeOwnerText(data.name, locale) || localizeOwnerText(DEFAULT_OWNER_PROFILE.name, locale));
    name.id = 'personal-heading';
    const bio = languageText('p', 'personal-bio personal-reveal', localizeOwnerText(data.bio, locale)); bio.hidden = !bio.textContent;
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
      const text = languageText('span', 'personal-social-label', label);
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
        entry.append(glyph('personal-journal-clover'), languageText('span', '', copy.journal), languageText('small', '', url ? '↗' : copy.soon));
        journal.append(entry, languageText('p', 'personal-journal-note', copy.journalNote));
      }
      shell.append(journal);
    }
    root.classList.add('personal-page'); root.replaceChildren(shell); viewer.mount(root); viewer.refresh();
  }
  render();
  return {
    setLanguage(next) { if (destroyed) return; locale = next === 'ja' ? 'ja' : 'zh'; render({ preserveComments: true }); },
    setCopy(next) { if (destroyed) return; dictionary = copyDictionary(next); render({ preserveComments: true }); },
    setCommentsService(next) { if (destroyed) return; commentService = next; commentSections.forEach(section => section.setService(next)); },
    setCommentsCopy(next) { if (destroyed) return; commentDictionary = normalizeCommentsCopy(next); commentSections.forEach(section => section.updateCopy()); },
    setPosts(next) { if (destroyed) return; entries = publishedPosts(next); pageIndex = Math.min(pageIndex, Math.max(0, Math.ceil(entries.length / JOURNAL_PAGE_SIZE) - 1)); render(); },
    update(next) { if (destroyed) return; data = normalizePersonalProfile(next); render(); },
    destroy() { if (destroyed) return; cancelPageMotion(); viewer.destroy(); disposeComments(); commentDrafts.clear(); expandedComments.clear(); commentReplies.clear(); destroyed = true; root.replaceChildren(); root.classList.remove('personal-page'); },
  };
}
