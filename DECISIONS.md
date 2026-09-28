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

**Three services with a strict start order.** `data` waits for a healthy `db`, and `web` waits for `data` to succeed. A failed check means no site, never a site with bad numbers.

**No stale state anywhere.** tmpfs for the database, a bind mount (not a volume) for `./output`, and `no-store` on `/data/`.

**Vendored front-end assets.** Leaflet and the fonts are committed, so a demo doesn't depend on a CDN.

**Published by the same containers.** GitHub Actions runs `docker compose run data` and publishes the site with its output to GitHub Pages, so the live link shows exactly what the pipeline produced and checked.

## Front end

**One screen, not a wizard.** The plan's five inputs sit above the top 5 and every change re-ranks at once. Earlier versions walked through four steps; one screen shows cause and effect directly.

**Every score shows its parts.** Each row splits its score into busyness points and room (low-competition) points, so a ranking is never a bare number.

**Plain ES modules, no build step.** The site is a few small modules; a bundler would add a toolchain to install and break.

**The URL is the plan.** Format, priority, area, size and budget live in the hash, so a link reopens the same shortlist.

## Chat

**In the browser, from the same files.** The chat reads the ward data the map uses, so the two can't disagree; a test checks the chat's top 5 equals the map's for every plan it's asked about. It needs no server, which is what lets the published site be a static page.

**Rules, not a language model.** It finds ward names (official titles and the places inside each ward), reads format, priority, area, budget and size from the question, and picks one of a few answer types: a ward, a comparison, why a ward ranks where it does, rent, a ranking, gaps, or the method. A model would sound more fluent but could state numbers the data doesn't hold; this can't.

**Refuse instead of guessing.** A question must name a ward or use a domain word (cafe, QSR, rent, ward, and so on). All 11 off-topic test questions are refused.

**Answers can act.** When a question asks for a different plan ("Cafes in PCMC under ₹30k"), the answer offers to set it on the map.
