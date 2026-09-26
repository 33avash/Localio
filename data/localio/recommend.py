"""One sentence per locality: which format fits better here, and why.

It's the last thing in the detail drawer, so every number in it comes from
the locality's own row. The template is filled with str.format, and the
pipeline checks no "{" survives into the output.
"""

import pandas as pd

LABELS = {"cafe": ("cafe", "cafes"), "fast_food": ("QSR", "QSRs")}
CLOSE_CALL = 3.0
# Above this multiple of the city median, a locality counts as well served.
CROWDED = 1.5

LEADS = {
    "wins": "A {best} is the better bet here: it scores {best_score} against {other_score} for a {other}.",
    "close": "Cafe and QSR score about the same here ({cafe_score} vs {qsr_score}), so the concept matters more "
             "than the format.",
}
REASONS = {
    "gap": " There are no {best_many} yet among {residents} residents.",
    "thin": " There are {best_per_10k} {best_many} per 10,000 residents, against a city median of {city_per_10k}.",
    "typical": " It has {best_per_10k} {best_many} per 10,000 residents, close to the city median of {city_per_10k}.",
    "crowded": " It's already well served, with {best_per_10k} {best_many} per 10,000 residents against a city "
               "median of {city_per_10k}, so the case rests on footfall and ratings, not a gap.",
}
LOW_CONFIDENCE = " Only {outlets} here, so treat this as a lead to check on the ground."


def sentence(row: pd.Series, city_per_10k: dict[str, float]) -> str:
    scores = {c: row[f"{c}_score"] for c in LABELS}
    best = max(scores, key=scores.get)
    other = "fast_food" if best == "cafe" else "cafe"
    per_10k = row[f"{best}_per_10k"]
    values = {
        "best": LABELS[best][0],
        "best_many": LABELS[best][1],
        "other": LABELS[other][0],
        "best_score": f"{scores[best]:.1f}",
        "other_score": f"{scores[other]:.1f}",
        "cafe_score": f"{scores['cafe']:.1f}",
        "qsr_score": f"{scores['fast_food']:.1f}",
        "best_per_10k": f"{per_10k:.2f}",
        "city_per_10k": f"{city_per_10k[best]:.2f}",
        "residents": f"{int(row['population']):,}",
        "outlets": f"{int(row['total_pois'])} outlet{'' if row['total_pois'] == 1 else 's'}",
    }
    lead = LEADS["close" if abs(scores["cafe"] - scores["fast_food"]) < CLOSE_CALL else "wins"]
    if row[f"{best}_count"] == 0:
        reason = REASONS["gap"]
    elif per_10k <= city_per_10k[best]:
        reason = REASONS["thin"]
    elif per_10k <= CROWDED * city_per_10k[best]:
        reason = REASONS["typical"]
    else:
        reason = REASONS["crowded"]
    text = lead + reason + (LOW_CONFIDENCE if row["low_confidence"] else "")
    return text.format(**values)
