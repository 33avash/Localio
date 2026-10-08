import { CATEGORIES, escapeHtml, rupees } from "./format.js";
import { confidence, fitBand, shortlistCsv } from "./insight.js";
import { briefSentence } from "./panel.js";
import { monthlyRent, parts } from "./score.js";

// The shortlist as something to send: the link (which holds the whole
// brief), a plain-text summary, a CSV and a printable brief.
export function shareHtml({ plan, ranking, rent, meta }) {
  const top = ranking.slice(0, 5);
  return `
    <div class="dialog-body">
      <header class="dialog-head">
        <p class="eyebrow">Share analysis</p>
        <h2 id="share-title">Your location brief</h2>
        <button class="drawer-close" data-action="close-share" aria-label="Close sharing">×</button>
      </header>
      <div class="share-card">
        <p class="share-brief">${capFirst(briefSentence(plan))}. ${ranking.length} of 140 wards fit.</p>
        ${top.length ? `<ol class="share-list">${top.map(({ feature, score }) => {
          const p = feature.properties;
          return `<li><span class="share-name">${escapeHtml(p.name)}</span><span class="num">${Math.round(score)}</span>
            <span class="num">${rupees(monthlyRent(rent, p, plan.sqft))}/mo</span></li>`;
        }).join("")}</ol>` : "<p class=\"note\">No ward fits this brief yet.</p>"}
      </div>
      <code class="share-url" title="${escapeHtml(location.href)}">${escapeHtml(location.href)}</code>
      <div class="dialog-actions">
        <button class="primary compact" data-action="copy-link">Copy link</button>
        <button class="secondary compact" data-action="copy-summary">Copy summary</button>
        <button class="secondary compact" data-action="export-csv">Download CSV</button>
        <button class="secondary compact" data-action="print">Print brief</button>
        <span class="share-status" role="status" id="share-status"></span>
      </div>
      <p class="note">The link holds the whole brief, so it reopens this exact shortlist. Figures as of the
        ${escapeHtml(new Date(meta.generated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }))} build.</p>
    </div>`;
}

export function summaryText({ plan, ranking, rent, meta }) {
  const lines = ranking.slice(0, 5).map(({ feature, score }, i) => {
    const p = feature.properties;
    return `${i + 1}. ${p.name}: ${Math.round(score)}/100 (${fitBand(score).label}, ${confidence(p, meta).level} confidence), `
      + `about ${rupees(monthlyRent(rent, p, plan.sqft))} a month`;
  });
  return [`Localio location brief: ${capFirst(strip(briefSentence(plan)))}.`, `${ranking.length} of 140 wards fit.`, "",
    ...lines, "", location.href].join("\n");
}

// A one-page executive brief for paper or PDF, built from the same numbers.
export function printHtml({ plan, ranking, rent, meta }) {
  const c = CATEGORIES[plan.category];
  const rows = ranking.slice(0, 10).map(({ feature, score }, i) => {
    const p = feature.properties;
    const { items } = parts(p, plan.category, plan.weights);
    return `<tr><td class="n">${i + 1}</td><td>${escapeHtml(p.name)}<br><span class="meta">${p.corporation} ward ${p.ward_number}</span></td>
      <td class="n">${Math.round(score)}</td><td>${fitBand(score).label}</td>
      <td class="n">${items.map((item) => item.points.toFixed(0)).join(" + ")}</td>
      <td class="n">${rupees(monthlyRent(rent, p, plan.sqft))}</td><td>${confidence(p, meta).level}</td></tr>`;
  });
  return `
    <h1>Localio location brief</h1>
    <p class="meta">${capFirst(strip(briefSentence(plan)))}. ${ranking.length} of 140 wards fit. Data as of the
      ${new Date(meta.generated_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} build.</p>
    <h2>Shortlist</h2>
    <table><thead><tr><th>#</th><th>Ward</th><th>Score</th><th>Fit</th><th>Residents + eating out + daytime + competition</th>
      <th>Rent / month</th><th>Confidence</th></tr></thead><tbody>${rows.join("")}</tbody></table>
    <h2>How to read it</h2>
    <p>Scores are out of 100: four parts, each a ward's standing on residents, eating out, daytime draw and low ${c.one}
      competition, weighted by the brief. Rent = ₹${rent.typical_psf}/sq ft (median of ${rent.listings} listings) × the
      ward's tier × ${plan.sqft} sq ft.</p>
    <h2>Decision caveats</h2>
    <p>Visit first: the score can't see the street or the footfall. Outlets come from OpenStreetMap, which undercounts.
      Residents are 2011 figures. Rent is an estimate, not a quote. Localio makes no sales forecast.</p>
    <p class="meta">${escapeHtml(location.href)}</p>`;
}

export function downloadCsv(data) {
  const blob = new Blob([`﻿${shortlistCsv(data)}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), {
    href: url, download: `localio-${CATEGORIES[data.plan.category].slug}-shortlist.csv`,
  });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function strip(html) {
  return html.replace(/<[^>]+>/g, "");
}

function capFirst(text) {
  return text[0].toUpperCase() + text.slice(1);
}
