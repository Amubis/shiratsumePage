import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const base=new URL('../assets/fonts/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('text-fonts-manifest.json',base),'utf8'));
const stylesheet=await readFile(new URL('text-fonts.css',base),'utf8');
function points(range){
 const result=new Set();
 for(const item of range.split(',')){
  const match=item.trim().match(/^U\+([\dA-F]+)(?:-([\dA-F]+))?$/i);assert.ok(match,item);
  const start=parseInt(match[1],16),end=parseInt(match[2]||match[1],16);
  for(let value=start;value<=end;value++)result.add(value);
 }
 return result;
}
test('self-hosted font bytes match verified character coverage and retain their open license',async()=>{
 assert.equal(manifest.files.length,9);assert.equal(manifest.axis.min,100);assert.equal(manifest.axis.max,900);
 let total=0;
 for(const entry of manifest.files){
  const bytes=await readFile(new URL(entry.file,base));
  assert.equal(bytes.subarray(0,4).toString(),'wOF2');assert.equal(bytes.length,entry.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,entry.file);
  assert.ok(bytes.length<2*1024*1024);total+=bytes.length;
 }
 assert.equal(total,manifest.totalBytes);assert.ok(total<15*1024*1024);
 assert.match(await readFile(new URL('OFL-NotoSansSC.txt',base),'utf8'),/SIL OPEN FONT LICENSE/);
});
test('font CSS routes every supported character to exactly one matching local package',()=>{
 const blocks=[...stylesheet.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(match=>match[1]);assert.equal(blocks.length,9);
 const union=new Set();
 for(const entry of manifest.files){
  const block=blocks.find(block=>block.includes(entry.file));assert.ok(block,entry.file);
  assert.match(block,/font-family:\s*"Shiratsume Text"/);assert.match(block,/font-weight:\s*100\s+900/);
  assert.match(block,/font-display:\s*swap/);assert.doesNotMatch(block,/local\(|https?:/);
  const actual=points(block.match(/unicode-range:\s*([^;]+)/)[1]),expected=points(entry.unicodeRange);
  assert.deepEqual(actual,expected);assert.equal(actual.size,entry.codepoints);
  for(const codepoint of actual){assert.equal(union.has(codepoint),false,`duplicate U+${codepoint.toString(16)}`);union.add(codepoint);}
 }
 assert.equal(union.size,manifest.totalCodepoints);assert.ok(union.size>30000);
});
test('current content and new Chinese or Japanese copy are covered independently of the visitor fonts',async()=>{
 const supported=new Set(manifest.files.flatMap(entry=>[...points(entry.unicodeRange)]));
 const content=JSON.parse(await readFile(new URL('../data/garden.json',import.meta.url),'utf8'));
 const values=[];function walk(value){if(typeof value==='string')values.push(value);else if(value&&typeof value==='object')Object.values(value).forEach(walk);}walk(content);
 values.push('简体补齐汉语时钟爱恋镜头摄影照片留言昵称秘密欢迎收藏繁體字漢字日本語かなカナ服装紹介');
 for(const text of values)for(const character of text){
  const point=character.codePointAt(0);
  if((point>=0x3400&&point<=0x9fff)||(point>=0x3000&&point<=0x30ff)||(point>=0x20&&point<=0x7e))assert.ok(supported.has(point),`missing ${character} U+${point.toString(16)}`);
 }
});
