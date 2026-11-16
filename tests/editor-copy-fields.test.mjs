import test from 'node:test';
import assert from 'node:assert/strict';
import { EDITOR_COPY_SECTIONS, editorCopySection, readEditorCopy, writeEditorCopy } from '../src/editor-copy-fields.js';

test('the normal editor lists a small set of visible copy by real chapter', () => {
  const fields = EDITOR_COPY_SECTIONS.flatMap(section => section.fields);
  assert.equal(fields.length, 21);
  assert.equal(new Set(fields.map(field => field.id)).size, fields.length);
  assert.deepEqual(EDITOR_COPY_SECTIONS.map(section => section.id), ['navigation', 'home', 'hello', 'moments', 'collection']);
  assert.ok(fields.every(field => field.label && field.location));
  assert.ok(fields.every(field => !/preview|error|loading|aria|alt|pause|retry/i.test(field.id)));
  assert.equal(editorCopySection('old-group').id, 'navigation');
});

test('editing visible copy preserves hidden status dictionaries, other languages and content', () => {
  const content = { texts: { site: { zh: { navHome: '入口', videoLoading: '正在加载', previewHelloHeading: '占位' }, ja: { navHome: '入り口' } }, comments: { zh: { submitting: '正在发送' } } }, owner: { name: 'Amubis' }, media: [{ id: 'photo' }] };
  const hidden = structuredClone({ comments: content.texts.comments, owner: content.owner, media: content.media });
  writeEditorCopy(content, 'navHome', 'zh', '首页');
  assert.equal(readEditorCopy(content, 'navHome', 'zh'), '首页');
  assert.equal(readEditorCopy(content, 'navHome', 'ja'), '入り口');
  assert.equal(content.texts.site.zh.videoLoading, '正在加载');
  assert.equal(content.texts.site.zh.previewHelloHeading, '占位');
  assert.deepEqual({ comments: content.texts.comments, owner: content.owner, media: content.media }, hidden);
});

test('a model name becomes bilingual without discarding its existing translation', () => {
  const content = { modelProfile: { name: 'しらつめ', zh: { heading: '介绍标题' }, ja: { heading: '紹介' } } };
  assert.equal(readEditorCopy(content, 'modelName', 'ja'), 'しらつめ');
  writeEditorCopy(content, 'modelName', 'zh', '模型名称');
  assert.deepEqual(content.modelProfile.name, { zh: '模型名称', ja: 'しらつめ' });
  assert.equal(content.modelProfile.zh.heading, '介绍标题');
  writeEditorCopy(content, 'modelDescription', 'ja', '一行目\n二行目');
  assert.equal(readEditorCopy(content, 'modelDescription', 'ja'), '一行目\n二行目');
  assert.equal(content.modelProfile.ja.heading, '紹介');
});

test('unknown fields cannot write arbitrary paths and empty copy remains intentional', () => {
  const content = {};
  assert.throws(() => writeEditorCopy(content, '__proto__', 'zh', 'bad'), RangeError);
  assert.throws(() => writeEditorCopy(content, 'heroDescription', 'zh', {}), TypeError);
  writeEditorCopy(content, 'heroDescription', 'zh', '');
  assert.equal(readEditorCopy(content, 'heroDescription', 'zh'), '');
  assert.equal({}.bad, undefined);
});
