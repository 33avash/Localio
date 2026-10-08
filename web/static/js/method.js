import { escapeHtml, num } from "./format.js";
import { FIT_BREAKS, FIT_LABELS, freshness } from "./insight.js";
import { COMPETITION, COMPONENTS, CUSTOMERS } from "./score.js";

// Methodology: how every number is made, where it comes from and what it
// can't tell you. Every figure is read from the pipeline's output.
export function methodHtml({ meta, wards, rent }) {
  const { reference_per_10k: reference } = meta.score;
  const customerRows = Object.values(CUSTOMERS).map((c) =>
    `<li>${c.label}: ${COMPONENTS.slice(0, 3).map((part) => `${part.label.toLowerCase()} ${num(c.weights[part.key])}`).join(", ")}</li>`);
  const competitionRows = Object.values(COMPETITION).map((c) => `${c.label.toLowerCase()} ${num(c.room)}`).join(", ");
  const tiers = Object.entries(rent.tiers).map(([tier, t]) => `<li>${tier}: ${num(`${t.multiplier}×`)}
    ${t.streets.length ? `(${t.streets.map((s) => `${escapeHtml(s.street)} ₹${s.rent_psf}`).join(", ")})` : "(no published street)"}</li>`);
  const few = wards.filter((f) => f.properties.status !== "scored").length;
  const [low, high] = rent.healthy_share;
  const bands = FIT_LABELS.map((label, i) => {
    const lo = FIT_BREAKS[i - 1];
    const hi = FIT_BREAKS[i];
    return `${label} ${num(lo === undefined ? `under ${hi}` : hi === undefined ? `${lo}+` : `${lo}–${hi - 1}`)}`;
  }).join(" · ");
  return `
    <header class="drawer-head">
      <button class="drawer-close" data-action="close-drawer" aria-label="Close the methodology">×</button>
      <p class="eyebrow">Methodology</p>
      <h2 id="drawer-title" tabindex="-1">How Localio works</h2>
      <p class="drawer-type">Where every number comes from, how it's combined, and what it can't tell you</p>
    </header>
    <!-- Buttons, not #links: the URL's hash holds the brief. -->
    <ul class="method-index">
      <li><button class="text-button" data-action="jump" data-value="method-sources">Data sources</button></li><li><button class="text-button" data-action="jump" data-value="method-score">Scoring</button></li>
      <li><button class="text-button" data-action="jump" data-value="method-competition">Competition</button></li><li><button class="text-button" data-action="jump" data-value="method-confidence">Confidence</button></li>
      <li><button class="text-button" data-action="jump" data-value="method-rent">Rent</button></li><li><button class="text-button" data-action="jump" data-value="method-limits">Limitations</button></li>
      <li><button class="text-button" data-action="jump" data-value="method-refresh">Refresh</button></li><li><button class="text-button" data-action="jump" data-value="method-analyst">Analyst</button></li>
    </ul>

    <section class="drawer-section">
      <h3>In one paragraph</h3>
      <p>A pipeline reads committed copies of public data, places every outlet, office, college and station in its
        ward with PostGIS, scores all ${num(wards.length)} wards on four parts, assigns each a rent tier, and runs
        checks. If any check fails, nothing is published. The site then re-weights those parts for your brief in the
        browser, so every ranking is instant and reproducible, and the analyst answers from the same files.</p>
    </section>

    <section class="drawer-section" id="method-sources">
      <h3>1. Data sources</h3>
      <ul class="source-list">${(meta.sources ?? []).map((s) => source(s, meta.generated_at)).join("")}</ul>
      <p class="note">Freshness is measured from this build (${escapeHtml(new Date(meta.generated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }))}):
        high within a year, medium within five, low beyond.</p>
    </section>

    <section class="drawer-section" id="method-score">
      <h3>2. The score, out of 100</h3>
      <p>Four parts, each from 0 to 1:</p>
      <ul class="plain">
        <li><strong>Residents</strong>: residents per km², as the ward's standing among Pune's 140 wards (0.8 means
          higher than 80% of them).</li>
        <li><strong>Eating out</strong>: food and drink places per km², of every kind: where people already go out.</li>
        <li><strong>Daytime draw</strong>: offices, colleges and stations per km²: what brings people in by day.</li>
        <li><strong>Low competition</strong>: your format's outlets per 10,000 residents against the rate in
          well-mapped wards (see below).</li>
      </ul>
      <p class="formula">score = 100 × Σ(weight × part) ÷ Σ(weights)</p>
      <p>Each part adds 100 × its share of the weight × its value, so the parts always add up to the score. Your brief
        sets the weights (0–5):</p>
      <ul class="plain">${customerRows.join("")}
        <li>Low competition: ${competitionRows}</li></ul>
      <p class="note">"Adjust the model" sets any weight yourself. Fit labels are fixed score bands, the same as the
        map's colours: ${bands}.</p>
      <p class="note">${num(few)} wards have under ${num(meta.min_outlets)} outlets mapped. They're scored, but hatched on
        the map and left off the shortlist unless you include them: that few usually means thin mapping, not an empty
        market.</p>
    </section>

    <section class="drawer-section" id="method-competition">
      <h3>3. Competition</h3>
      <p>Competition is your format's outlets per 10,000 residents, x, with one extra outlet added to every count
        because OpenStreetMap misses outlets. It's compared with r, the rate across the ${num(wards.length - few)}
        well-mapped wards: ${num(reference.cafe.toFixed(2))} cafes and ${num(reference.fast_food.toFixed(2))} QSRs per 10,000.</p>
      <p class="formula">low competition = 1 − x ÷ (x + r)</p>
      <p>It's 0.5 at the reference rate, higher with fewer. In words: none mapped, light (up to half the reference),
        average (up to 1.5×), heavy (above).</p>
    </section>

    <section class="drawer-section" id="method-confidence">
      <h3>4. Confidence</h3>
      <p>Every ward gets High, Medium or Low confidence from three signals in the data:</p>
      <ul class="plain">
        <li><strong>Outlets</strong>: ${num(meta.min_outlets)} or more mapped, or thin.</li>
        <li><strong>Residents</strong>: the Census 2011 total shared by the ward's 2012 voter roll, or an equal share
          (all of Pimpri-Chinchwad, which has no roll).</li>
        <li><strong>Rent</strong>: on a published high street, or its zone's tier.</li>
      </ul>
      <p>High: all three solid. Medium: outlets solid and one other weak. Low: thin outlets, or both others weak. It
        describes the data, not the ward: a Low-confidence ward can be a fine site that needs checking on foot.</p>
    </section>

    <section class="drawer-section" id="method-rent">
      <h3>5. Rent</h3>
      <p>Typical Pune shop rent is ₹${num(rent.typical_psf)} per sq ft a month: the median of ${num(rent.listings)}
        listings on <a href="${escapeHtml(rent.sources.listings.url)}" target="_blank" rel="noopener">Square Yards</a>.
        Each ward multiplies it by a tier, the tier's mean rent from
        <a href="${escapeHtml(rent.sources.streets.url)}" target="_blank" rel="noopener">Cushman &amp; Wakefield's</a>
        Q2 2026 high-street figures over the mid tier's:</p>
      <ul class="plain">${tiers.join("")}</ul>
      <p class="formula">monthly rent = ₹${rent.typical_psf} × tier × sq ft</p>
      <p class="note">Wards not on a published street take the middle tier of their admin zone; with none nearby,
        emerging (${num(`${rent.tiers.emerging.multiplier}×`)}, an assumption). "Sales needed" keeps rent at
        ${Math.round(low * 100)}–${Math.round(high * 100)}% of sales, the healthy share in
        <a href="${escapeHtml(rent.sources.rent_share.url)}" target="_blank" rel="noopener">DineOpen's</a> guide. The
        drawer's calculator is arithmetic on your own assumptions, not a forecast.</p>
    </section>

    <section class="drawer-section" id="method-limits">
      <h3>6. Limitations</h3>
      <ul class="plain">
        <li>OpenStreetMap misses outlets, most of all in Pimpri-Chinchwad, so "no cafes" can mean "none mapped".</li>
        <li>Residents are 2011 Census totals shared across 2012 wards; Pimpri-Chinchwad has no voter roll, so its
          wards share equally and their residents per km² mostly reflect ward size.</li>
        <li>The score compares wards. It doesn't forecast sales, and rent is a guide, not a quote.</li>
        <li>It knows nothing about a particular shop: frontage, parking, the building, or the lease.</li>
        <li>There is no footfall data: daytime draw and eating out stand in for it.</li>
      </ul>
    </section>

    <section class="drawer-section" id="method-refresh">
      <h3>7. Refresh and checks</h3>
      <p>Every input is committed, so a build never needs the network. Refreshing OpenStreetMap is one command
        (<code>docker compose run --rm osm --refresh</code>); the next build re-places, re-scores and re-checks
        everything. The pipeline refuses to publish if the ward count, populations, outlet counts, scores, sentences,
        rent tiers or this source registry fail their checks.</p>
    </section>

    <section class="drawer-section" id="method-analyst">
      <h3>8. The analyst</h3>
      <p>Localio reads your question (the wards it names, and any format, area, budget, shop size or customers such as
        "near offices") and works out the answer from the same data as the map. An AI assistant then words the reply
        from those facts only: your brief, how the score works, the top 5 and a card for each ward in question. The
        wards it names are checked against the data, and it declines anything that isn't about opening a cafe or QSR
        in Pune. If it can't answer, Localio gives its own answer instead. "Show evidence" lists the figures behind an
        answer, computed by Localio, not by the assistant. AI can still misread a question, so check a ward's numbers
        by clicking it.</p>
    </section>

    <section class="drawer-section">
      <h3>9. Licences</h3>
      <p class="section-sub">${escapeHtml(meta.licence)}. Rent figures are published figures, cited with their sources.
        Localio's code is MIT licensed.</p>
    </section>`;
}

function source(s, builtAt) {
  const f = freshness(s.as_of, builtAt);
  return `
    <li class="source">
      <div class="source-head">
        <p class="source-name">${escapeHtml(s.source_name)}</p>
        <span class="badge fresh-${f.level.toLowerCase()}">${f.level} freshness</span>
      </div>
      <dl>
        <dt>Dataset</dt><dd>${escapeHtml(s.dataset_name)}</dd>
        <dt>Used for</dt><dd>${escapeHtml(s.use)}</dd>
        <dt>As of</dt><dd class="num">${escapeHtml(f.label)} · retrieved ${escapeHtml(s.retrieved_at)}</dd>
        <dt>Coverage</dt><dd>${escapeHtml(s.coverage)}</dd>
        <dt>Updated</dt><dd>${escapeHtml(s.update_frequency)}</dd>
        <dt>Licence</dt><dd>${escapeHtml(s.licence)}</dd>
        <dt>Confidence</dt><dd>${escapeHtml(s.confidence)}</dd>
        <dt>Link</dt><dd><a href="${escapeHtml(s.source_url)}" target="_blank" rel="noopener">${escapeHtml(s.source_url.replace(/^https?:\/\//, ""))}</a></dd>
      </dl>
      <p class="source-note">${escapeHtml(s.notes)}</p>
    </li>`;
}
