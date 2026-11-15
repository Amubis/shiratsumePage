import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGardenContent, publicGardenContent, resolveGardenMedia, safeGardenURL, validGardenDate, validateGardenContent } from '../src/garden-content.js';

const privateKey = `private/originals/${'a'.repeat(64)}.png`;

test('visitor content includes enabled photos and published notes with body or images, while drafts remain private', () => {
  const input = {
    media: [
      { id: 'visible', url: 'media/photo.webp', enabled: true },
      { id: 'disabled', url: 'media/disabled.webp', enabled: false },
      { id: 'unsafe', url: 'javascript:alert(1)' },
    ],
    outfits: [{ id: 'usable', front: 'media/front.webp' }, { id: 'missing', front: '' }],
    journal: [
      { id: 'body', body: { zh: '公开正文', ja: '' }, published: true },
      { id: 'image', images: ['media/note.webp'], published: true },
      { id: 'draft', body: 'private draft', published: false },
      { id: 'implicit', body: 'private unpublished' },
      { id: 'string-flag', body: 'not a boolean publication', published: 'true' },
      { id: 'title-only', title: '只有标题', body: ' \n ', published: true },
      { id: 'unsafe-image', images: ['data:image/svg+xml,<svg/>'], published: true },
    ],
    draft: { token: 'private top-level state' },
  };
  const before = JSON.stringify(input);
  const result = publicGardenContent(input);
  assert.deepEqual(result.media.map(item => item.id), ['visible']);
  assert.deepEqual(result.outfits.map(item => item.id), ['usable']);
  assert.deepEqual(result.journal.map(item => item.id), ['body', 'image']);
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.equal(JSON.stringify(input), before, 'building a visitor document must not edit the saved draft');
});

test('public photos retain useful capture hints and strip original files, private metadata and parser diagnostics', () => {
  const source = {
    media: [{
      id: 'photo', url: 'media/photo.webp', thumbnail: 'media/photo-thumb.webp',
      takenAt: '2026-11-10T20:14:15.123', timeZone: 'unspecified',
      worldName: 'A quiet world', worldId: 'wrld_public', width: 3840, height: 2160,
      originalKey: privateKey, originalName: 'private-screenshot.png',
      metadataSource: { playerIds: ['usr_private'], instance: 'private-instance', exif: { GPSLatitude: 'private-location' } },
      warnings: ['private-parser-warning'], players: ['usr_private_extra'],
    }],
  };
  const normalized = normalizeGardenContent(source);
  assert.equal(normalized.media[0].originalKey, privateKey, 'the editor retains the original-file reference');
  assert.equal(normalized.media[0].metadataSource.instance, 'private-instance');
  const result = publicGardenContent(normalized).media[0];
  assert.equal(result.worldName, 'A quiet world');
  assert.equal(result.worldId, 'wrld_public');
  assert.equal(result.width, 3840);
  assert.equal(result.height, 2160);
  assert.equal(result.takenAt, source.media[0].takenAt);
  assert.equal(result.timeZone, 'unspecified');
  for (const key of ['originalKey', 'originalName', 'metadataSource', 'warnings', 'players']) assert.ok(!(key in result), key);
  assert.ok(!JSON.stringify(result).includes('private'));
});

test('capture timestamps preserve absent and explicit timezones without changing wall-clock dates', () => {
  const timestamps = [
    ['2026-11-10', ''], ['2026-11-10T20:14:15.123', 'unspecified'],
    ['2026-11-10T20:14:15+09:00', 'offset'], ['2026-11-10T20:14:15Z', 'UTC'],
  ];
  const result = publicGardenContent({ media: timestamps.map(([takenAt, timeZone], index) => ({ id: String(index), url: `media/${index}.webp`, takenAt, timeZone })) });
  assert.deepEqual(result.media.map(item => [item.takenAt, item.timeZone]), timestamps);
  for (const invalid of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-11-10T24:00:00', '2026-11-10T20:60:00', '2026-11-10T20:14:15+14:01']) {
    assert.equal(validGardenDate(invalid), false, invalid);
    assert.ok(validateGardenContent({ schemaVersion: 1, media: [{ takenAt: invalid }] }).some(error => error.includes('takenAt')), invalid);
    assert.equal(normalizeGardenContent({ media: [{ takenAt: invalid }] }).media[0].takenAt, null);
  }
  assert.equal(validGardenDate('2024-02-29T23:59:59.123456789-14:00'), true);
});

test('media and profile links reject executable schemes, ambiguous hosts and traversal paths', () => {
  const unsafe = [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:image/svg+xml,<svg/>',
    'blob:https://example.test/id', 'file:///private/photo.png', '//example.test/photo.png',
    'https://example.test/a\\b.png', 'https://example.test/a\nb.png',
    'media/../private/original.png', './assets/../../private/original.png',
  ];
  for (const value of unsafe) {
    assert.equal(safeGardenURL(value), null, value);
    const result = normalizeGardenContent({ settings: { mediaBaseUrl: value }, owner: { avatar: value, contacts: [{ url: value }] }, outfits: [{ front: value, back: value }], media: [{ url: value, thumbnail: value }], journal: [{ images: [value] }] });
    assert.equal(result.settings.mediaBaseUrl, '');
    assert.equal(result.owner.avatar, null);
    assert.deepEqual(result.owner.contacts, []);
    assert.equal(result.outfits[0].front, '');
    assert.equal(result.outfits[0].back, null);
    assert.equal(result.media[0].url, '');
    assert.equal(result.media[0].thumbnail, '');
    assert.deepEqual(result.journal[0].images, []);
    assert.ok(validateGardenContent({ schemaVersion: 1, media: [{ url: value }] }).some(error => error.includes('url')), value);
  }
  for (const value of ['media/photo.webp', './media/photo.webp', './assets/avatar.png', 'https://cdn.example.test/photo.webp']) assert.ok(safeGardenURL(value), value);
  assert.equal(safeGardenURL('mailto:hello@example.test'), null);
  assert.equal(safeGardenURL('mailto:hello@example.test', { contact: true }), 'mailto:hello@example.test');
  assert.equal(safeGardenURL('tel:+819012345678', { contact: true }), 'tel:+819012345678');
});

test('percent-encoded traversal cannot move a portable media key outside its public media prefix', () => {
  for (const value of ['media/%2e%2e/private/original.png', 'media/%2E%2E/private/original.png', 'media/..%2fprivate/original.png', './assets/%2e%2e/private.png', 'media/%252e%252e/private.png', 'media/%5cprivate.png', 'media/%GG.png']) {
    assert.equal(safeGardenURL(value), null, value);
    assert.ok(validateGardenContent({ schemaVersion: 1, media: [{ url: value }] }).length, value);
  }
});

test('one media base relocates every portable public image without rewriting saved keys or bundled assets', () => {
  const input = normalizeGardenContent({
    settings: { mediaBaseUrl: 'https://old.example.test/garden/' },
    owner: { avatar: 'media/avatar.webp', contacts: [{ url: 'https://contact.example.test/' }] },
    outfits: [{ id: 'look', front: 'media/front.webp', back: './media/back.webp' }],
    media: [{ id: 'photo', url: 'media/photo.webp', thumbnail: './media/thumb.webp', originalKey: privateKey }, { id: 'bundled', url: './assets/poster.jpg' }, { id: 'external', url: 'https://external.example.test/photo.webp' }],
    journal: [{ id: 'note', body: 'with photo', published: true, images: ['media/note.webp'] }],
  });
  const before = JSON.stringify(input);
  const publicContent = publicGardenContent(input, { mediaBaseUrl: 'https://new.example.test/archive' });
  const resolved = resolveGardenMedia(publicContent);
  const prefix = 'https://new.example.test/archive/media/';
  assert.equal(resolved.owner.avatar, prefix + 'avatar.webp');
  assert.equal(resolved.outfits[0].front, prefix + 'front.webp');
  assert.equal(resolved.outfits[0].back, prefix + 'back.webp');
  assert.equal(resolved.media[0].url, prefix + 'photo.webp');
  assert.equal(resolved.media[0].thumbnail, prefix + 'thumb.webp');
  assert.equal(resolved.journal[0].images[0].url, prefix + 'note.webp');
  assert.equal(resolved.owner.contacts[0].url, 'https://contact.example.test/');
  assert.equal(resolved.media[1].url, './assets/poster.jpg');
  assert.equal(resolved.media[2].url, 'https://external.example.test/photo.webp');
  assert.equal(resolveGardenMedia(publicContent, 'https://third.example.test/').media[0].url, 'https://third.example.test/media/photo.webp');
  assert.equal(publicContent.media[0].url, 'media/photo.webp');
  assert.equal(JSON.stringify(input), before);
  assert.ok(!JSON.stringify(resolved).includes(privateKey));
});

test('portable media works on the site origin without a configured media host', () => {
  const input = publicGardenContent({ media: [{ url: 'media/a.webp', thumbnail: './media/a-small.webp' }] });
  const resolved = resolveGardenMedia(input);
  assert.equal(resolved.media[0].url, './media/a.webp');
  assert.equal(resolved.media[0].thumbnail, './media/a-small.webp');
  assert.equal(input.media[0].url, 'media/a.webp');
});

test('missing content uses defaults while intentionally empty lists clear previously configured items', () => {
  const defaults = {
    settings: { mediaBaseUrl: 'https://cdn.example.test/' },
    texts: { site: { zh: { label: '默认', retained: '保留' }, ja: { label: '初期' } } },
    modelProfile: { name: '默认模型', zh: { heading: '默认标题', description: '默认简介' } },
    owner: { name: '默认作者', avatar: './assets/avatar.png' },
    outfits: [{ id: 'look', front: 'media/front.webp' }],
    media: [{ id: 'photo', url: 'media/photo.webp' }],
    journal: [{ id: 'note', body: '默认正文', published: true }],
  };
  const before = JSON.stringify(defaults);
  assert.deepEqual(normalizeGardenContent(undefined, defaults), normalizeGardenContent(defaults));
  const changed = normalizeGardenContent({
    texts: { site: { zh: { label: '更新' } } },
    modelProfile: { zh: { heading: '更新标题' } },
    outfits: [], media: [], journal: [],
  }, defaults);
  assert.equal(changed.texts.site.zh.label, '更新');
  assert.equal(changed.texts.site.zh.retained, '保留');
  assert.equal(changed.texts.site.ja.label, '初期');
  assert.equal(changed.modelProfile.zh.heading, '更新标题');
  assert.equal(changed.modelProfile.zh.description, '默认简介');
  assert.deepEqual([changed.outfits, changed.media, changed.journal], [[], [], []]);
  assert.equal(JSON.stringify(defaults), before);
  assert.deepEqual(validateGardenContent(normalizeGardenContent(null)), []);
});

test('reserved fields and invalid collection shapes are rejected before saving', () => {
  const poisoned = JSON.parse('{"schemaVersion":1,"texts":{"site":{"zh":{"__proto__":"bad","constructor":"bad","label":"safe"}}},"media":[{"url":"media/photo.webp","metadataSource":{"prototype":"bad"}}]}');
  assert.ok(validateGardenContent(poisoned).some(error => error.includes('不支持')));
  assert.deepEqual(normalizeGardenContent(poisoned).texts.site.zh, { label: 'safe' });
  assert.equal({}.polluted, undefined);
  for (const key of ['outfits', 'media', 'journal']) {
    assert.ok(validateGardenContent({ schemaVersion: 1, [key]: {} }).some(error => error.includes(key)));
    assert.ok(validateGardenContent({ schemaVersion: 1, [key]: Array(10001).fill({}) }).some(error => error.includes(key)));
  }
  assert.ok(validateGardenContent({ schemaVersion: 2 }).length);
});
