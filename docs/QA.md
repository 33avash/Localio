# Manual QA before a demo

`make verify` checks what a machine can. These are the things only a person at a real browser catches. Run through them once before a demo and note anything odd in an issue.

**Setup:** a fresh clone, Docker running, a normal browser window.

## 1. Cold start
- [ ] `git clone https://github.com/33avash/Localio.git`, `cd Localio`, `docker compose up --build`.
- [ ] The `data` log ends with every check `ok` and three `wrote` lines; `web` reports healthy.
- [ ] http://localhost:8080 shows a loading skeleton briefly, then the intro, the brief, its top 5, and the wards filling the map.

## 2. The brief and the shortlist
- [ ] The intro says what the site is for. "Got it" hides it, and it stays hidden after a reload.
- [ ] The top 5 shows straight away, for a cafe, a mix of everyone, some competition, all of Pune, 300 sq ft.
- [ ] Each row's four parts add up to its score.
- [ ] Pick "Office workers and students" and "Avoid it": the list re-ranks, scores count to their new values, the summary sentence and URL follow, and the map recolours.
- [ ] Open "Fine-tune the score" and drag a slider: the shares and the list update as you drag, and the summary says "your own weights".
- [ ] Type 30000 as the rent: every rent in the list is at most ₹30k, and wards over it turn grey on the map. Type 5000: the list says nothing fits and offers to raise the budget.
- [ ] "Compare the top 3" shows them side by side; swapping a column's ward updates the table.
- [ ] "Copy link to this shortlist", then open the link in another browser: the same brief and list.
- [ ] "Before you decide" lists the limits under the shortlist.
- [ ] The legend switches the map between "Score" and "Competition".

## 3. The drawer
- [ ] Click a ward on the map, a numbered marker, or a row. The drawer shows its score, a table of its four parts that adds up to it, its rent, where the score comes from, the menu mix and a recommendation.
- [ ] Open a hatched ward (under 10 outlets). The drawer says its numbers are a lead to check.
- [ ] "Compare with your top picks" opens the comparison with this ward first.
- [ ] "Ask about …" switches to Ask and answers about that ward.
- [ ] Esc closes the drawer, and focus returns to what opened it.

## 4. Chat
- [ ] With a key set, the typing dots show while an answer is written, and nothing on the page names the model. "Which AI are you?" gets "Localio's assistant".
- [ ] A follow-up ("and the rent there?") answers about the ward just discussed.
- [ ] "Why is #1 ranked first?" explains the current #1 part by part.
- [ ] "Best spot near colleges under ₹35k rent?" answers for office workers and students within that rent, and offers the plan.
- [ ] "Compare Baner and Aundh" compares them for your format.
- [ ] "Cafes in PCMC under ₹30k rent" lists wards and offers "Use this on the map", which sets it.
- [ ] A ward chip opens that ward's drawer.
- [ ] "who won the world cup" is refused, with no chips.

## 5. Offline and phone
- [ ] Turn wifi off after the page loads and pan to a new area. The "Basemap unavailable" notice appears once; everything else keeps working, the chat included.
- [ ] Narrow the window below 860px. The panel becomes a bottom sheet; dragging its handle resizes the map.

## 6. Keyboard only
- [ ] Without the mouse, Tab through the brief, change it with Enter, open a row, close the drawer with Esc, and switch tabs with the arrow keys.

## 7. The published site
- [ ] https://33avash.github.io/Localio/ opens on a phone and on another laptop, and the chat answers there too.
