# Decisions

The main choices behind Localio, and why. Each one is small enough to defend in a sentence.

## Data

**Real wards, not home-made areas.** Earlier versions drew Voronoi "catchments" around outlets, which gave triangles and a Koregaon Park of 294,000 people. DataMeet's 140 electoral wards are official boundaries, and residents come from the Census 2011 totals: shared by the 2012 voter rolls in PMC, and equally in PCMC, which has no roll.

**OpenStreetMap, not Google Places.** OSM has about six times as many outlets (1,702 in the wards against 260), and its licence (ODbL) allows redistribution. Google's terms don't, so the Google table was removed.

**Outlets are placed by boundary, in PostGIS.** `ST_Contains` puts each outlet in the ward that contains it. Matching by place name would silently misplace outlets.

**Everything is cached in `seed_data/`.** The OSM and population tools run once over the network. A normal build never goes online, so it runs the same everywhere.

## Scoring

**A transparent index, not a model.** An earlier version trained a quantile regression to predict outlet density. It beat its baseline but explained only 22% of the variation. Four parts a user can see and weigh tell them as much, and each can be explained in a sentence.

**Four parts, each shown with its points.** Residents, eating out, daytime draw and low competition. An earlier version folded the first three into one "busyness" number; splitting them lets someone who cares about office workers say so, and every row and drawer shows what each part added.

**Two plain questions set the weights.** "Who are your customers?" and "How much competition can you take?" are questions a cafe founder can answer; "weight daytime draw 3 of 5" isn't. Each customer answer weights the one measure of people that fits it (all three for a mix), and each competition answer sets the low-competition weight. An earlier version weighted the matching part 3 and the others 1; the old city's peths lead on all three, so the answer barely changed the list. Sliders stay behind "Fine-tune" for anyone who wants them.

**Competition against well-mapped wards.** The first version compared each ward with the city median, 0.23 cafes per 10,000 residents, dragged down by 100 wards where OpenStreetMap maps almost nothing; 72% of shortlistable wards then read as "heavy competition". The reference is now the rate across the 40 wards with 10 or more outlets mapped (2.49 cafes per 10,000).

**"None mapped" isn't "none at all".** Every count gets one extra outlet before competition is measured. Without it, the two wards with no cafes mapped took full marks and led every list.

**Wards need 10 outlets to be shortlisted.** With 4, the list was led by wards like Kadakmal Ali Hirabaug, next to Swargate, with 34,000 residents and 4 mapped outlets: gaps in the map, not the market. The other wards stay on the map, hatched.

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

**Say what it's for, and what it can't do, where people decide.** An intro states the purpose until it's dismissed, and "Before you decide" sits under every shortlist, not in a drawer, because the limits matter most at the moment of choosing.

**One screen, not a wizard.** The brief sits above the shortlist, and every answer re-ranks at once. Earlier versions walked through four steps; one screen shows cause and effect directly.

**The map shows the score for your brief.** Wards are shaded by their score in fixed bands, so a colour always means the same score, and wards the brief rules out (area, rent, thin data) turn grey with the reason on hover. The competition view is one switch away.

**Every score shows its parts.** Each row shows the points from each of the four parts, which add up to its score, so a ranking is never a bare number.

**Compare, because a shortlist is for choosing.** The top 3 side by side, any column swappable, with the best value in each row marked.

**Plain ES modules, no build step.** The site is a few small modules; a bundler would add a toolchain to install and break.

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
