# Manual QA before a demo

`make verify` covers what a machine can check. These are the things only a person at a real browser catches. Run through them once before any demo, top to bottom, and note anything odd in an issue.

**Setup:** a fresh clone, Docker running, a normal browser window (not headless).

## 1. Cold start from a clean clone
- [ ] `git clone https://github.com/33avash/Localio.git` into a new folder, `cd` into it.
- [ ] `docker compose up --build`. The `data` log ends with every check `ok` and three `wrote` lines; `api` and `web` report healthy.
- [ ] http://localhost:8080 shows the loading skeleton briefly, then step 1 with the catchments framed (not a sea of empty map).

## 2. Wifi off after load
- [ ] With the page open, turn wifi off and pan to an area you haven't viewed.
- [ ] The "Basemap unavailable" notice appears once. × dismisses it.
- [ ] The areas, markers, drawer and shortlist all keep working. The chat still answers, because it runs locally.

## 3. Resize to phone width mid-flow
- [ ] On the shortlist, drag the window narrower than 860px, or use the device toolbar.
- [ ] The panel becomes a bottom sheet under the map, and the map has no grey strip or missing tiles.
- [ ] Drag the handle up and down. The sheet snaps to header-only, half or 85%, and the map resizes with it.
- [ ] Open a drawer. The sheet rises and the chosen area is centred in the map above.

## 4. Back button and the step rail
- [ ] Go Format → Priority → Shortlist, then click "Format" in the rail. You land on step 1 with your format still selected.
- [ ] Reload on `#shortlist/qsr/footfall`. The same shortlist comes back.
- [ ] The browser's Back button leaves the site rather than stepping back. This is deliberate: the rail is the way back, and the URL only records where you are.

## 5. Rapid priority toggling
- [ ] On the shortlist, click the three lenses quickly several times.
- [ ] The final list matches the last lens clicked, the scores settle on their true values, and no marker is left behind on the map (always exactly 5).

## 6. Chat edge cases
- [ ] Press Enter in an empty chat box. Nothing is sent.
- [ ] Send "   " (spaces only). Nothing is sent.
- [ ] Shift+Enter adds a new line without sending.
- [ ] "who won the world cup" is refused, with no locality chips.
- [ ] `docker compose stop api`, then ask anything. Within a few seconds the chat says it isn't reachable, and the map still works. `docker compose start api` brings it back.

## 7. A locality with no outlets of your format
- [ ] Choose QSR, then click Baner's area directly on the map (it has no QSRs).
- [ ] The drawer opens and shows 0 QSRs and "0.00 per 10k", with no "NaN" or blank values. The recommendation says there are no QSRs yet.
- [ ] Click one of the hatched areas (under 4 outlets). The drawer marks it low confidence.

## 8. Keyboard only
- [ ] Unplug the mouse, or just don't touch it. Tab through step 1 to the shortlist, open a row with Enter, close the drawer with Esc, and check focus returns to the row.
