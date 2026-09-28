"""Known-good figures for the seed dataset.

A wrong aggregation still draws a map that looks perfectly fine, so these
numbers are the only real check. If you swap in a different dataset,
update EXPECTED to match it.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd

from localio import CATEGORIES
from localio.score import ranked

LABELS = {"cafe": "cafe", "fast_food": "QSR"}
MAX_OTHER_MENU = 0.08

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


def check_catchments(localities: pd.DataFrame) -> list[Check]:
    """Every locality needs a catchment with people in it, or per-capita numbers break."""
    matched = int(localities["area_km2"].notna().sum())
    populated = int((localities["population"] > 0).sum())
    people = localities["population"].sum()
    return [
        Check("catchments", matched, len(localities), shown=f"{matched} of {len(localities)} localities"),
        Check("population", populated, len(localities), shown=f"{people / 1e6:.2f}M people, none empty"
              if populated == len(localities) else f"{populated} of {len(localities)} localities have people"),
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


def check_v2(scored: pd.DataFrame) -> list[Check]:
    """Every v2 score must be a real number in [-100, 100]; low confidence is counted, not hidden."""
    columns = [f"{c}_score" for c in CATEGORIES]
    values = scored[columns].to_numpy(dtype=float)
    valid = int((np.isfinite(values) & (np.abs(values) <= 100)).sum())
    low = int(scored["low_confidence"].sum())
    return [
        Check("scores v2", valid, values.size, shown=f"{valid} of {values.size} finite and within ±100"),
        Check("low conf.", low, low, shown=f"{low} of {len(scored)} localities have under 4 outlets"),
    ]


def check_menu(types: pd.Series) -> list[Check]:
    other = float((types == "Other").mean())
    return [Check("menu other", other < MAX_OTHER_MENU, True, shown=f"{other:.1%} of outlets (limit {MAX_OTHER_MENU:.0%})")]


def check_sentences(sentences: pd.Series) -> list[Check]:
    """A "{" left in a sentence means a template slot was never filled."""
    unfilled = int(sentences.str.contains(r"[{}]").sum())
    empty = int((sentences.str.len() == 0).sum())
    return [Check("sentences", unfilled + empty, 0, shown=f"{len(sentences)} written, none with unfilled slots"
                  if unfilled + empty == 0 else f"{unfilled} unfilled, {empty} empty")]
