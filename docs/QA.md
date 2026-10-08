# Manual QA before a demo

`make verify` checks what a machine can. These are the things only a person at a real browser catches. Run through them once before a demo and note anything odd in an issue.

**Setup:** a fresh clone, Docker running, a normal browser window.

## 1. Cold start
- [ ] `git clone https://github.com/33avash/Localio.git`, `cd Localio`, `docker compose up --build`.
- [ ] The `data` log ends with every check `ok` (including `sources`) and three `wrote` lines; `web` reports healthy.
- [ ] http://localhost:8080 shows "Loading Pune's 140 wards" briefly, then the intro, the site brief, the shortlist, and the wards filling the map.
- [ ] The status strip under the map shows 140 wards, 1,702 outlets and the build date; the top bar's data pill opens the sources.

## 2. The brief and the shortlist
- [ ] "Got it" hides the intro, and it stays hidden after a reload.
- [ ] Each row shows a fit label, a confidence dot, and four parts that add up to its score.
- [ ] Pick "Office workers and students" and "Avoid it": rows glide to their new places, scores count to their new values, the URL follows, and the map recolours.
- [ ] Type 35000, then 50000, as the rent ceiling: the "Shortlist change" strip names the change, the wards in and out, and the biggest mover with its reason. Pin it as baseline, change the format, and the strip says "Since your baseline".
- [ ] Type 5000: "No locations match your brief" offers to raise the ceiling, search all of Pune or include thin data.
- [ ] "Adjust the model": dragging a slider updates the shares and the list as you drag.
- [ ] "Decision caveats" lists the limits under the shortlist.

## 3. A ward
- [ ] Click a row, a marker or a ward on the map. The drawer shows the score and fit, confidence, rent and rent per sq ft; "Why this location" with the case and what to watch; the parts table; economics; how stable the rank is; what draws people; the menu; data quality.
- [ ] Change the calculator's ticket or days: the sales and orders a day update. It says "Scenario calculation · not a forecast".
- [ ] A hatched ward (under 10 outlets) says its numbers are a lead to check, and shows Low confidence.
- [ ] Esc closes the drawer, and focus returns to what opened it.

## 4. Compare, Market, Methodology
- [ ] Compare shows the top 3 with five verdicts; swapping a column's ward updates the table and the verdicts.
- [ ] Market shows the KPIs, fit bands, competition (with thin data hatched), rent tiers, coverage and opportunity signals; each signal opens its ward.
- [ ] Methodology lists every source with its freshness (Census: low; OpenStreetMap: high), and its section links scroll without changing the URL.

## 5. The map
- [ ] The layer list switches between all seven layers, each with its own legend. In "Fit score", clicking a legend band shows only those wards; clicking it again shows all.
- [ ] Hovering a shortlist row outlines its ward and lifts its marker. "Show mapped outlets" adds the outlet dots.

## 6. The analyst
- [ ] With a key set, the typing dots show while an answer is written, and nothing on the page names the model. "Which AI are you?" gets "Localio's assistant".
- [ ] "Why is Katraj Dairy first?" explains it part by part, and "Show evidence" lists the score, rent, residents, outlets and confidence.
- [ ] A follow-up ("and the rent there?") answers about the ward just discussed.
- [ ] "Cafes in PCMC under ₹30k rent" offers "Use this on the map", which sets it.
- [ ] "who won the world cup" is refused, with no chips.

## 7. Share, search, theme
- [ ] Share shows the brief and top 5; "Copy link" then open it elsewhere: the same brief and list. "Download CSV" saves the full ranking; "Print brief" prints a one-page brief.
- [ ] Ctrl K (or /): "katraj" finds Katraj Dairy; "50k" sets the rent ceiling; "dark" switches theme.
- [ ] The theme toggle switches light and dark, and the choice survives a reload.

## 8. Offline, phone, keyboard, motion
- [ ] Turn wifi off after the page loads and pan to a new area. The "Basemap unavailable" notice appears once; everything else keeps working.
- [ ] Below 860px: the map is on top, the analysis in a bottom sheet with a draggable handle, the layer list folds into one button, and no numbered marker starts under the legend.
- [ ] Without the mouse: Tab through the brief, change it with Enter, open a row, close the drawer with Esc, switch tabs with the arrow keys, and open the palette with Ctrl K.
- [ ] With "reduce motion" set in the OS, nothing glides, counts or slides.

## 9. The published site
- [ ] https://33avash.github.io/Localio/ opens on a phone and on another laptop, and the analyst answers there too.
