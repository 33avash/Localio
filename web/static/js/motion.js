// Motion is used in one place: when the lens changes, scores count to their
// new values and their bars resize, which shows the re-weighting did
// something. Anyone who asks for reduced motion gets the end state at once.
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)");
const DURATION_MS = 180;

export function reducedMotion() {
  return REDUCED.matches;
}

// rows: [{ element, bar, from, to, fromWidth, toWidth }]
export function animateScores(rows) {
  if (reducedMotion()) return;
  for (const row of rows) {
    row.bar.style.transition = "none";
    row.bar.style.width = `${row.fromWidth}%`;
  }
  requestAnimationFrame(() => {
    for (const row of rows) {
      row.bar.style.transition = "";
      row.bar.style.width = `${row.toWidth}%`;
    }
  });
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / DURATION_MS);
    for (const row of rows) row.element.textContent = (row.from + (row.to - row.from) * t).toFixed(1);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
