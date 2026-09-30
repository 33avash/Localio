import { escapeHtml, num } from "./format.js";
import { COMPETITION, COMPONENTS, CUSTOMERS } from "./score.js";

// "How it works": the data, the score, rent, the chat and the limits, in
// plain words. Every number is read from the pipeline's output.
export function methodHtml({ meta, wards, rent }) {
  const { reference_per_10k: reference } = meta.score;
  const customerRows = Object.values(CUSTOMERS).map((c) =>
    `<li>${c.label}: ${COMPONENTS.slice(0, 3).map((part) => `${part.label.toLowerCase()} ${num(c.weights[part.key])}`).join(", ")}</li>`);
  const competitionRows = Object.values(COMPETITION).map((c) => `${c.label.toLowerCase()} ${num(c.room)}`).join(", ");
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
      <p>Four parts, each from 0 to 1:</p>
      <ul class="plain">
        <li><strong>Residents</strong>: residents per km², as the ward's standing among Pune's 140 wards (0.8 means
          higher than 80% of them).</li>
        <li><strong>Eating out</strong>: food and drink places per km², of every kind: where people already go out.</li>
        <li><strong>Daytime draw</strong>: offices, colleges and stations per km²: what brings people in by day.</li>
        <li><strong>Low competition</strong>: your format's outlets per 10,000 residents against the rate in
          well-mapped wards (${num(reference.cafe.toFixed(2))} cafes, ${num(reference.fast_food.toFixed(2))} QSRs). It's 0.5
          at that rate and higher with fewer. Every count gets one extra, because OpenStreetMap misses outlets.</li>
      </ul>
      <p>Score = 100 × Σ(weight × part) ÷ Σ(weights), so each part adds 100 × its share of the weight × its value, and
        the parts add up to the score. Your brief sets the weights (0–5):</p>
      <ul class="plain">${customerRows.join("")}
        <li>Low competition: ${competitionRows}</li></ul>
      <p class="note">"Fine-tune the score" lets you set any weight yourself.</p>
      <p class="note">${num(few)} wards have under ${num(meta.min_outlets)} outlets mapped. They're scored, but hatched on
        the map and left off the shortlist unless you include them: that few usually means thin mapping, not an empty
        market.</p>
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
      <p>Localio reads your question (the wards it names, and any format, area, budget, shop size or customers such as
        "near offices") and works out the answer from the same data as the map. An AI assistant then words the reply
        from those facts only: your brief, how the score works, the top 5 and a card for each ward in question. The
        wards it names are checked against the data, and it declines anything that isn't about opening a cafe or QSR
        in Pune. If it can't answer, Localio gives its own answer instead. AI can still misread a question, so check
        a ward's numbers by clicking it.</p>
    </section>

    <section class="drawer-section">
      <h3>5. What it can't tell you</h3>
      <ul class="plain">
        <li>OpenStreetMap misses outlets, most of all in Pimpri-Chinchwad, so "no cafes" can mean "none mapped".</li>
        <li>Residents are 2011 Census totals shared across 2012 wards; Pimpri-Chinchwad has no voter roll, so its
          wards share equally and their residents per km² mostly reflect ward size.</li>
        <li>The score compares wards. It doesn't forecast sales, and rent is a guide, not a quote.</li>
        <li>It knows nothing about a particular shop: frontage, parking, the building, or the lease.</li>
      </ul>
    </section>`;
}
