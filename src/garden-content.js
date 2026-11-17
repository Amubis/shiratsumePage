const GROUPS = ['site', 'album', 'outfits', 'owner', 'personal', 'comments', 'fixed'];
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const text = (value, limit = 50000) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, limit) : '';
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const clone = value => JSON.parse(JSON.stringify(value));
const id = (value, fallback) => text(value, 120).trim() || fallback;
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
// Existing drafts keep their edits; only retired stock branding is migrated.
const RETIRED_DISPLAY_COPY = [
  ['site','zh','chooseModel','选择一座小庭院','选择模型'],
  ['site','ja','chooseModel','小さな庭を選ぶ','モデルを選ぶ'],
  ['site','zh','originalTheme','四叶草庭院','しらつめ'],
  ['site','ja','originalTheme','クローバーの庭','しらつめ'],
  ['site','zh','backTop','回到庭院入口','回到首页'],
  ['site','ja','backTop','庭の入り口にもどる','最初のページへ'],
  ['site','zh','previewThemeName','紫藤色小庭院<small>第二主题预览</small>','第二模型<small>主题预览</small>'],
  ['site','ja','previewThemeName','藤色の小さな庭<small>第2テーマのプレビュー</small>','第2モデル<small>テーマのプレビュー</small>'],
  ['site','zh','previewHelloHeading','新的庭院，<br>慢慢生长。','下一位主角，<br>准备登场。'],
  ['site','ja','previewHelloHeading','新しい庭が、<br>育つまで。','次の主役を、<br>準備中。'],
  ...['zh','ja'].flatMap(locale=>[
    ['site',locale,'anotherGarden','ANOTHER LITTLE GARDEN','MODEL / 01—02'],
    ['fixed',locale,'coordinate',"SHIRATSUME'S LITTLE GARDEN",'SHIRATSUME / AVATAR ARCHIVE'],
    ['personal',locale,'eyebrow','THE PERSON BEHIND THIS LITTLE GARDEN.','ABOUT THE CREATOR.'],
  ]),
];

export function safeGardenURL(value, { contact = false } = {}) {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (!url || /[\u0000-\u0020\u007f\\]/.test(url) || url.startsWith('//')) return null;
  if (/^(?:\.\/)?(?:assets|media)\//.test(url)) {
    try {
      const decoded = decodeURIComponent(url);
      if (/[%\\?#\u0000-\u0020\u007f]/.test(decoded) || /%2f|%5c/i.test(url) || decoded.split('/').some(segment => segment === '..')) return null;
      return url;
    } catch { return null; }
  }
  try {
    const parsed = new URL(url);
    if (['http:', 'https:'].includes(parsed.protocol)) return parsed.href;
    if (contact && ['mailto:', 'tel:'].includes(parsed.protocol) && parsed.pathname) return parsed.href;
  } catch { /* Invalid and executable media references are not retained. */ }
  return null;
}

export function validGardenDate(value) {
  if (typeof value !== 'string') return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):?(\d{2}))?)?$/);
  if (!match) return false;
  const [year, month, day] = match.slice(1, 4).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    && (!match[4] || Number(match[4]) < 24) && (!match[5] || Number(match[5]) < 60) && (!match[6] || Number(match[6]) < 60)
    && (!match[7] || Number(match[7]) <= 14) && (!match[8] || Number(match[8]) < 60) && !(Number(match[7]) === 14 && Number(match[8]) > 0);
}

function localized(value, fallback = '') {
  if (typeof value === 'string') return text(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return clone(fallback);
  return { zh: text(value.zh), ja: text(value.ja) };
}
function texts(input, defaults) {
  return Object.fromEntries(GROUPS.map(group => [group, Object.fromEntries(['zh', 'ja'].map(language => {
    const combined = { ...object(defaults?.[group]?.[language]), ...object(input?.[group]?.[language]) };
    return [language, Object.fromEntries(Object.entries(combined).filter(([key, value]) => !RESERVED.has(key) && typeof value === 'string').map(([key, value]) => [key, text(value)]))];
  }))]));
}
function unique(items, convert) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).slice(0, 10000).flatMap((item, index) => {
    const value = convert(object(item), index);
    if (!value || seen.has(value.id)) return [];
    seen.add(value.id); return [value];
  });
}
function bounds(value) { return Array.isArray(value) && value.length === 4 && value.every(Number.isFinite) ? [...value] : undefined; }
function size(value) { return Array.isArray(value) && value.length === 2 && value.every(number => Number.isFinite(number) && number > 0 && number <= 32768) ? [...value] : undefined; }
function photoModelIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter(item => typeof item === 'string').map(item => {
    const name = text(item, 120).trim(), known = name.toLowerCase();
    if (!name || known === 'none') return '';
    return ['shiratsume', 'milfy'].includes(known) ? known : name;
  }).filter(Boolean))];
}

/** One portable content document is shared by the editor, server and visitor page. */
export function normalizeGardenContent(input, defaults = {}) {
  const raw = object(input), base = object(defaults);
  const owner = { ...object(base.owner), ...object(raw.owner) }, settings = { ...object(base.settings), ...object(raw.settings) };
  const profile = { ...object(base.modelProfile), ...object(raw.modelProfile) };
  const result = {
    schemaVersion: 1,
    settings: { mediaBaseUrl: safeGardenURL(settings.mediaBaseUrl) || '', publicSiteUrl: safeGardenURL(settings.publicSiteUrl) || '', defaultModelId: id(settings.defaultModelId, 'shiratsume') },
    texts: texts(raw.texts, base.texts),
    modelProfile: { name: localized(profile.name, 'しらつめ'), ...Object.fromEntries(['zh', 'ja'].map(language => [language, Object.fromEntries(['eyebrow', 'heading', 'lead', 'description'].map(key => [key, text(profile[language]?.[key] ?? base.modelProfile?.[language]?.[key])]))])) },
    owner: {
      schemaVersion: 1, avatar: safeGardenURL(owner.avatar), name: localized(owner.name, 'Amubis'), bio: localized(owner.bio),
      contacts: (Array.isArray(owner.contacts) ? owner.contacts : []).slice(0, 30).flatMap(contact => { const url = safeGardenURL(contact?.url, { contact: true }); return url ? [{ label: localized(contact.label), url }] : []; }),
      socials: Object.fromEntries(['xiaohongshu', 'x', 'vrchat', 'pixiv'].map(key => [key, /^https?:/.test(safeGardenURL(owner.socials?.[key]) || '') ? safeGardenURL(owner.socials[key]) : null])),
      journal: { mode: ['placeholder', 'hidden', 'link', 'feed'].includes(owner.journal?.mode) ? owner.journal.mode : 'placeholder', url: /^https?:/.test(safeGardenURL(owner.journal?.url) || '') ? safeGardenURL(owner.journal.url) : null },
    },
    outfits: unique(raw.outfits ?? base.outfits, (item, index) => {
      const outfit = { id: id(item.id, `outfit-${index + 1}`), label: localized(item.label), front: safeGardenURL(item.front) || '', back: safeGardenURL(item.back), imageWidth: Math.max(1, Math.min(32768, finite(item.imageWidth, 1440))), imageHeight: Math.max(1, Math.min(32768, finite(item.imageHeight, 2560))) };
      for (const key of ['frontBounds', 'backBounds']) if (bounds(item[key])) outfit[key] = bounds(item[key]);
      for (const key of ['frontSize', 'backSize']) if (size(item[key])) outfit[key] = size(item[key]);
      if (item.backCalibration) outfit.backCalibration = { scale: Math.max(.1, Math.min(5, finite(item.backCalibration.scale, 1))), offsetX: Math.max(-32768, Math.min(32768, finite(item.backCalibration.offsetX, 0))), offsetY: Math.max(-32768, Math.min(32768, finite(item.backCalibration.offsetY, 0))) };
      return outfit;
    }),
    media: unique(raw.media ?? base.media, (item, index) => ({
      id: id(item.id, `photo-${index + 1}`), url: safeGardenURL(item.url) || '', thumbnail: safeGardenURL(item.thumbnail) || safeGardenURL(item.url) || '',
      alt: localized(item.alt), caption: localized(item.caption), modelIds: photoModelIds(item.modelIds),
      takenAt: validGardenDate(item.takenAt) ? item.takenAt : null, worldName: text(item.worldName, 1000), worldId: text(item.worldId, 120),
      sourceKind: text(item.sourceKind, 40) || 'photo', enabled: item.enabled !== false,
      width: Math.max(0, finite(item.width, 0)), height: Math.max(0, finite(item.height, 0)), timeZone: text(item.timeZone, 80),
      originalKey: /^private\/originals\/[a-f\d]{64}\.(?:png|jpe?g|webp)$/.test(item.originalKey || '') ? item.originalKey : null,
      originalName: text(item.originalName, 1000), metadataSource: clone(object(item.metadataSource)), warnings: (Array.isArray(item.warnings) ? item.warnings : []).slice(0, 30).map(value => text(value, 1000)),
    })),
    journal: unique(raw.journal ?? base.journal, (item, index) => ({
      id: id(item.id, `note-${index + 1}`), title: localized(item.title), body: localized(item.body), createdAt: validGardenDate(item.createdAt) ? item.createdAt : null, published: item.published === true,
      images: (Array.isArray(item.images) ? item.images : []).slice(0, 50).flatMap(image => { const source = typeof image === 'string' ? { url: image } : object(image), url = safeGardenURL(source.url); return url ? [{ url, alt: localized(source.alt) }] : []; }),
    })),
  };
  for(const [group,locale,key,before,after] of RETIRED_DISPLAY_COPY)if(result.texts[group][locale][key]===before)result.texts[group][locale][key]=after;
  return result;
}

export function validateGardenContent(input) {
  const errors = [];
  if (!input || input.schemaVersion !== 1) errors.push('内容版本必须为 schemaVersion 1。');
  for (const key of ['outfits', 'media', 'journal']) if (input?.[key] !== undefined && (!Array.isArray(input[key]) || input[key].length > 10000)) errors.push(`${key} 必须是最多 10000 项的列表。`);
  const visit = (value, path = '') => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      const current = path ? `${path}.${key}` : key;
      if (RESERVED.has(key)) { errors.push('内容中包含不支持的字段。'); continue; }
      const urlField = /^(?:settings\.(?:mediaBaseUrl|publicSiteUrl)|owner\.avatar|owner\.contacts\.\d+\.url|owner\.socials\.[\w]+|owner\.journal\.url|outfits\.\d+\.(?:front|back)|media\.\d+\.(?:url|thumbnail)|journal\.\d+\.images\.\d+\.url)$/.test(current);
      if (urlField && item && typeof item === 'string' && !safeGardenURL(item, { contact: current.startsWith('owner.contacts.') })) errors.push(`${current} 的地址不可用。`);
      if (/^(?:media\.\d+\.takenAt|journal\.\d+\.createdAt)$/.test(current) && item && !validGardenDate(item)) errors.push(`${current} 的日期不可用。`);
      if (typeof item === 'string' && item.length > 100000) errors.push(`${current} 的文字过长。`);
      if (typeof item === 'object') visit(item, current);
    }
  };
  visit(input);
  return [...new Set(errors)];
}

export function publicGardenContent(input, { mediaBaseUrl = '' } = {}) {
  const result = normalizeGardenContent(input);
  if (mediaBaseUrl) result.settings.mediaBaseUrl = safeGardenURL(mediaBaseUrl) || '';
  result.outfits = result.outfits.filter(item => item.front);
  result.media = result.media.filter(item => item.enabled && item.url).map(({ originalKey, originalName, metadataSource, warnings, ...item }) => item);
  const hasText = value => typeof value === 'string' ? value.trim() : Object.values(object(value)).some(item => typeof item === 'string' && item.trim());
  result.journal = result.journal.filter(item => item.published && (hasText(item.body) || item.images.length));
  return result;
}

/** Media object keys remain stable when the website or media domain changes. */
export function resolveGardenMedia(input, baseUrl = '') {
  const result = clone(input), base = baseUrl || result.settings?.mediaBaseUrl || '';
  const keys = new Set(['url', 'thumbnail', 'front', 'back', 'avatar']);
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (keys.has(key) && typeof item === 'string' && /^(?:\.\/)?media\//.test(item)) {
        if (base) { try { value[key] = new URL(item.replace(/^\.\//, ''), base.endsWith('/') ? base : `${base}/`).href; } catch { value[key] = item; } }
        else value[key] = item.startsWith('./') ? item : `./${item}`;
      } else if (item && typeof item === 'object') walk(item);
    }
  };
  walk(result); return result;
}
