// Motion is used where it explains a change: when an input re-ranks the
// shortlist, rows glide to their new places and each score counts from its
// old value to its new one. Anyone who asks for reduced motion gets the end
// state at once.
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)");
const DURATION_MS = 240;
// A gentle spring, as a CSS linear() curve: settles with a hint of overshoot.
const SPRING = "linear(0, 0.18 7%, 0.56 18%, 0.86 30%, 1.02 42%, 1.05 50%, 1.02 62%, 1 76%, 1)";

export function reducedMotion() {
  return REDUCED.matches;
}

// items: [{ element, from, to }]
export function countUp(items) {
  if (reducedMotion()) return;
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / DURATION_MS);
    const eased = 1 - (1 - t) ** 3;
    for (const { element, from, to } of items) element.textContent = Math.round(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// FLIP: measure where keyed elements are, let the DOM change, then animate
// each from its old place to its new one. New rows fade up into place.
// measure() before the re-render; play(measured) after it.
export function measure(elements) {
  return new Map([...elements].map((el) => [el.dataset.name, el.getBoundingClientRect()]));
}

export function play(before, elements) {
  if (reducedMotion() || !before.size) return;
  for (const el of elements) {
    const was = before.get(el.dataset.name);
    const now = el.getBoundingClientRect();
    if (!was) {
      el.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }],
        { duration: DURATION_MS, easing: "ease-out" });
      continue;
    }
    const dy = was.top - now.top;
    if (Math.abs(dy) < 1) continue;
    el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 420, easing: SPRING });
  }
}
