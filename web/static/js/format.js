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

// Rupees the way Indian business writes them: ₹45k, ₹4.2L, ₹1.15Cr.
export function rupees(value) {
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value);
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${sign}₹${Math.round(abs / 1e3)}k`;
  return `${sign}₹${Math.round(abs)}`;
}

// A p10–p90 range in mono; a negative end is marked as a loss.
export function rupeeRange(low, high) {
  const part = (v) => `<span class="${v < 0 ? "neg" : ""}">${rupees(v)}</span>`;
  return `<span class="num">${part(low)}–${part(high)}</span>`;
}

export function percent(share, digits = 0) {
  return `${(share * 100).toFixed(digits)}%`;
}

// Mid-sentence forms; capitalise() them to start a line.
export const SIZE_LABELS = {
  cafe: { small: "small cafe", mid: "mid-sized cafe" },
  fast_food: { small: "small QSR", franchise: "QSR franchise" },
};

export function capitalise(text) {
  return text[0].toUpperCase() + text.slice(1);
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
