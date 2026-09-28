# Decisions

A running log of the choices behind Localio and why they were made. Newest last.

## Data and scoring

**Aggregate by locality, not `grid_cell_id`.** (2026-09-18) The seed's grid averages about 1.5 outlets per cell, so a cell with 2 cafes and one with none differ by chance. Localities hold 0–12 per format, and they match how people talk about where to open ("Baner", not a cell ID).

**Log-scale the demand term.** Deccan Gymkhana has 121,097 reviews and the next locality 42,736. On a linear scale one outlier takes the top of the range and squashes everyone else toward zero. `log10(1 + reviews)` keeps the order and the middle stays readable.

**Only score localities with at least 4 outlets.** Below that, one extra cafe swings the numbers too much to mean anything. The 28 smaller localities stay on the map, marked as not scored, instead of silently disappearing.

**Check the output against known figures before writing anything.** A wrong join still draws a map that looks fine. The pipeline asserts 259 outlets, 51 localities, 165/94 cafes/QSRs, 23 scored, and the top 3 per format. Any mismatch exits 1 and writes nothing, and the web container doesn't start.

**Catchments instead of wards.** (2026-09-26) Per-capita numbers need areas with population. OpenStreetMap has no boundary for the Pune or Pimpri-Chinchwad municipal corporations (Pune is only a place node), and official wards don't line up with the 51 localities. Each locality instead gets its Voronoi cell, cut back to within 2 km of its own outlets so edge localities don't claim farmland. These are labelled catchments, not wards.

**Population from Meta's HRSL, precomputed and committed.** HRSL gives 30 m population cells under CC BY 4.0, and its tiles are cloud-optimised GeoTIFFs, so the tool reads only the Pune window over HTTP (about 2 seconds). The result is a 52 KB file in `seed_data/`, which keeps the normal build offline. One known weakness: residents undercount daytime crowds, which is why Hinjewadi (an IT park with 23k residents) shows as cafe-dense.

**Colour by outlets per 10,000 residents, with zero as its own class.** Raw counts favour big catchments. Five quantile classes spread the 51 areas evenly across the ramp. "None yet" is grey rather than the palest shade, because an empty market is the most interesting answer, not the bottom of a scale.

## Containers and serving

**Two containers, with `data` gating `web`.** `service_completed_successfully` means a failed validation keeps the site down instead of serving bad numbers.

**Bind mount for `./output`, and `no-store` on `/data/`.** A named volume would keep the previous run's files. A cached response would do the same in the browser. Both make a map that looks fine while showing old numbers.

**Vendor Leaflet and the fonts.** The build shouldn't depend on a CDN being up during a demo. Only map tiles still come over the network.

**Optional CARTO key, OpenStreetMap by default.** (2026-09-26) CARTO started requiring an API key on 23 September 2026, and keyless requests return "API KEY REQUIRED" images with HTTP 200, so the tile-error fallback never fires. With `LOCALIO_CARTO_KEY` set the map uses CARTO Positron; without it, OpenStreetMap tiles greyscaled in CSS. A fresh clone needs no key.

## Front end

**Plain ES modules, no build step.** The site is a handful of modules. A bundler would add a toolchain to install and a build to break, and gain nothing at this size.

**Keep the step's main action in a fixed footer.** (2026-09-26) In v1, "Show my shortlist" and "Start over" scrolled out of view. The panel is now a fixed header, one scrolling body and a fixed footer, and the step rail replaces the Back link.

**Push numbered markers apart on screen.** Three of the top cafe localities sit within a few hundred metres of each other. A collision pass keeps markers at least 34 px apart at any zoom, with a leader line to each true position.

## Machine learning

**Validate the footfall model by locality, not by row.** (2026-09-26) Outlets in the same locality share context, so a random split would leak it and flatter the model. Five-fold `GroupKFold` leaves whole localities out. The model only replaces the heuristic demand term if it beats a median baseline on that test. It does, modestly: MAE 1.21 against 1.30 log reviews, R² 0.12.

**Ridge, not gradient boosting.** Gradient boosting was the obvious upgrade and did worse (R² 0.00) with 259 outlets. Ridge is also exactly decomposable, so each locality's "what drives this" is the model's real arithmetic, not an approximation.

**Show the model's range, not just its estimate.** With R² 0.12 a single number would overstate what the model knows. The app shows the 80% range from cross-validated errors next to every estimate.

**Supply per 10,000 residents in the score.** v1 counted competitors. With population available, counts favour big catchments, so v2 divides by residents. The shortlist's "thin" and "heavy" wording compares against the city median, the same test the recommendation sentence uses, so the two never disagree.

**Score every locality, but keep low-confidence ones off the shortlist.** The model can estimate demand anywhere, so the 28 small localities now have scores. They stay hatched and off the top 5 because their supply and ratings rest on one to three outlets.

**Keep v1's score as a check.** Its top 3 are known values, so recomputing it catches aggregation mistakes before any modelling happens. It isn't shown anywhere.

**Market types are descriptive.** k-means picks 5 types, but a silhouette of 0.24 means they overlap. The app uses them as a label and for "similar localities", never as an input to the score.

**Menu types by rules.** The seed has no cuisine field. A brand table plus name keywords is transparent and testable. A model trained on 259 names, with no labels to check it against, wouldn't be.

## Chat

**Decide the question type before any model writes.** (2026-09-26) Embedding similarity is good at "tell me about places like this" and bad at "which place scores highest", so ranking and gap questions are answered from the scores. Only open-ended questions go to retrieval.

**Refuse by rules first, similarity last.** A locality name or a domain word puts a question in scope. Otherwise it needs a similarity of at least 0.62 to some locality card. On the 41 labelled questions, the most similar off-topic one scores 0.53, and all 11 off-topic ones are refused.

**Gemini only rewrites retrieved facts.** It gets the fact cards and nothing else, must return JSON with its citations, and any citation that wasn't retrieved is dropped. No valid citation means the template answer is used instead, so an answer can't name a place the data doesn't back.

**Chat works without a key.** Gemini Flash writes answers when `GEMINI_API_KEY` is set. Otherwise the API returns templated answers from the same retrieved facts, so tests, CI and a fresh clone don't need a secret. The free tier may use prompts to improve Google's products, so only the question and public locality figures are sent.

**fastembed over sentence-transformers.** The same `bge-small` model runs on ONNX Runtime without PyTorch, which keeps the image at 645 MB instead of several gigabytes. The model is baked into the image at build time, so the container starts offline.

**nginx resolves the API per request.** With a plain `proxy_pass http://api:8000`, nginx refuses to start if `api` is missing, and the map would go down with the chat.
