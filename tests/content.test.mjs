import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { MODELS, COPY, SECTION_IDS, getSelection, escapeXML } from '../src/content.js';

test('both languages cover every visible translation and image description', async () => {
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const keys=[...html.matchAll(/data-i18n(?:-alt)?="([^"]+)"/g)].map(match=>match[1]);
  for(const language of ['zh','ja'])for(const key of keys)assert.ok(COPY[language][key],`${language}: ${key}`);
  assert.deepEqual(Object.keys(COPY.zh).sort(),Object.keys(COPY.ja).sort());
});
test('all navigation targets refer to real sections', async () => {
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  for(const id of SECTION_IDS)assert.ok(html.includes(`id="${id}"`));
  for(const [,index] of html.matchAll(/data-go="(\d+)"/g))assert.ok(SECTION_IDS[Number(index)]);
});
test('unknown query selections cannot load arbitrary theme or content', () => {
  assert.deepEqual(getSelection('?model=unknown&lang=unknown'),{model:'shiratsume',language:'zh'});
  assert.deepEqual(getSelection('?model=preview&lang=ja'),{model:'preview',language:'ja'});
  assert.deepEqual(getSelection('?model=__proto__&lang=constructor'),{model:'shiratsume',language:'zh'});
});
test('second theme does not reuse first model video', () => {
  assert.equal(MODELS.preview.playlist.length,0);
  assert.notEqual(MODELS.preview.poster,MODELS.shiratsume.poster);
  assert.equal(MODELS.preview.preview,true);
});
test('all configured media exists and each file fits Pages asset limit', async () => {
  for(const model of Object.values(MODELS))for(const path of [model.poster,...model.playlist]){
    const information=await stat(new URL('../'+path,import.meta.url));
    assert.ok(information.size>0);
    assert.ok(information.size<25*1024*1024,path);
  }
});
test('model names used in SVG text are escaped', () => {
  assert.equal(escapeXML('<&"\''),'&lt;&amp;&quot;&#39;');
});
