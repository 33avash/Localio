# Manual QA before a demo

`make verify` checks what a machine can. These are the things only a person at a real browser catches. Run through them once before a demo and note anything odd in an issue.

**Setup:** a fresh clone, Docker running, a normal browser window.

## 1. Cold start
- [ ] `git clone https://github.com/33avash/Localio.git`, `cd Localio`, `docker compose up --build`.
- [ ] The `data` log ends with every check `ok` and three `wrote` lines; `web` and `api` report healthy.
- [ ] http://localhost:8080 shows a loading skeleton briefly, then step 1 with the wards filling the map.

## 2. The flow
- [ ] Cafe → Balanced → the shortlist shows five wards, each with a score and a monthly rent.
- [ ] Switching priority re-ranks the list; the scores count up to their new values.
- [ ] Type 600 in "Shop size". Every rent changes as you type, and the URL gains `?sqft=600`.
- [ ] Reload. The same shortlist and shop size come back.
- [ ] Click "Format" in the step rail. You land on step 1 with Cafe still selected.

## 3. The drawer
- [ ] Click a ward on the map, a numbered marker, or a shortlist row. The drawer opens with rent, why it ranks here, the menu mix and a recommendation.
- [ ] Open a hatched ward (under 10 outlets). The drawer says "low confidence".
- [ ] Open a ward with no cafes. It shows 0 and "no competition", never "NaN" or a blank.
- [ ] Esc closes the drawer, and focus returns to what opened it.

## 4. Offline and phone
- [ ] Turn wifi off after the page loads and pan to a new area. The "Basemap unavailable" notice appears once; wards, markers and the drawer still work.
- [ ] Narrow the window below 860px. The panel becomes a bottom sheet; dragging its handle resizes the map.

## 5. Chat
- [ ] "Tell me about Koregaon Park" answers with its numbers and rent, and a Koregaon Park chip.
- [ ] "who won the world cup" is refused, with no chips.
- [ ] Enter on an empty box sends nothing; Shift+Enter adds a line.
- [ ] `docker compose stop api`, then ask anything: the chat says it isn't reachable and the map still works. `docker compose start api` brings it back.

## 6. Keyboard only
- [ ] Without the mouse, Tab from step 1 to the shortlist, open a row with Enter, close the drawer with Esc.
