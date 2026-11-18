import test from 'node:test';
import assert from 'node:assert/strict';
import {createAlbumPageMotion,albumPagePhotoDelay,albumPagePhotoFrames,albumPageDateFrames,albumPhotoEntryFrames,ALBUM_PHOTO_ENTRY_EASING} from '../src/album-page-motion.js';
function fixture(t,{withDate=false}={}){
 const handlers=new Map(),attrs=new Map(),animations=[],frames=new Map();let serial=0,reduced=false,active=true,commits=0;
 const target=()=>({addEventListener(k,f){if(!handlers.has(this))handlers.set(this,new Map());handlers.get(this).set(k,f);},removeEventListener(k){handlers.get(this)?.delete(k);}});
 const doc=target(),win=target();doc.defaultView=win;doc.hidden=false;win.getComputedStyle=()=>({transform:'none'});win.requestAnimationFrame=f=>{frames.set(++serial,f);return serial;};win.cancelAnimationFrame=i=>frames.delete(i);
 const photo=(target='photo')=>({animate(keyframes,options){let resolve,reject;const a={target,keyframes,options,cancelled:false,finished:new Promise((y,n)=>{resolve=y;reject=n;}),finish:()=>resolve(),cancel(){this.cancelled=true;reject(new Error('cancel'));}};animations.push(a);return a;}});
 const date=withDate?photo('date'):null;
 let photos=[photo(),photo(),photo()];const root={ownerDocument:doc,getAttribute:k=>attrs.get(k)??null,setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k),querySelectorAll:()=>photos,querySelector:selector=>selector==='.album-date-mark'?date:null};
 const api=createAlbumPageMotion({root,reducedMotion:()=>reduced,isActive:()=>active});t.after(()=>api.destroy());
 const commit=()=>{commits++;photos=[photo(),photo()];};
 return{api,doc,animations,attrs,frames,commit,get commits(){return commits;},set reduced(v){reduced=v;},hide(){doc.hidden=true;handlers.get(doc).get('visibilitychange')();}};
}
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
test('page-turn timing remains bounded and frames peel and stick from the top edge',()=>{
 assert.ok(albumPagePhotoDelay(11,12)<=90);assert.ok(albumPagePhotoDelay(1,12)>0);
 const peel=albumPagePhotoFrames('peel'),stick=albumPagePhotoFrames('stick');
 assert.equal(peel.at(-1).opacity,0);assert.equal(stick[0].opacity,0);assert.equal(stick.at(-1).opacity,1);assert.match(peel.at(-1).transform,/rotateX/);assert.equal(stick[0].transformOrigin,'50% 6%');
 assert.deepEqual(stick,albumPhotoEntryFrames());
 const scales=stick.flatMap(frame=>[...frame.transform.matchAll(/scale\(([\d.]+)\)/g)].map(match=>Number(match[1])));
 assert.ok(scales.every(scale=>scale<=1.004),'page changes never magnify beyond the chapter entrance settle');
});
test('old prints peel before the next DOM commits and new prints stick afterwards',async t=>{
 const f=fixture(t),p=f.api.run(f.commit);assert.equal(f.api.state,'peeling');assert.equal(f.commits,0);
 f.animations.slice().forEach(a=>a.finish());await tick();assert.equal(f.commits,1);assert.equal(f.api.state,'sticking');
 assert.deepEqual(f.animations[3].keyframes,albumPhotoEntryFrames());assert.equal(f.animations[3].options.easing,ALBUM_PHOTO_ENTRY_EASING);
 f.animations.slice(3).forEach(a=>a.finish());await tick();assert.equal(await p,true);assert.equal(f.api.state,'idle');assert.equal(f.frames.size,0);
});
test('dates move left to right on the same page clock and release their fills after sticking',async t=>{
 const f=fixture(t,{withDate:true}),p=f.api.run(f.commit);
 const exit=f.animations.find(a=>a.target==='date');
 assert.deepEqual(exit.keyframes,albumPageDateFrames('peel'));
 assert.equal(exit.options.duration,240);
 assert.notEqual(exit.options.easing,'linear');
 f.animations.filter(a=>a.target==='photo').forEach(a=>a.finish());await tick();
 assert.equal(f.commits,0,'old date and prints must finish together before replacement');
 exit.finish();await tick();assert.equal(f.commits,1);assert.equal(f.api.state,'sticking');
 const entry=f.animations.filter(a=>a.target==='date').at(-1);
 assert.deepEqual(entry.keyframes,albumPageDateFrames('stick'));
 assert.match(entry.keyframes[0].transform,/translateX\(-42px\)/);
 assert.match(exit.keyframes.at(-1).transform,/translateX\(36px\)/);
 assert.ok(entry.keyframes.every(frame=>!frame.transform.includes('rotate')),'CSS rotation belongs to the stationary date');
 f.animations.filter(a=>!a.cancelled).forEach(a=>a.finish());await tick();
 assert.equal(await p,true);assert.equal(f.api.state,'idle');assert.ok(f.animations.every(a=>a.cancelled));
});
test('cancelling a date transition clears hidden fills without committing the obsolete date',async t=>{
 const f=fixture(t,{withDate:true}),p=f.api.run(f.commit);
 f.api.cancel({commitPending:false});assert.equal(await p,false);assert.equal(f.commits,0);
 assert.ok(f.animations.some(a=>a.target==='date'));
 assert.ok(f.animations.every(a=>a.cancelled));assert.equal(f.frames.size,0);
 f.reduced=true;assert.equal(await f.api.run(f.commit),true);assert.equal(f.commits,1);
 assert.equal(f.animations.length,4,'reduced motion adds no date or photo animation');
});
test('an unchanged date skips its exit and entry while photographs keep the page choreography',async t=>{
 const f=fixture(t,{withDate:true}),p=f.api.run(f.commit,{animateDate:false});
 assert.equal(f.api.state,'peeling');assert.equal(f.animations.length,3);assert.ok(f.animations.every(a=>a.target==='photo'));
 f.animations.slice().forEach(a=>a.finish());await tick();assert.equal(f.commits,1);assert.equal(f.api.state,'sticking');
 assert.equal(f.animations.length,5);assert.ok(f.animations.every(a=>a.target==='photo'));
 f.animations.filter(a=>!a.cancelled).forEach(a=>a.finish());await tick();assert.equal(await p,true);assert.equal(f.api.state,'idle');
});
test('rapid requests discard stale commits and hidden pages complete only the latest page',async t=>{
 const f=fixture(t),first=f.api.run(f.commit),second=f.api.run(f.commit);assert.equal(await first,false);assert.equal(f.commits,0);
 f.hide();assert.equal(await second,true);assert.equal(f.commits,1);assert.equal(f.api.busy,false);assert.equal(f.frames.size,0);
});
test('reduced motion commits synchronously and explicit cancellation never leaks an old page',async t=>{
 const f=fixture(t);f.reduced=true;assert.equal(await f.api.run(f.commit),true);assert.equal(f.commits,1);assert.equal(f.animations.length,0);
 f.reduced=false;const p=f.api.run(f.commit);f.api.cancel({commitPending:false});assert.equal(await p,false);assert.equal(f.commits,1);
});
test('destroy drops obsolete pending commits and prevents further work',async t=>{
 const f=fixture(t),p=f.api.run(f.commit);f.api.destroy();assert.equal(await p,false);assert.equal(f.commits,0);assert.equal(await f.api.run(f.commit),false);assert.equal(f.frames.size,0);
});
