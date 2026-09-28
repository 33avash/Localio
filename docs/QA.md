# Manual QA before a demo

`make verify` checks what a machine can. These are the things only a person at a real browser catches. Run through them once before a demo and note anything odd in an issue.

**Setup:** a fresh clone, Docker running, a normal browser window.

## 1. Cold start
- [ ] `git clone https://github.com/33avash/Localio.git`, `cd Localio`, `docker compose up --build`.
- [ ] The `data` log ends with every check `ok` and three `wrote` lines; `web` reports healthy.
- [ ] http://localhost:8080 shows a loading skeleton briefly, then your plan, its top 5, and the wards filling the map.

## 2. The plan
- [ ] The top 5 shows straight away, for a cafe, Balanced, all of Pune, 300 sq ft.
- [ ] Each row's two numbers (busy + room) add up to its score.
- [ ] Switch priority and area: the list re-ranks, scores count to their new values, and the map's five markers follow.
- [ ] Type 30000 as the rent budget: every rent in the list is at most ₹30k. Type 5000: the list says nothing fits and offers to raise the budget.
- [ ] Reload. The same plan comes back from the URL; open it in another browser and it's the same there.

## 3. The drawer
- [ ] Click a ward on the map, a numbered marker, or a row. The drawer shows its score (split into its parts), its rent, where the score comes from, the menu mix and a recommendation.
- [ ] Open a hatched ward (under 10 outlets). The drawer says its numbers are a lead to check.
- [ ] "Ask about …" switches to Ask and answers about that ward.
- [ ] Esc closes the drawer, and focus returns to what opened it.

## 4. Chat
- [ ] "Why is #1 ranked first?" explains the current #1 in two parts.
- [ ] "Compare Baner and Aundh" compares them for your format.
- [ ] "Cafes in PCMC under ₹30k rent" lists wards and offers "Use this plan on the map", which sets it.
- [ ] A ward chip opens that ward's drawer.
- [ ] "who won the world cup" is refused, with no chips.

## 5. Offline and phone
- [ ] Turn wifi off after the page loads and pan to a new area. The "Basemap unavailable" notice appears once; everything else keeps working, the chat included.
- [ ] Narrow the window below 860px. The panel becomes a bottom sheet; dragging its handle resizes the map.

## 6. Keyboard only
- [ ] Without the mouse, Tab through the plan, change it with Enter, open a row, close the drawer with Esc, and switch tabs with the arrow keys.

## 7. The published site
- [ ] https://33avash.github.io/Localio/ opens on a phone and on another laptop, and the chat answers there too.
