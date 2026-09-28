// Motion is used in one place: when an input re-ranks the shortlist, each
// score counts from its old value to its new one, which shows the change
// did something. Anyone who asks for reduced motion gets the end state.
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)");
const DURATION_MS = 180;

export function reducedMotion() {
  return REDUCED.matches;
}

// items: [{ element, from, to }]
export function countUp(items) {
  if (reducedMotion()) return;
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / DURATION_MS);
    for (const { element, from, to } of items) element.textContent = Math.round(from + (to - from) * t);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
