"""Unit economics: what a new cafe or QSR in a ward might take, spend and earn.

Every constant comes from seed_data/unit_economics.csv or
seed_data/pune_rent_index.csv, each row with its source; nothing here is a
bare number. Per ward and format:

    revenue   = format baseline x footfall x competition           (p10, p50, p90)
      footfall    = clip(capacity multiplier ^ elasticity)   the capacity model's band
      competition = clip(((1 + city per 10k) / (1 + ward per 10k)) ^ elasticity)
    rent      = baseline rent per sq ft x ward's rent tier multiplier x sq ft
    costs     = rent + (food cost + staff + royalty) x revenue + fixed
    profit    = revenue - costs
    payback   = setup cost / profit, in months
    rent burden = rent / revenue, flagged above the brief's 12%

Fixed costs (utilities, marketing, maintenance, delivery commissions) have
no published figure, so they are calibrated: at the format's default size
and baseline rent in a mid-tier ward, profit lands on the midpoint of the
published net margin. That is stated wherever the number appears.

If the conservative (p10) profit isn't positive, no payback is given; the
ward "may not clear breakeven under conservative assumptions". A payback
longer than the cap (ten years) isn't given either.

web/static/js/economics.js is a line-for-line mirror, so the browser can
recompute when someone changes an assumption. A Playwright test checks
the two agree to the rupee on every ward.
"""

import csv
import math
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

TIERS = ("premium", "high", "mid", "value", "emerging")
# Format sizes per category, the first being the default.
SIZES = {"cafe": ("small", "mid"), "fast_food": ("small", "franchise")}
PREFIX = {"cafe": "cafe", "fast_food": "qsr"}
QUANTILES = ("p10", "p50", "p90")


@dataclass(frozen=True)
class Benchmark:
    key: str
    low: float
    high: float
    unit: str
    basis: str
    note: str
    source: str
    url: str
    retrieved: str

    @property
    def mid(self) -> float:
        return (self.low + self.high) / 2


def load_benchmarks(path: Path) -> dict[str, Benchmark]:
    with path.open(encoding="utf-8") as f:
        return {r["key"]: Benchmark(r["key"], float(r["low"]), float(r["high"]), r["unit"], r["basis"], r["note"],
                                    r["source"], r["url"], r["retrieved"]) for r in csv.DictReader(f)}


def load_rent_index(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as f:
        return [{**r, "rent_psf": float(r["rent_psf"]), "wards": r["wards"].split(";")} for r in csv.DictReader(f)]


def tier_multipliers(streets: list[dict], emerging: float) -> dict[str, float]:
    """Each tier's mean published rent over the mid tier's. Emerging has no
    published street, so it takes the brief's multiplier."""
    means = {tier: _mean([s["rent_psf"] for s in streets if s["tier"] == tier]) for tier in TIERS[:-1]}
    return {**{tier: round(mean / means["mid"], 2) for tier, mean in means.items()}, "emerging": emerging}


def assign_tiers(wards: pd.DataFrame, matches: dict[str, list[str]], streets: list[dict],
                 multipliers: dict[str, float]) -> pd.DataFrame:
    """A ward on a published street takes that street's tier (the dearest, if
    several). Any other ward takes the upper median tier of the published
    wards in its admin zone, flagged as estimated; with none in its zone, it
    is emerging."""
    tier_of = {s["street"]: s["tier"] for s in streets}
    rows = {}
    for key in wards.index:
        named = matches.get(key, [])
        if named:
            tier = max((tier_of[s] for s in named), key=lambda t: multipliers[t])
            rows[key] = {"rent_tier": tier, "rent_estimated": False, "rent_streets": named}
    for key, row in wards.iterrows():
        if key in rows:
            continue
        zone = [rows[k]["rent_tier"] for k in wards.index[wards["admin_zone"] == row["admin_zone"]] if k in rows]
        ordered = sorted(zone, key=lambda t: multipliers[t])
        tier = ordered[len(ordered) // 2] if ordered else "emerging"
        rows[key] = {"rent_tier": tier, "rent_estimated": True, "rent_streets": []}
    frame = pd.DataFrame.from_dict(rows, orient="index").reindex(wards.index)
    frame["rent_multiplier"] = frame["rent_tier"].map(multipliers)
    return frame


def model(bench: dict[str, Benchmark], streets: list[dict]) -> dict:
    """Everything the projections need, written out as economics.json so the
    browser uses the same constants."""
    multipliers = tier_multipliers(streets, bench["emerging_multiplier"].mid)
    rates = {
        "food_cost": bench["food_cost_pct"].mid,
        "staff": bench["staff_pct"].mid,
        "royalty": bench["royalty_pct"].mid,
        "net_margin": bench["net_margin"].mid,
    }
    rent_default = bench["rent_baseline_psf"].mid
    formats = {}
    for category, sizes in SIZES.items():
        for size in sizes:
            key = f"{PREFIX[category]}_{size}"
            revenue, sqft = bench[f"revenue_{key}"], bench[f"sqft_{key}"]
            royalty = rates["royalty"] if size == "franchise" else 0.0
            variable = rates["food_cost"] + rates["staff"] + royalty
            fixed = revenue.mid * (1 - variable - rates["net_margin"]) - sqft.mid * rent_default * multipliers["mid"]
            formats[key] = {
                "revenue": [revenue.low, revenue.high],
                "setup": [bench[f"setup_{key}"].low, bench[f"setup_{key}"].high],
                "sqft": [sqft.low, sqft.high],
                "royalty": royalty,
                "fixed": round_half_up(fixed, -2),
            }
    tiers = {tier: {"multiplier": multipliers[tier],
                    "streets": [{"street": s["street"], "rent_psf": s["rent_psf"]} for s in streets if s["tier"] == tier]}
             for tier in TIERS}
    return {
        "formats": formats,
        "sizes": {category: list(sizes) for category, sizes in SIZES.items()},
        "prefix": PREFIX,
        "rates": rates,
        "rent": {"baseline": [bench["rent_baseline_psf"].low, bench["rent_baseline_psf"].high], "default": rent_default,
                 "flag": bench["rent_burden_flag"].mid, "tiers": tiers},
        "footfall": {"elasticity": bench["footfall_elasticity"].mid,
                     "clip": [bench["footfall_clip"].low, bench["footfall_clip"].high]},
        "competition": {"elasticity": bench["competition_elasticity"].mid,
                        "clip": [bench["competition_clip"].low, bench["competition_clip"].high]},
        "payback_cap": bench["payback_cap"].mid,
        "target_margin": bench["net_margin"].mid,
        "sources": {key: {k: v for k, v in vars(b).items()} for key, b in bench.items()},
        "rent_sources": [{k: s[k] for k in ("street", "rent_psf", "tier", "source", "url", "retrieved")} for s in streets],
    }


def defaults(econ: dict, category: str, size: str | None = None) -> dict:
    """The Assumptions tab's starting values: midpoints of the cited ranges."""
    size = size or econ["sizes"][category][0]
    fmt = econ["formats"][f"{econ['prefix'][category]}_{size}"]
    return {"size": size, "sqft": _mean(fmt["sqft"]), "rent_psf": econ["rent"]["default"], "setup": _mean(fmt["setup"]),
            "target_margin": econ["target_margin"]}


def project(econ: dict, category: str, inputs: dict, ward: dict, city_per_10k: float) -> dict:
    """One ward's projection. ward needs: multiplier (p10, p50, p90), per_10k
    for this format, rent_multiplier."""
    fmt = econ["formats"][f"{econ['prefix'][category]}_{inputs['size']}"]
    rates = econ["rates"]
    base = _mean(fmt["revenue"])
    fe, (f_lo, f_hi) = econ["footfall"]["elasticity"], econ["footfall"]["clip"]
    footfall = [_clip(m ** fe if m > 0 else 0.0, f_lo, f_hi) for m in ward["multiplier"]]
    ce, (c_lo, c_hi) = econ["competition"]["elasticity"], econ["competition"]["clip"]
    competition = _clip(((1 + city_per_10k) / (1 + ward["per_10k"])) ** ce, c_lo, c_hi)
    revenue = [round_half_up(base * f * competition) for f in footfall]
    rent = round_half_up(inputs["rent_psf"] * ward["rent_multiplier"] * inputs["sqft"])
    variable = rates["food_cost"] + rates["staff"] + fmt["royalty"]
    costs = [round_half_up(rent + variable * r + fmt["fixed"]) for r in revenue]
    profit = [r - c for r, c in zip(revenue, costs)]
    burden = sorted(rent / r for r in revenue)
    payback, note = None, None
    if profit[0] <= 0:
        note = "may not clear breakeven under conservative assumptions"
    else:
        months = [inputs["setup"] / p for p in reversed(profit)]
        if months[-1] > econ["payback_cap"]:
            note = f"payback runs past {round_half_up(econ['payback_cap'] / 12)} years under conservative assumptions"
        else:
            payback = [round_half_up(m, 1) for m in months]
    return {
        "revenue": revenue,
        "rent": rent,
        "costs": costs,
        "profit": profit,
        "margin": [round_half_up(p / r, 3) if r else None for p, r in zip(profit, revenue)],
        "rent_burden": [round_half_up(b, 3) for b in burden],
        "rent_flag": burden[1] > econ["rent"]["flag"],
        "payback": payback,
        "payback_note": note,
        "footfall": [round_half_up(f, 3) for f in footfall],
        "competition": round_half_up(competition, 3),
    }


def insight(entries: list[dict], flag: float) -> str | None:
    """Footfall rank against payback rank, within the shortlist. entries:
    name, footfall (capacity multiplier p50), payback (p50 months or None),
    profit (p50), rent_burden (p50), rent_tier. Rent is only blamed when
    the footfall leader's rent burden is over the flag, and it is in a
    dearer tier and pays more of its revenue in rent than the ward that
    pays back soonest."""
    if len(entries) < 2:
        return None
    if all(e["payback"] is None for e in entries):
        closest = max(entries, key=lambda e: e["profit"])
        return f"None of your shortlist clears breakeven under conservative assumptions. {closest['name']} comes " \
               f"closest, at {_rupees(closest['profit'])} a month profit in the middle case."
    by_footfall = sorted(entries, key=lambda e: -e["footfall"])
    by_return = sorted(entries, key=lambda e: (e["payback"] is None, e["payback"] or 0, -e["profit"]))
    f_rank = {e["name"]: i for i, e in enumerate(by_footfall)}
    r_rank = {e["name"]: i for i, e in enumerate(by_return)}
    best = by_return[0]
    for a in by_footfall:
        if a is best or r_rank[a["name"]] - f_rank[a["name"]] < 2:
            continue
        rent = (a["rent_burden"] > flag and a["rent_burden"] > best["rent_burden"]
                and TIERS.index(a["rent_tier"]) < TIERS.index(best["rent_tier"]))
        lead = f"{a['name']} has the {_ordinal(f_rank[a['name']])} footfall in your shortlist, but "
        if rent:
            lead += f"{a['rent_tier']} rent pushes rent burden to {round_half_up(a['rent_burden'] * 100)}% of " \
                    "projected revenue."
            if a["payback"] is None:
                return f"{lead} {best['name']} projects a payback of about {round_half_up(best['payback'])} months, " \
                       f"where {a['name']} may not clear breakeven under conservative assumptions."
            return f"{lead} {best['name']} projects a shorter payback ({round_half_up(best['payback'])} vs " \
                   f"{round_half_up(a['payback'])} months){_less(best, a)}."
        if a["payback"] is None:
            return f"{lead}it may not clear breakeven under conservative assumptions, while {best['name']} " \
                   f"projects a payback of about {round_half_up(best['payback'])} months{_less(best, a)}."
        return f"{lead}{best['name']} projects a shorter payback ({round_half_up(best['payback'])} vs " \
               f"{round_half_up(a['payback'])} months){_less(best, a)}."
    leader = by_footfall[0]
    if leader is best:
        return f"{best['name']} leads your shortlist on both footfall and projected payback " \
               f"(about {round_half_up(best['payback'])} months)."
    return f"Footfall and payback broadly agree here: {leader['name']} leads on footfall, and {best['name']} on " \
           f"projected payback (about {round_half_up(best['payback'])} months)."


def _less(best: dict, other: dict) -> str:
    less = round_half_up((1 - best["footfall"] / other["footfall"]) * 100)
    return f" on about {less}% less footfall" if less > 0 else ""


def _rupees(value: float) -> str:
    """As the browser writes them: ₹45k, ₹4.2L; a loss with a minus sign."""
    sign, value = ("−" if value < 0 else ""), abs(value)
    if value >= 1e5:
        return f"{sign}₹{_fixed(value / 1e5, 1)}L"
    return f"{sign}₹{round_half_up(value / 1e3)}k" if value >= 1e3 else f"{sign}₹{round_half_up(value)}"


def _fixed(value: float, digits: int) -> str:
    return f"{round_half_up(value, digits):.{digits}f}"


def insight_examples(entries: dict[str, list[dict]], flag: float) -> list[dict]:
    """Shortlist-sized sets drawn from real wards, with the sentence Python
    writes for each. economics.json carries them so a Playwright test can
    check the browser writes the same sentence. entries: category -> one
    insight entry per confident ward."""
    orders = {
        "footfall": lambda e: -e["footfall"],
        "profit": lambda e: -e["profit"],
        "rent": lambda e: (-e["rent_burden"], -e["footfall"]),
        "footfall, every other ward": lambda e: -e["footfall"],
    }
    examples = []
    for category, pool in entries.items():
        for name, order in orders.items():
            ranked = sorted(pool, key=order)
            chosen = ranked[::2][:5] if name.endswith("other ward") else ranked[:5]
            examples.append({"category": category, "set": name, "entries": chosen, "sentence": insight(chosen, flag)})
    return examples


def round_half_up(value: float, digits: int = 0) -> float:
    """Math.round's rule (halves go up), not Python's banker's rounding, so
    the browser and the pipeline agree to the rupee."""
    if digits <= 0:
        step = 10 ** -digits
        return int(math.floor(value / step + 0.5) * step)
    scale = 10 ** digits
    return math.floor(value * scale + 0.5) / scale


def _ordinal(rank: int) -> str:
    return ("strongest", "second-strongest", "third-strongest", "fourth-strongest", "fifth-strongest")[rank]


def _clip(value: float, low: float, high: float) -> float:
    return min(high, max(low, value))


def _mean(values: list[float]) -> float:
    return sum(values) / len(values)
