# Decisions

The main choices behind Localio, and why. Each one is small enough to defend in a sentence.

## Data

**Real wards, not home-made areas.** Earlier versions drew Voronoi "catchments" around outlets, which gave triangles and a Koregaon Park of 294,000 people. DataMeet's 140 electoral wards are official boundaries, and residents come from the Census 2011 totals: shared by the 2012 voter rolls in PMC, and equally in PCMC, which has no roll.

**OpenStreetMap, not Google Places.** OSM has about six times as many outlets (1,702 in the wards against 260), and its licence (ODbL) allows redistribution. Google's terms don't, so the Google table was removed.

**Outlets are placed by boundary, in PostGIS.** `ST_Contains` puts each outlet in the ward that contains it. Matching by place name would silently misplace outlets.

**Everything is cached in `seed_data/`.** The OSM and population tools run once over the network. A normal build never goes online, so it runs the same everywhere.

## Scoring

**A transparent index, not a model.** An earlier version trained a quantile regression to predict outlet density. It beat its baseline, but explained only 22% of the variation. Three percentiles averaged together tell a user as much and can be explained in one sentence, so the model went.

**Busyness has three parts.** Where people live (residents per km²), where they already eat out (outlets per km²) and where they work, study or travel (offices, colleges, stations per km²). Residents alone favoured dense housing in the old city over commercial streets.

**Competition is `x / (x + median)`, not a rank.** Many wards have no cafes mapped. Ranking them made the step from 0 to 1 cafe as large as the step to 10. The ratio is 0 with none, 0.5 at the median, and grows gently.

**Wards need 10 outlets to be shortlisted.** With 4, the list was led by wards like Kadakmal Ali Hirabaug, next to Swargate, with 34,000 residents and 4 mapped outlets: gaps in the map, not the market. The other wards stay on the map, hatched.

**Three priorities, two weights.** Busy areas (0.8/0.2), Balanced (0.5/0.5) and Low competition (0.2/0.8). The browser re-ranks instantly because the pipeline ships each ward's busyness and competition.

## Rent

**Rent only, no sales forecast.** Rent has published sources: Cushman & Wakefield's high-street rents and real listings. A sales or profit forecast would rest on numbers invented for the purpose, so Localio doesn't make one. It shows the sales needed to keep rent to the 8–15% of sales that restaurant guides call healthy.

**Tiers from the published streets.** Each tier's multiplier is its mean street rent over the mid tier's. A ward on a published street takes that street's tier. Any other ward takes the middle tier of its admin zone, and says it's estimated.

## Containers

**Four services with a strict start order.** `data` waits for a healthy `db`, and `web` and `api` wait for `data` to succeed. A failed check means no site, never a site with bad numbers.

**No stale state anywhere.** tmpfs for the database, a bind mount (not a volume) for `./output`, and `no-store` on `/data/`.

**Vendored front-end assets.** Leaflet and the fonts are committed, so a demo doesn't depend on a CDN.

## Front end

**Plain ES modules, no build step.** The site is a few small modules; a bundler would add a toolchain to install and break.

**A guided flow, not a dashboard.** Four steps end in a ranked top 5. The step rail doubles as the way back, and the URL records where you are, so a shortlist can be shared.

## Chat

**Decide the question type first.** Ranking questions ("best area for a QSR") are answered from the scores; similarity search can't rank by a number. Only open questions use retrieval.

**Refuse by rules, then similarity.** A ward name or a domain word keeps a question in scope. Otherwise it needs a similarity of at least 0.62 to some ward's facts. All 11 off-topic test questions are refused.

**Gemini only rewords the facts.** It gets the retrieved ward cards and nothing else, must cite the wards it used, and any citation it wasn't given is dropped. Without a key the chat uses templates, so tests and a fresh clone need no secret.
