# UI v2, part A: before and after

Screenshots from headless Edge against the running stack. Each image puts v1 on the left and the fix on the right.

| Defect | Fix | Measured |
|---|---|---|
| A1 map showed mostly empty terrain | fit to catchments, pan and zoom limited to the data | data fills 87% × 89% of the map at 1440px |
| A2 top-5 markers overlapped | label points, 34px collision pass with leader lines, row hover lifts the marker | closest pair 35px (fit), 34px (zoomed out), 63px (zoomed in) |
| A3 main action scrolled out of view | fixed header, one scrolling body, fixed footer | one scroll container at 390, 1024 and 1440px widths |
| A4 overlapping bubbles made colours not in the legend | catchment choropleth that tiles without overlap | 51 areas, 0 overlaps |

A3's "nested scrollbars" symptom did not reproduce in v1: it had one scroll region at every size tested. What it did have was the main action scrolling out of view, which is what the fix addresses.
