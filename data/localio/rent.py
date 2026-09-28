"""Rent: what a shop in each ward is likely to cost, from published figures.

    typical rent   = median ₹/sq ft/month of 25 Pune shop listings
    tier           = from Cushman & Wakefield's prime high-street rents:
                     a ward on a published street takes that street's tier;
                     any other ward takes the middle tier of its admin zone
                     (marked estimated), or "emerging" if its zone has none
    tier multiplier = the tier's mean street rent / the mid tier's
    ward rent      = typical rent x tier multiplier            (₹/sq ft/month)

The browser multiplies the ward rent by the outlet size someone types in,
and turns it into the sales needed to keep rent within the healthy share
of sales that restaurant guides give. No revenue or profit is projected:
there is no public data to do that honestly.
"""

import statistics

import pandas as pd

TIERS = ("premium", "high", "mid", "value", "emerging")


def load_streets(rows: list[dict]) -> list[dict]:
    return [{**r, "rent_psf": float(r["rent_psf"]), "wards": r["wards"].split(";")} for r in rows]


def typical_rent(listings: list[dict]) -> float:
    """Median asking rent per sq ft a month across the listing sample."""
    return statistics.median(int(r["rent_inr_month"]) / int(r["sq_ft"]) for r in listings)


def multipliers(streets: list[dict], emerging: float) -> dict[str, float]:
    """Each tier's mean published rent over the mid tier's."""
    means = {tier: statistics.mean(s["rent_psf"] for s in streets if s["tier"] == tier) for tier in TIERS[:-1]}
    return {**{tier: round(mean / means["mid"], 2) for tier, mean in means.items()}, "emerging": emerging}


def assign_tiers(wards: pd.DataFrame, matches: dict[str, list[str]], streets: list[dict],
                 factor: dict[str, float]) -> pd.DataFrame:
    """rent_tier, rent_estimated and rent_streets for every ward."""
    tier_of = {s["street"]: s["tier"] for s in streets}
    rows = {}
    for key, named in matches.items():
        if key in wards.index:
            tier = max((tier_of[s] for s in named), key=lambda t: factor[t])
            rows[key] = {"rent_tier": tier, "rent_estimated": False, "rent_streets": named}
    for key, row in wards.iterrows():
        if key in rows:
            continue
        zone = sorted((rows[k]["rent_tier"] for k in wards.index[wards["admin_zone"] == row["admin_zone"]] if k in rows),
                      key=lambda t: factor[t])
        rows[key] = {"rent_tier": zone[len(zone) // 2] if zone else "emerging", "rent_estimated": True,
                     "rent_streets": []}
    frame = pd.DataFrame.from_dict(rows, orient="index").reindex(wards.index)
    frame["rent_multiplier"] = frame["rent_tier"].map(factor)
    return frame


def summary(typical: float, factor: dict[str, float], streets: list[dict], benchmarks: dict[str, dict],
            listings: list[dict]) -> dict:
    """rent.json: the constants the browser needs, each with its source."""
    size, share = benchmarks["outlet_sqft"], benchmarks["rent_share"]
    return {
        "typical_psf": round(typical, 1),
        "listings": len(listings),
        "default_sqft": round((float(size["low"]) + float(size["high"])) / 2),
        "healthy_share": [float(share["low"]), float(share["high"])],
        "tiers": {tier: {"multiplier": factor[tier],
                         "streets": [{"street": s["street"], "rent_psf": s["rent_psf"]} for s in streets
                                     if s["tier"] == tier]}
                  for tier in TIERS},
        "sources": {
            "streets": {k: streets[0][k] for k in ("source", "url", "retrieved")},
            "listings": {k: listings[0][k] for k in ("source", "url", "retrieved")},
            **{key: {k: b[k] for k in ("source", "url", "basis", "note", "retrieved")} for key, b in benchmarks.items()},
        },
    }
