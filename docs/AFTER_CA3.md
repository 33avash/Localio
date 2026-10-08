# After the first review

The first review (CA3, 28 September – 1 October 2026) raised no specific points to fix. This page records what changed between that review and the final submission, so the work since is easy to check. All of it arrived in [#3](https://github.com/33avash/Localio/pull/3), merged on 8 October 2026.

| What changed | Why | Where |
|---|---|---|
| An architecture diagram of the Compose stack | The pipeline, its checks and the two ways the site is served are easier to explain from one picture | [README](../README.md#how-its-built), [ARCHITECTURE.md](ARCHITECTURE.md) |
| A source registry the pipeline checks | Every dataset's licence, coverage and dates in one file; the build refuses to publish if a field is missing | [seed_data/sources.json](../seed_data/sources.json), Methodology view |
| Confidence for every ward | Data quality differs by ward (outlet coverage, how residents were estimated, rent source), so it's shown beside the score | shortlist, ward drawer |
| Rank sensitivity and "what changed" | Shows whether a recommendation holds if the budget or competition setting changes | ward drawer, shortlist |
| Compare verdicts and a market view | A shortlist is for choosing between wards; the market view shows the whole city for the same brief | Compare, Market |
| A contrast fix | The accessibility tests caught text under 4.5:1 on selected options | `localio.css` |
| More tests | Pipeline tests 34 → 39, browser tests 45 → 63, including both themes, keyboard-only use and reduced motion | `data/tests/`, `tests/e2e/specs/` |

No score changed: the browser still reproduces all 280 pipeline scores, and a check of 220 briefs against an independent recalculation matched every rank, score and rent.
