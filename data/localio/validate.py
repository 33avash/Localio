"""Known-good figures for the seed dataset.

A wrong aggregation still draws a map that looks perfectly fine, so these
numbers are the only real check. If you swap in a different dataset,
update EXPECTED to match it.
"""

from dataclasses import dataclass

import pandas as pd

EXPECTED = {
    "pois": 259,
    "localities": 51,
    "category_counts": {"cafe": 165, "fast_food": 94},
}


@dataclass(frozen=True)
class Check:
    label: str
    actual: object
    expected: object

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
