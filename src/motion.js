/** A conservative inscribed radius keeps the clover's notches past every edge. */
export function coverScale(point, viewport, innerRadius = 12) {
  const x = Math.max(point.x, viewport.width - point.x);
  const y = Math.max(point.y, viewport.height - point.y);
  return Math.max(1, (Math.hypot(x, y) + 12) / Math.max(1, innerRadius));
}

/** Explicit radius progression avoids the early speed burst of an ease-out. */
export function exploreGrowthFrames(finalScale, steps = 28) {
  const count = Math.max(4, Math.round(steps));
  const end = Math.max(.035, finalScale);
  return Array.from({length:count+1}, (_,index) => {
    const progress=index/count;
    const scale=.035+(end-.035)*progress**2.8;
    const rotation=-10*(1-progress);
    return {offset:progress,transform:`translate(-50%,-50%) scale(${scale}) rotate(${rotation}deg)`};
  });
}
export const EXPLORE_TIMING = Object.freeze({bump:180,collapse:320,hold:70,grow:820,reveal:180});
