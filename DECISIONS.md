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

**The user sets the weights.** Sliders from 0 to 5 for each part, with three presets as starting points. The pipeline publishes the presets, so the site, the chat and the pipeline can't drift apart.

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

**One screen, not a wizard.** The plan's inputs sit above the top 5 and every change, including each slider, re-ranks at once. Earlier versions walked through four steps; one screen shows cause and effect directly.

**Every score shows its parts.** Each row shows the points from each of the four parts, which add up to its score, so a ranking is never a bare number.

**Plain ES modules, no build step.** The site is a few small modules; a bundler would add a toolchain to install and break.

**The URL is the plan.** Format, weights, area, size and budget live in the hash, so a link reopens the same shortlist.

## Chat

**In the browser, from the same files.** The chat reads the ward data the map uses, so the two can't disagree; a test checks the chat's top 5 equals the map's for every plan it's asked about. It needs no server, which is what lets the published site be a static page.

**Rules, not a language model.** It finds ward names (official titles and the places inside each ward), reads format, area, budget, size and what matters ("near offices", "low competition") from the question, and picks one of a few answer types: a ward, a comparison, why a ward ranks where it does, rent, a ranking, gaps, or the method. A model would sound more fluent but could state numbers the data doesn't hold; this can't.

**Refuse instead of guessing.** A question must name a ward or use a domain word (cafe, QSR, rent, ward, and so on). All 11 off-topic test questions are refused.

**Answers can act.** When a question asks for a different plan ("Cafes in PCMC under ₹30k"), the answer offers to set it on the map.
