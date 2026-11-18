const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

/** Stable paper rectangles define a circular, distance-weighted inspection ripple. */
export function albumNeighborOffsets(rectangles = [], activeIndex = -1) {
  const zero = () => ({ x: 0, y: 0 });
  const active = rectangles[activeIndex];
  if (!active || ![active.x, active.y, active.width, active.height].every(Number.isFinite) || active.width <= 0 || active.height <= 0) return rectangles.map(zero);
  const centerX = active.x + active.width / 2, centerY = active.y + active.height / 2;
  const radius = Math.hypot(active.width, active.height) * 1.65;
  const strength = clamp(Math.min(active.width, active.height) * .1, 10, 20);
  return rectangles.map((rectangle, index) => {
    if (index === activeIndex || !rectangle || ![rectangle.x, rectangle.y, rectangle.width, rectangle.height].every(Number.isFinite)) return zero();
    const x = rectangle.x + rectangle.width / 2 - centerX;
    const y = rectangle.y + rectangle.height / 2 - centerY;
    const distance = Math.hypot(x, y);
    if (distance < .001 || distance >= radius) return zero();
    const remaining = 1 - distance / radius;
    const amount = strength * remaining * remaining * (3 - 2 * remaining);
    return { x: x / distance * amount, y: y / distance * amount };
  });
}
