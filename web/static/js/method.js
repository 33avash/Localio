import { escapeHtml, num } from "./format.js";
import { LENSES } from "./score.js";

// "How it works": the data, the score, rent, the chat and the limits, in
// plain words. Every number is read from the pipeline's output.
export function methodHtml({ meta, wards, rent }) {
  const weights = Object.values(LENSES).map((l) =>
    `<li>${l.name}: busyness ${num(`${l.weights.demand * 100}%`)}, competition ${num(`${l.weights.competition * 100}%`)}</li>`);
  const tiers = Object.entries(rent.tiers).map(([tier, t]) => `<li>${tier}: ${num(`${t.multiplier}×`)}
    ${t.streets.length ? `(${t.streets.map((s) => `${escapeHtml(s.street)} ₹${s.rent_psf}`).join(", ")})` : "(no published street)"}</li>`);
  const few = wards.filter((f) => f.properties.status !== "scored").length;
  const [low, high] = rent.healthy_share;
  return `
    <header class="drawer-head">
      <button class="drawer-close" data-action="close-drawer" aria-label="Close how it works">×</button>
      <h2 id="drawer-title" tabindex="-1">How it works</h2>
      <p class="drawer-type">Where the numbers come from, and what they can't tell you</p>
    </header>

    <section class="drawer-section">
      <h3>1. The data</h3>
      <ul class="plain">
        <li>${num(wards.length)} wards: Pune (PMC) and Pimpri-Chinchwad (PCMC), from DataMeet's 2012 boundaries.</li>
        <li>Residents: the Census 2011 totals, shared between wards by the 2012 voter rolls (PMC) or equally (PCMC).</li>
        <li>${num(meta.outlets.toLocaleString("en-US"))} food and drink outlets, plus offices, colleges and stations,
          from OpenStreetMap. PostGIS puts each one in the ward whose boundary contains it.</li>
      </ul>
    </section>

    <section class="drawer-section">
      <h3>2. The score, out of 100</h3>
      <p><strong>Busyness</strong> is how a ward ranks against the others on three things, averaged: residents per
        km², food and drink outlets per km², and offices, colleges and stations per km².</p>
      <p><strong>Competition</strong> is your format's outlets per 10,000 residents, set against the city median:
        0 with none, 0.5 at the median, close to 1 when crowded.</p>
      <p>Score = 100 × (busyness weight × busyness + competition weight × (1 − competition)). The two parts are
        shown on every row as busyness points plus room (low-competition) points. The priority you pick sets the
        weights:</p>
      <ul class="plain">${weights.join("")}</ul>
      <p class="note">${num(few)} wards have under ${num(meta.min_outlets)} outlets. They're scored, but hatched on the
        map and left off the shortlist unless you include them: one missing outlet would move them a long way.</p>
    </section>

    <section class="drawer-section">
      <h3>3. Rent</h3>
      <p>Typical Pune shop rent is ₹${num(rent.typical_psf)} per sq ft a month: the median of ${num(rent.listings)}
        listings on <a href="${escapeHtml(rent.sources.listings.url)}" target="_blank" rel="noopener">Square Yards</a>.
        Each ward multiplies it by a tier, the tier's mean rent from
        <a href="${escapeHtml(rent.sources.streets.url)}" target="_blank" rel="noopener">Cushman &amp; Wakefield's</a>
        Q2 2026 high-street figures, over the mid tier's:</p>
      <ul class="plain">${tiers.join("")}</ul>
      <p class="note">Wards not on a published street take the middle tier of their admin zone; with none nearby,
        emerging (${num(`${rent.tiers.emerging.multiplier}×`)}, an assumption). The sales figure keeps rent at ${Math.round(low * 100)}–${Math.round(high * 100)}%
        of sales, the healthy share in <a href="${escapeHtml(rent.sources.rent_share.url)}" target="_blank" rel="noopener">DineOpen's</a>
        guide.</p>
    </section>

    <section class="drawer-section">
      <h3>4. The chat</h3>
      <p>The chat runs in your browser on the same data as the map. It reads the format, priority, area, budget or
        shop size from your question, answers with the numbers above, and names the wards it used, so every answer can be
        checked on the map. There's no language model: anything that isn't about opening a cafe or QSR in Pune is
        refused, not guessed.</p>
    </section>

    <section class="drawer-section">
      <h3>5. What it can't tell you</h3>
      <ul class="plain">
        <li>OpenStreetMap misses outlets, most of all in Pimpri-Chinchwad, so "no cafes" can mean "none mapped".</li>
        <li>Residents are 2011 figures; offices and new towers since then aren't in them.</li>
        <li>The score compares wards. It doesn't forecast sales, and rent is a guide, not a quote.</li>
      </ul>
    </section>`;
}
