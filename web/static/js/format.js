// The data says "fast_food"; people say "QSR". Every category label in the
// UI comes from here, so the raw tag never reaches the screen.
export const CATEGORIES = {
  cafe: { slug: "cafe", label: "Cafe", one: "cafe", many: "cafes", note: "" },
  fast_food: { slug: "qsr", label: "QSR", one: "QSR", many: "QSRs", note: "quick-service restaurants" },
};

export function otherCategory(category) {
  return category === "cafe" ? "fast_food" : "cafe";
}

// Numbers are set in the mono face; prose stays in the sans.
export function num(value) {
  return `<span class="num">${value}</span>`;
}

// Rupees the way Indian business writes them: ₹45k, ₹4.2L.
export function rupees(value) {
  if (value >= 1e5) return `₹${(value / 1e5).toFixed(1)}L`;
  if (value >= 1e3) return `₹${Math.round(value / 1e3)}k`;
  return `₹${Math.round(value)}`;
}

export function plural(n, one, many) {
  return `${num(n.toLocaleString("en-US"))} ${n === 1 ? one : many}`;
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
