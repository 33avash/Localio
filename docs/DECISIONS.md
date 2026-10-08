# Decisions

The main choices behind Localio, and why. Each one is small enough to defend in a sentence.

## Data

**Real wards, not home-made areas.** Earlier versions drew Voronoi "catchments" around outlets, which gave triangles and a Koregaon Park of 294,000 people. DataMeet's 140 electoral wards are official boundaries, and residents come from the Census 2011 totals: shared by the 2012 voter rolls in PMC, and equally in PCMC, which has no roll.

**OpenStreetMap, not Google Places.** OSM has about six times as many outlets (1,702 in the wards against 260), and its licence (ODbL) allows redistribution. Google's terms don't, so the Google table was removed.

**Outlets are placed by boundary, in PostGIS.** `ST_Contains` puts each outlet in the ward that contains it. Matching by place name would silently misplace outlets.

**Everything is cached in `seed_data/`.** The OSM and population tools run once over the network. A normal build never goes online, so it runs the same everywhere.

**Every source in one registry.** `seed_data/sources.json` gives each dataset its use, coverage, dates, update frequency, licence and a confidence with the reason. OpenStreetMap's dates are filled from the cached files, so they can't drift, and the pipeline refuses to publish if any field is blank. The site's Methodology view and each ward's data-quality table read it, with freshness measured from the build date (within a year high, within five medium, older low), so the Census reads as old because it is.

## Scoring

**A transparent index, not a model.** An earlier version trained a quantile regression to predict outlet density. It beat its baseline but explained only 22% of the variation. Four parts a user can see and weigh tell them as much, and each can be explained in a sentence.

**Four parts, each shown with its points.** Residents, eating out, daytime draw and low competition. An earlier version folded the first three into one "busyness" number; splitting them lets someone who cares about office workers say so, and every row and drawer shows what each part added.

**Two plain questions set the weights.** "Who are your customers?" and "How much competition can you take?" are questions a cafe founder can answer; "weight daytime draw 3 of 5" isn't. Each customer answer weights the one measure of people that fits it (all three for a mix), and each competition answer sets the low-competition weight. An earlier version weighted the matching part 3 and the others 1; the old city's peths lead on all three, so the answer barely changed the list. Sliders stay behind "Fine-tune" for anyone who wants them.

**Competition against well-mapped wards.** The first version compared each ward with the city median, 0.23 cafes per 10,000 residents, dragged down by 100 wards where OpenStreetMap maps almost nothing; 72% of shortlistable wards then read as "heavy competition". The reference is now the rate across the 40 wards with 10 or more outlets mapped (2.49 cafes per 10,000).

**"None mapped" isn't "none at all".** Every count gets one extra outlet before competition is measured. Without it, the two wards with no cafes mapped took full marks and led every list.

**Wards need 10 outlets to be shortlisted.** With 4, the list was led by wards like Kadakmal Ali Hirabaug, next to Swargate, with 34,000 residents and 4 mapped outlets: gaps in the map, not the market. The other wards stay on the map, hatched.

**Explain the score; don't re-model it.** Fit labels, confidence, strengths and risks, sensitivity, "what changed" and the market view are all read from the same four parts (`insight.js`). None of them changes a score, and the browser still reproduces all 280 pipeline scores. Rent stays out of the score: it's a constraint you set, not a quality of the ward, and folding it in would hide the trade-off that Compare shows.

**Confidence describes the data, not the ward.** Three signals, each already in the data: outlet coverage, how residents were estimated, and whether rent comes from a published street. A Low-confidence ward can be a fine site; it needs checking on foot. Of the 40 shortlistable wards, 10 are High, 18 Medium and 12 Low, all 12 in Pimpri-Chinchwad, which has no voter roll and no published street.

**Sensitivity is the same ranking, re-run.** A ward's rank under other rent ceilings and competition settings is `rank()` with that one value changed, so it can never disagree with what the shortlist would show.

**Scored from the published numbers.** The pipeline rounds each part to the 4 decimals it publishes before scoring, so the browser, working from the same file, reproduces every score exactly; a test checks all 280.

## Rent

**Rent only, no sales forecast.** Rent has published sources: Cushman & Wakefield's high-street rents and real listings. A sales or profit forecast would rest on numbers invented for the purpose, so Localio doesn't make one. It shows the sales needed to keep rent to the 8–15% of sales that restaurant guides call healthy.

**Tiers from the published streets.** Each tier's multiplier is its mean street rent over the mid tier's. A ward on a published street takes that street's tier. Any other ward takes the middle tier of its admin zone, and says it's estimated.

## Containers

**Three services with a strict start order.** `data` waits for a healthy `db`, and `web` waits for `data` to succeed. A failed check means no site, never a site with bad numbers.

**No stale state anywhere.** tmpfs for the database, a bind mount (not a volume) for `./output`, and `no-store` on `/data/`.

**Vendored front-end assets.** Leaflet and the fonts are committed, so a demo doesn't depend on a CDN.

**Published by the same containers.** GitHub Actions runs `docker compose run data` and publishes the site with its output to GitHub Pages, so the live link shows exactly what the pipeline produced and checked.

## Front end

**Say what it's for, and what it can't do, where people decide.** An intro states the purpose until it's dismissed, and the decision caveats sit under every shortlist, not in a drawer, because the limits matter most at the moment of choosing.

**One screen, not a wizard.** The brief sits above the shortlist, and every answer re-ranks at once. Earlier versions walked through four steps; one screen shows cause and effect directly. The steps are numbered, but nothing is hidden behind a "generate" button.

**Say what changed.** Every change of brief gets a strip naming the change, the wards that entered and left the top 5, and the biggest mover with the reason from the data ("it was left out before: rent over your budget"). A baseline can be pinned to compare later briefs against it.

**No loading theatre.** Ranking 140 wards takes milliseconds. A staged "analysing… mapping demand…" sequence would be pretending, so the only loading state is the real fetch of the data files.

**The map shows the score for your brief.** Wards are shaded by their score in fixed bands, so a colour always means the same score, and wards the brief rules out (area, rent, thin data) turn grey with the reason on hover. Six other layers are one click away: competition, rent tier, daytime draw, eating out, residents and data confidence. In the fit layer, clicking a legend band shows only those wards.

**Every score shows its parts.** Each row shows the points from each of the four parts, which add up to its score, so a ranking is never a bare number.

**Compare, because a shortlist is for choosing.** The top 3 side by side, any column swappable, with the best value in each row marked.

**Plain ES modules, no build step.** The site is a few small modules; a bundler would add a toolchain to install and break. React was considered and isn't needed: the motion the site uses (rows sliding to their new rank, scores counting, drawers opening, layers fading) is about 50 lines of Web Animations and CSS, and all of it stops for anyone who asks for reduced motion.

**A ward's drawer covers the panel; reading views widen.** A ward's analysis slides over the panel so its outline stays visible on the map. Compare, Market and Methodology are reading views with tables and charts, so on a large screen they widen over part of the map.

**Two themes, and glass only over the map.** Bone paper and ink, or graphite at night, following the system setting until a choice is made. Translucent surfaces are kept for what floats over the map (layers, legend, the command palette); analysis, tables and long text sit on solid surfaces. Every view is checked at 4.5:1 contrast in both themes.

**Two typefaces, both vendored.** IBM Plex Sans for everything you read, IBM Plex Mono with tabular digits for every figure, so numbers line up in columns and read as data. A display serif was tried for place names and dropped: it added a third voice without adding clarity.

**Layers only from data that exists.** Each map layer is a value the pipeline already publishes. Footfall and roads were left out because there is no data for them, and search covers ward names and the places inside them, not colleges or stations, which aren't in the published files.

**Scenario arithmetic, labelled as such.** The drawer's calculator turns rent into the sales and orders a day you'd need, using an average ticket and days open that you set. It's marked "scenario calculation, not a forecast", because that's what it is.

**The URL is the brief.** Format, area, answers, size and budget live in the hash, so a copied link reopens the same shortlist. Links from before the brief still open their format and area.

## Chat

**Localio decides, the AI words it.** Localio's engine parses each question and works out the answer from the ward data; an AI model (Gemini) only turns those facts into a reply. It sees nothing but the facts for that question, so it can't bring in outside claims about Pune, and every ward it names is checked against the data.

**The site doesn't name the model.** To a user it's Localio's assistant: the answers are Localio's, from Localio's data, and naming a vendor adds nothing to them. The "How it works" drawer says an AI words the replies and can misread a question; the docs name the model for anyone running it.

**Facts for the plan the question implies.** "Rent there for 400 sq ft" gets cards computed at 400 sq ft, not 300, so the model quotes a figure from the data instead of scaling one itself (it once said ₹41,333 where the data says ₹40,700).

**Called from the browser, with a fast model first.** The site is static on GitHub Pages, so there's no server to hold the key. `gemini-3.5-flash-lite` answers first; `gemini-3.5-flash` takes over when it's busy. The key is therefore public, so it's a free-tier key restricted to the site's address, with a limit of 8 questions a minute per visitor.

**Always a fallback.** No key, a busy model or a reply that fails its checks means the engine's own answer. The engine is rule-based: it finds ward names (official titles and the places inside each ward), reads format, area, budget, size and customers from the question, and picks one of a few answer types (a ward, a comparison, why, rent, a ranking, gaps, the method). Tests never call the real model; they mock it.

**The same files as the map.** The chat reads the ward data the map uses, so the two can't disagree; a test checks the chat's top 5 equals the map's for every plan it's asked about.

**Refuse instead of guessing.** A question must name a ward or use a domain word (cafe, QSR, rent, ward, and so on). All 11 off-topic test questions are refused.

**Answers can act.** When a question asks for a different plan ("Cafes in PCMC under ₹30k"), the answer offers to set it on the map.
