// Below 860px the panel is a bottom sheet. It rests at 48% of the screen;
// dragging the handle moves it anywhere from just its header up to 85%, and
// letting go snaps to the nearest of those three. A tap (or Enter on the
// handle) toggles between resting and open. The map takes whatever height is
// left, and map.js's ResizeObserver re-measures it on every change.
const PHONE = window.matchMedia("(max-width: 859px)");
const RESTING = 0.48;
const OPEN = 0.85;

export function enableSheet(panel, handle) {
  let drag = null;

  const header = () => handle.offsetHeight + panel.querySelector(".panel-head").offsetHeight;
  const snaps = () => [header(), innerHeight * RESTING, innerHeight * OPEN];
  const isOpen = () => panel.offsetHeight > innerHeight * (RESTING + OPEN) / 2;

  function setHeight(px) {
    document.documentElement.style.setProperty("--sheet-height", `${Math.round(px)}px`);
    const open = px > innerHeight * (RESTING + OPEN) / 2;
    handle.setAttribute("aria-expanded", String(open));
    handle.setAttribute("aria-label", open ? "Shrink panel" : "Expand panel");
  }

  function toggle() {
    setHeight(innerHeight * (isOpen() ? RESTING : OPEN));
  }

  handle.addEventListener("pointerdown", (event) => {
    if (!PHONE.matches) return;
    handle.setPointerCapture(event.pointerId);
    drag = { y: event.clientY, height: panel.offsetHeight, moved: false };
    document.body.classList.add("sheet-dragging");
  });

  handle.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const rise = drag.y - event.clientY;
    if (Math.abs(rise) > 4) drag.moved = true;
    const [lowest, , highest] = snaps();
    setHeight(Math.min(highest, Math.max(lowest, drag.height + rise)));
  });

  const release = () => {
    if (!drag) return;
    document.body.classList.remove("sheet-dragging");
    if (drag.moved) {
      const now = panel.offsetHeight;
      setHeight(snaps().reduce((best, snap) => (Math.abs(snap - now) < Math.abs(best - now) ? snap : best)));
    } else {
      toggle();
    }
    drag = null;
  };
  handle.addEventListener("pointerup", release);
  handle.addEventListener("pointercancel", release);

  // Pointer taps are handled above; detail 0 means Enter or Space.
  handle.addEventListener("click", (event) => {
    if (event.detail === 0) toggle();
  });

  // Leaving phone width drops the dragged height so the desktop layout applies.
  PHONE.addEventListener("change", () => document.documentElement.style.removeProperty("--sheet-height"));

  // The detail drawer needs room, so opening it raises the sheet. Returns
  // whether the sheet moved, so callers can wait for the map to resize.
  return {
    expand() {
      if (!PHONE.matches || isOpen()) return false;
      setHeight(innerHeight * OPEN);
      return true;
    },
  };
}
