"""Known-good figures for the seed dataset.

A wrong aggregation still draws a map that looks perfectly fine, so these
numbers are the only real check. If you swap in a different dataset,
update EXPECTED to match it.
"""

from dataclasses import dataclass

import pandas as pd

from localio import CATEGORIES
from localio.score import ranked

LABELS = {"cafe": "cafe", "fast_food": "QSR"}

EXPECTED = {
    "pois": 259,
    "localities": 51,
    "category_counts": {"cafe": 165, "fast_food": 94},
    "scored": 23,
    "top3": {
        "cafe": ["Deccan Gymkhana", "Wakad", "Shivajinagar"],
        "fast_food": ["Koregaon Park", "Deccan Gymkhana", "Kalyani Nagar"],
    },
}


@dataclass(frozen=True)
class Check:
    label: str
    actual: object
    expected: object
    shown: str = ""

    @property
    def ok(self) -> bool:
        return self.actual == self.expected


def check_counts(pois: pd.DataFrame, localities: pd.DataFrame) -> list[Check]:
    counts = pois["category"].value_counts()
    expected = EXPECTED["category_counts"]
    return [
        Check("POIs", len(pois), EXPECTED["pois"]),
        Check("localities", len(localities), EXPECTED["localities"]),
        Check("cafes", int(counts.get("cafe", 0)), expected["cafe"]),
        Check("QSRs", int(counts.get("fast_food", 0)), expected["fast_food"]),
    ]


def check_scores(scored: pd.DataFrame) -> list[Check]:
    checks = [Check("scored", int(scored["scored"].sum()), EXPECTED["scored"], shown=_scored_note(scored))]
    for category in CATEGORIES:
        top = ranked(scored, category).head(3)
        shown = ", ".join(f"{name} {value:.1f}" for name, value in top.items())
        checks.append(Check(f"top {LABELS[category]}", list(top.index), EXPECTED["top3"][category], shown))
    return checks


def _scored_note(scored: pd.DataFrame) -> str:
    return f"{int(scored['scored'].sum())} of {len(scored)} localities"
