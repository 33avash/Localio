"""One sentence per ward: which format fits better here, and why.

Every number in it comes from the ward's own row, and competition is
described against the rate in well-mapped wards, the same reference the
score uses. The template is filled with str.format, and the pipeline
checks no "{" survives into the output.
"""

import pandas as pd

LABELS = {"cafe": ("cafe", "cafes"), "fast_food": ("QSR", "QSRs")}
CLOSE_CALL = 3.0


def level(count: int, per_10k: float, reference: float) -> str:
    """How crowded a format is: "none mapped", "light", "average" or
    "heavy". The site and the chat use the same lines (web/static/js/score.js)."""
    if count == 0:
        return "none mapped"
    ratio = per_10k / reference
    return "light" if ratio <= 0.5 else "average" if ratio <= 1.5 else "heavy"


LEADS = {
    "wins": "A {best} is the better bet here: it scores {best_score} out of 100, against {other_score} for a {other}.",
    "close": "Cafe and QSR score about the same here ({cafe_score} vs {qsr_score}), so the concept matters more "
             "than the format.",
}
REASONS = {
    "none mapped": " No {best_many} are mapped yet among {residents} residents.",
    "light": " It has {best_per_10k} {best_many} per 10,000 residents, well under the {reference} in well-mapped wards.",
    "average": " It has {best_per_10k} {best_many} per 10,000 residents, close to the {reference} in well-mapped wards.",
    "heavy": " It's already well served, with {best_per_10k} {best_many} per 10,000 residents against {reference} in "
             "well-mapped wards, so the case rests on how busy it is.",
}
LOW_CONFIDENCE = " Only {outlets} mapped here, so check on the ground before relying on it."


def sentence(row: pd.Series, reference: dict[str, float]) -> str:
    scores = {c: row[f"{c}_score"] for c in LABELS}
    best = max(scores, key=scores.get)
    other = "fast_food" if best == "cafe" else "cafe"
    per_10k = row[f"{best}_per_10k"]
    values = {
        "best": LABELS[best][0],
        "best_many": LABELS[best][1],
        "other": LABELS[other][0],
        "best_score": f"{scores[best]:.0f}",
        "other_score": f"{scores[other]:.0f}",
        "cafe_score": f"{scores['cafe']:.0f}",
        "qsr_score": f"{scores['fast_food']:.0f}",
        "best_per_10k": f"{per_10k:.2f}",
        "reference": f"{reference[best]:.2f}",
        "residents": f"{int(row['population']):,}",
        "outlets": f"{int(row['total_pois'])} outlet{'' if row['total_pois'] == 1 else 's'}",
    }
    lead = LEADS["close" if abs(scores["cafe"] - scores["fast_food"]) < CLOSE_CALL else "wins"]
    reason = REASONS[level(int(row[f"{best}_count"]), per_10k, reference[best])]
    text = lead + reason + (LOW_CONFIDENCE if row["low_confidence"] else "")
    return text.format(**values)
