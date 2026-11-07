import test from 'node:test';
import assert from 'node:assert/strict';
import {coverScale,exploreGrowthFrames} from '../src/motion.js';

test('clover cover includes the farthest viewport corner from off-center clicks',()=>{
  for(const point of [{x:0,y:0},{x:720,y:450},{x:1400,y:850}]){
    const scale=coverScale(point,{width:1440,height:900});
    for(const x of [0,1440])for(const y of [0,900])assert.ok(scale*12>=Math.hypot(point.x-x,point.y-y));
  }
});
test('explore expansion starts as a visible point and consistently accelerates in radius',()=>{
  const frames=exploreGrowthFrames(70);
  const radius=frames.map(frame=>Number(frame.transform.match(/scale\(([^)]+)\)/)[1]));
  assert.equal(radius[0],.035);assert.equal(radius.at(-1),70);
  assert.equal(frames[0].offset,0);assert.equal(frames.at(-1).offset,1);
  const deltas=radius.slice(1).map((r,i)=>r-radius[i]);
  for(let i=1;i<deltas.length;i++)assert.ok(deltas[i]>deltas[i-1]);
  assert.ok(radius[Math.floor(radius.length/3)]<4,'the first third remains visibly small');
});
