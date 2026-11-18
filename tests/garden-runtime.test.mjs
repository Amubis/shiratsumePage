import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeGardenContent, validateGardenContent } from '../src/garden-content.js';
import { acceptGardenPreview, loadPublishedGarden, normalizeGardenRuntime, readGardenData, setGardenText } from '../src/garden-runtime.js';
import { embedGardenData } from '../scripts/garden-data.mjs';

const seed=normalizeGardenContent({schemaVersion:1,texts:{site:{zh:{explore:'开始'}}},owner:{name:'Amubis',avatar:'./assets/owner-avatar.png'},media:[{id:'p',url:'./assets/frame-01.jpg'}]});
const response=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});

test('a static GitHub project URL preserves its public build content when no server exists',async()=>{
  const requests=[];
  const result=await loadPublishedGarden({pageURL:'https://amubis.github.io/shiratsumePage/?lang=ja#hello',defaults:seed,fetchImpl:async(url,options)=>{
    requests.push([url,options.credentials]);
    return requests.length===1?response({apiBaseUrl:''}):new Response('not found',{status:404});
  }});
  assert.deepEqual(requests,[['https://amubis.github.io/shiratsumePage/data/runtime.json','omit'],['https://amubis.github.io/api/content','omit']]);
  assert.equal(result.connected,false);assert.equal(result.content.texts.site.zh.explore,'开始');assert.equal(result.content.owner.name,'Amubis');
});

test('published remote edits and stable media keys load without a GitHub rebuild',async()=>{
  const requests=[];
  const result=await loadPublishedGarden({pageURL:'https://amubis.github.io/shiratsumePage/',defaults:seed,fetchImpl:async(url,options)=>{
    requests.push(url);assert.equal(options.credentials,'omit');
    return requests.length===1?response({apiBaseUrl:'https://garden.example/',adminUrl:'https://garden.example/admin/'}):response({...seed,settings:{mediaBaseUrl:'https://cdn.example/'},owner:{...seed.owner,bio:'New biography'},media:[{id:'new',url:'media/hash.webp'}]});
  }});
  assert.equal(requests[1],'https://garden.example/api/content');assert.equal(result.connected,true);assert.equal(result.content.owner.bio,'New biography');assert.equal(result.content.media[0].url,'https://cdn.example/media/hash.webp');
  assert.equal(result.runtime.adminUrl,'https://garden.example/admin/');
});

test('temporary network and server failures retry once while permanent failures do not',async()=>{
  for(const failure of [new TypeError('Network unavailable'),new DOMException('Aborted','AbortError'),new Response('unavailable',{status:503})]){
    let requests=0;
    const result=await loadPublishedGarden({pageURL:'https://garden.example/',defaults:seed,storage:null,fetchImpl:async(url,options)=>{
      assert.equal(options.credentials,'omit');
      if(url.endsWith('/data/runtime.json'))return response({});
      if(++requests===1){if(failure instanceof Error)throw failure;return failure;}
      return response({...seed,owner:{...seed.owner,bio:'Recovered'}});
    }});
    assert.equal(requests,2);assert.equal(result.connected,true);assert.equal(result.source,'remote');assert.equal(result.content.owner.bio,'Recovered');
  }
  for(const failure of [new Response('not found',{status:404}),response({schemaVersion:2}),new Response('{broken',{headers:{'Content-Type':'application/json'}})]){
    let requests=0;
    const result=await loadPublishedGarden({pageURL:'https://garden.example/',defaults:seed,storage:null,fetchImpl:async url=>{
      if(url.endsWith('/data/runtime.json'))return response({});
      requests++;return failure;
    }});
    assert.equal(requests,1);assert.equal(result.connected,false);assert.equal(result.source,'defaults');
  }
});

test('a failed connection retains only verified public content from the same API endpoint',async()=>{
  const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  const publication={...seed,settings:{mediaBaseUrl:'https://cdn.example/'},owner:{...seed.owner,bio:'Published biography'},media:[
    {id:'visible',url:'media/visible.webp',originalKey:`private/originals/${'a'.repeat(64)}.png`,metadataSource:{players:['Private player']}},
    {id:'excluded',url:'media/excluded.webp',enabled:false},
  ],journal:[{id:'private-note',body:'Private note',published:false}]};
  const remote=await loadPublishedGarden({pageURL:'https://pages.example/',defaults:seed,storage,fetchImpl:async url=>response(url.endsWith('/data/runtime.json')?{apiBaseUrl:'https://garden.example/'}:publication)});
  assert.equal(remote.connected,true);assert.equal(values.size,1);
  const serialized=[...values.values()][0];
  for(const hidden of ['private/originals','Private player','excluded','Private note'])assert.ok(!serialized.includes(hidden));
  let requests=0;
  const unavailable=async url=>{if(url.endsWith('/data/runtime.json'))return response({apiBaseUrl:'https://garden.example/'});requests++;throw new TypeError('Offline');};
  let cachedCallbacks=0;
  const cached=await loadPublishedGarden({pageURL:'https://pages.example/',defaults:seed,storage,fetchImpl:unavailable,onCached:content=>{
    cachedCallbacks++;assert.equal(requests,0);assert.equal(content.owner.bio,'Published biography');
  }});
  assert.equal(cachedCallbacks,1);
  assert.equal(requests,2);assert.equal(cached.connected,false);assert.equal(cached.source,'cache');assert.equal(cached.content.owner.bio,'Published biography');assert.equal(cached.content.media[0].url,'https://cdn.example/media/visible.webp');
  const other=await loadPublishedGarden({pageURL:'https://other.example/',defaults:seed,storage,fetchImpl:async url=>url.endsWith('/data/runtime.json')?response({}):new Response('not found',{status:404})});
  assert.equal(other.source,'defaults');assert.equal(other.content.owner.bio,seed.owner.bio);
});

test('draft preview and unavailable storage never persist private browser state',async()=>{
  const forbidden={getItem(){throw new Error('Storage must not be read');},setItem(){throw new Error('Storage must not be written');}};
  for(const pageURL of ['https://garden.example/?editor-preview=private-token','https://garden.example/']){
    const result=await loadPublishedGarden({pageURL,defaults:seed,storage:forbidden,fetchImpl:async url=>response(url.includes('/data/runtime.json')?{}:seed)});
    assert.equal(result.source,'remote');assert.equal(result.connected,true);
    const offline=await loadPublishedGarden({pageURL,defaults:seed,storage:forbidden,fetchImpl:async url=>url.includes('/data/runtime.json')?response({}):new Response('not found',{status:404})});
    assert.equal(offline.source,'defaults');assert.equal(offline.connected,false);
  }
  let writes=0,reads=0;
  const storage={getItem(){reads++;return JSON.stringify({...seed,owner:{...seed.owner,bio:'Cache should not be loaded'}});},setItem(){writes++;}};
  await loadPublishedGarden({pageURL:'https://garden.example/?editor-preview=private-token',defaults:seed,storage,fetchImpl:async url=>response(url.includes('/data/runtime.json')?{}:seed)});
  const preview=await loadPublishedGarden({pageURL:'https://garden.example/?editor-preview=private-token',defaults:seed,storage,fetchImpl:async url=>url.includes('/data/runtime.json')?response({}):new Response('not found',{status:404})});
  assert.equal(writes,0);assert.equal(reads,0);assert.equal(preview.source,'defaults');
});

test('invalid or unavailable remote publications fall back without erasing working pages',async()=>{
  for(const payload of [{schemaVersion:2},{...seed,media:[{url:'javascript:alert(1)'}]}]){
    let n=0;
    const result=await loadPublishedGarden({pageURL:'https://garden.example/',defaults:seed,fetchImpl:async()=>response(++n===1?{}:payload)});
    assert.equal(result.connected,false);assert.equal(result.content.media[0].id,'p');
  }
  assert.equal(normalizeGardenRuntime({apiBaseUrl:'javascript:alert(1)',adminUrl:'https://user:pass@example.test/'}).apiBaseUrl,'');
  assert.equal(normalizeGardenRuntime({adminUrl:'https://user:pass@example.test/'}).adminUrl,'');
});

test('draft preview requires the matching parent, same origin and per-editor token',()=>{
  const parent={},origin='https://garden.example',token='random-editor-token';
  const options={parent,origin,token,defaults:seed};
  const event={source:parent,origin,data:{type:'garden-preview',token,content:{...seed,texts:{site:{zh:{explore:'私有预览'}}},media:[{id:'published',url:'media/a.webp',enabled:true},{id:'draft',url:'media/b.webp',enabled:false}]}}};
  const preview=acceptGardenPreview(event,options);assert.equal(preview.texts.site.zh.explore,'私有预览');assert.deepEqual(preview.media.map(x=>x.id),['published']);
  for(const bad of [{...event,source:{}},{...event,origin:'https://other.example'},{...event,data:{...event.data,token:'old-token'}}])assert.equal(acceptGardenPreview(bad,options),null);
  assert.equal(acceptGardenPreview(event,{...options,token:null}),null);
});

test('public HTML safely embeds only publishable content and recovers defaults after malformed JSON',()=>{
  const html=embedGardenData('<script id="garden-data" type="application/json">null</script>',{...seed,owner:{...seed.owner,bio:'</script><img src=x onerror=alert(1)>'},journal:[{id:'private',body:'private draft',published:false}],media:[{id:'p',url:'media/a.webp',originalKey:`private/originals/${'a'.repeat(64)}.png`,metadataSource:{players:['private player']}}]});
  assert.equal((html.match(/<\/script>/g)||[]).length,1);assert.ok(!html.includes('private draft'));assert.ok(!html.includes('private/originals'));assert.ok(!html.includes('private player'));
  const value=html.match(/application\/json">(.*)<\/script>/s)[1];
  assert.equal(readGardenData({getElementById:()=>({textContent:value})},seed).owner.bio,'</script><img src=x onerror=alert(1)>');
  assert.equal(readGardenData({getElementById:()=>({textContent:'{broken'})},seed).owner.name,'Amubis');
});

test('editable copy preserves line breaks and small captions while treating arbitrary HTML as plain text',()=>{
  const doc={createTextNode:value=>({text:value}),createElement:tag=>({tag,children:[],append(child){this.children.push(child);}})};
  const target={ownerDocument:doc,children:[],replaceChildren(){this.children=[];},append(child){this.children.push(child);}};
  setGardenText(target,'Hi<br><small>caption</small><img src=x onerror=alert(1)>');
  assert.deepEqual(target.children,[{text:'Hi'},{tag:'br',children:[],append:target.children[1].append},{tag:'small',children:[{text:'caption'}],append:target.children[2].append},{text:'<img src=x onerror=alert(1)>'}]);
});

test('photo metadata provenance is not mistaken for a capture timestamp during draft save',()=>{
  const payload={...seed,media:[{id:'p',url:'media/photo.webp',takenAt:'2026-11-10T20:14:15',metadataSource:{takenAt:'filename',world:'VRCX',fileModifiedAt:'2026-11-11T20:00:00Z'}}]};
  assert.deepEqual(validateGardenContent(payload),[]);
  assert.equal(normalizeGardenContent(payload).media[0].takenAt,'2026-11-10T20:14:15');
  assert.equal(normalizeGardenContent(payload).media[0].metadataSource.takenAt,'filename');
});

test('the editable seed has valid bilingual copy, unique outfits and an owner profile',async()=>{
  const value=JSON.parse(await readFile(new URL('../data/garden.json',import.meta.url),'utf8'));
  assert.deepEqual(validateGardenContent(value),[]);assert.ok(value.owner.name);assert.ok('bio' in value.owner);
  assert.equal(new Set(value.outfits.map(item=>item.id)).size,value.outfits.length);
  for(const locale of ['zh','ja'])for(const group of ['site','album','outfits','owner','personal','comments','fixed'])assert.equal(typeof value.texts[group][locale],'object');
  assert.equal(typeof value.texts.comments.zh.nickname,'string');
});
