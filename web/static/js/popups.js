import { CATEGORIES, escapeHtml, num } from "./format.js";

export function outletPopup({ name, category, locality, avg_rating, review_count, is_chain }) {
  const rating = avg_rating === null ? "No rating yet" : `${num(avg_rating.toFixed(1))}★`;
  const reviews = `${num(review_count.toLocaleString("en-US"))} ${review_count === 1 ? "review" : "reviews"}`;
  return `
    <h3>${escapeHtml(name)}</h3>
    <p class="popup-sub">${CATEGORIES[category].label} · ${is_chain ? "Chain" : "Independent"} · ${escapeHtml(locality)}</p>
    <p>${rating} · ${reviews}</p>`;
}
