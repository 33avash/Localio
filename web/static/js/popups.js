import { CATEGORIES, escapeHtml } from "./format.js";

const FORMAT_LABELS = { ...Object.fromEntries(Object.entries(CATEGORIES).map(([k, c]) => [k, c.label])), restaurant: "Restaurant" };

export function outletPopup({ name, category, ward, brand, menu }) {
  return `
    <h3>${escapeHtml(name ?? "Unnamed outlet")}</h3>
    <p class="popup-sub">${FORMAT_LABELS[category] ?? category} · ${brand ? escapeHtml(brand) : "Independent"}</p>
    <p>${escapeHtml(menu)} · ${escapeHtml(ward)}</p>`;
}
