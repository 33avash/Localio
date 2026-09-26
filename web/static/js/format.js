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

export function counted(n, category) {
  const { one, many } = CATEGORIES[category];
  return `${num(n)} ${n === 1 ? one : many}`;
}

export function compact(n) {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 100000 ? 1 : 0)}k`;
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
