"""Checks the pipeline runs before it writes anything.

A wrong spatial join still draws a map that looks perfectly fine, so every
number the map depends on is checked against something it must satisfy.
Any failed check exits 1 and nothing is written.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd

from localio import CATEGORIES
from localio.score import MIN_OUTLETS

CENSUS_2011_PMC = 3_124_458
EXPECTED_WARDS = {"PMC": 76, "PCMC": 64}
MAX_WARD_POPULATION = 120_000
PMC_TOLERANCE = 0.05
# Electoral wards are drawn to hold similar populations; a ward far outside
# this band of its corporation's mean means a bad join or a bad input.
WARD_BAND = (0.5, 2.0)
MIN_POIS = 1_200
MIN_CAFES = 200
PER_10K_BAND = (2, 40)


@dataclass(frozen=True)
class Check:
    label: str
    ok: bool
    shown: str


def check_wards(wards: pd.DataFrame) -> list[Check]:
    counts = wards["corporation"].value_counts().to_dict()
    largest = wards["population"].max()
    pmc = wards.loc[wards["corporation"] == "PMC", "population"].sum()
    means = wards.groupby("corporation")["population"].transform("mean")
    ratio = wards["population"] / means
    outliers = wards.index[(ratio < WARD_BAND[0]) | (ratio > WARD_BAND[1])].tolist()
    return [
        Check("wards", counts == EXPECTED_WARDS, f"{counts.get('PMC', 0)} PMC + {counts.get('PCMC', 0)} PCMC"),
        Check("max ward", largest <= MAX_WARD_POPULATION, f"{largest:,} residents (limit {MAX_WARD_POPULATION:,})"),
        Check("PMC total", abs(pmc / CENSUS_2011_PMC - 1) <= PMC_TOLERANCE,
              f"{pmc:,} vs Census 2011 {CENSUS_2011_PMC:,} (voter shares scaled to it, so this holds by construction)"),
        Check("ward sizes", not outliers,
              f"every ward within {WARD_BAND[0]}x-{WARD_BAND[1]}x its corporation's mean"
              if not outliers else f"outside {WARD_BAND}: {', '.join(outliers)}"),
    ]


def check_pois(pois: pd.DataFrame, wards: pd.DataFrame, placement: dict) -> list[Check]:
    people = wards["population"].sum()
    per_10k = len(pois) / people * 10_000
    cafes = int((pois["format"] == "cafe").sum())
    return [
        Check("outlets", len(pois) > MIN_POIS,
              f"{len(pois):,} in wards; {placement['outside']} outside every ward, {placement['in_two_wards']} in two"),
        Check("per 10k", PER_10K_BAND[0] <= per_10k <= PER_10K_BAND[1],
              f"{per_10k:.2f} food and drink outlets per 10,000 residents (allowed {PER_10K_BAND[0]}-{PER_10K_BAND[1]})"),
        Check("cafes", cafes >= MIN_CAFES, f"{cafes} (at least {MIN_CAFES})"),
    ]


def check_scores(scored: pd.DataFrame) -> list[Check]:
    values = scored[[f"{c}_score" for c in CATEGORIES]].to_numpy(dtype=float)
    valid = int((np.isfinite(values) & (values >= 0) & (values <= 100)).sum())
    low = int(scored["low_confidence"].sum())
    return [
        Check("scores", valid == values.size, f"{valid} of {values.size} finite and within 0-100"),
        Check("low conf.", True, f"{low} of {len(scored)} wards have under {MIN_OUTLETS} outlets"),
    ]


def check_rent(tiers: pd.DataFrame, unmatched: list[str]) -> list[Check]:
    """Every ward has a rent tier and a positive multiplier."""
    ok = tiers["rent_tier"].notna().all() and (tiers["rent_multiplier"] > 0).all()
    published = int((~tiers["rent_estimated"]).sum())
    outside = f"; outside every ward: {', '.join(unmatched)}" if unmatched else ""
    return [Check("rent", bool(ok), f"every ward has a tier; {published} on a published street, "
                                    f"{len(tiers) - published} estimated from their zone{outside}")]


def check_sentences(sentences: pd.Series) -> list[Check]:
    """A "{" left in a sentence means a template slot was never filled."""
    bad = int((sentences.str.contains(r"[{}]") | (sentences.str.len() == 0)).sum())
    return [Check("sentences", bad == 0,
                  f"{len(sentences)} written, none with unfilled slots" if bad == 0 else f"{bad} unfilled or empty")]
