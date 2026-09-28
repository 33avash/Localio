"""The money layer: every constant traced to the CSVs, a worked example done
by hand, the payback rules, rent tiers and the headline insight."""

import csv
import statistics

import pandas as pd
import pytest

from localio import db, economics
from localio.economics import insight, project, round_half_up

FLAG = 0.12


@pytest.fixture(scope="module")
def bench(seed_dir):
    return economics.load_benchmarks(seed_dir / "unit_economics.csv")


@pytest.fixture(scope="module")
def streets(seed_dir):
    return economics.load_rent_index(seed_dir / "pune_rent_index.csv")


@pytest.fixture(scope="module")
def econ(bench, streets):
    return economics.model(bench, streets)


def test_every_benchmark_is_sourced_or_marked_an_assumption(bench):
    for row in bench.values():
        assert row.low <= row.high, row.key
        if row.basis == "published":
            assert row.url.startswith("https://"), row.key
        else:
            assert row.basis.startswith("assumption"), row.key


def test_the_baseline_rent_is_the_listing_samples_interquartile_range(seed_dir, bench):
    with (seed_dir / "rent_listings_sample.csv").open(encoding="utf-8") as f:
        per_sqft = [int(r["rent_inr_month"]) / int(r["sq_ft"]) for r in csv.DictReader(f)]
    q1, _, q3 = statistics.quantiles(per_sqft, n=4)
    assert (bench["rent_baseline_psf"].low, bench["rent_baseline_psf"].high) == (round(q1), round(q3))


def test_tier_multipliers_are_mean_published_rents_over_the_mid_tier(econ):
    tiers = econ["rent"]["tiers"]
    # premium: J.M. Road 420, M.G. Road 360, F.C. Road 350, Koregaon Park 350; mid: 230, 210.
    assert tiers["premium"]["multiplier"] == round((420 + 360 + 350 + 350) / 4 / ((230 + 210) / 2), 2) == 1.68
    assert tiers["mid"]["multiplier"] == 1.0
    assert tiers["emerging"]["multiplier"] == 0.6
    multipliers = [tiers[t]["multiplier"] for t in economics.TIERS]
    assert multipliers == sorted(multipliers, reverse=True)


def test_a_worked_example_by_hand(bench, econ):
    """A small cafe in a mid-tier ward whose surroundings support twice the
    median ward's outlets, with fewer cafes per 10k than the city median."""
    ward = {"multiplier": [0.5, 2.0, 4.0], "per_10k": 0.1, "rent_multiplier": 1.0}
    inputs = {"size": "small", "sqft": 300, "rent_psf": 137.5, "setup": 1_150_000}
    city = 0.23
    m = project(econ, "cafe", inputs, ward, city)

    base = (300_000 + 500_000) / 2                                  # revenue_cafe_small midpoint
    footfall = [max(0.6, min(1.6, x ** 0.12)) for x in (0.5, 2.0, 4.0)]
    competition = max(0.85, min(1.1, ((1 + 0.23) / (1 + 0.1)) ** 0.08))
    revenue = [round_half_up(base * f * competition) for f in footfall]
    assert m["revenue"] == revenue == [371_379, 438_596, 476_637]

    rent = round_half_up(137.5 * 1.0 * 300)                         # baseline x tier x sq ft
    assert m["rent"] == rent == 41_250
    variable = (0.28 + 0.35) / 2 + (0.20 + 0.30) / 2                # food cost and staff midpoints
    fixed = econ["formats"]["cafe_small"]["fixed"]
    assert fixed == round_half_up(base * (1 - variable - (0.05 + 0.20) / 2) - 300 * 137.5, -2) == 82_800
    profit = [r - round_half_up(rent + variable * r + fixed) for r in revenue]
    assert m["profit"] == profit
    assert profit[0] > 0
    assert m["payback"] == [round_half_up(1_150_000 / p, 1) for p in reversed(profit)]
    assert m["rent_burden"][1] == round_half_up(rent / revenue[1], 3)
    assert m["rent_flag"] is (rent / revenue[1] > 0.12)


def test_fixed_costs_are_calibrated_to_the_published_net_margin(econ):
    """At the default size and rent, in a mid-tier ward where footfall and
    competition are both neutral, p50 profit is the net-margin midpoint."""
    for category in economics.SIZES:
        inputs = economics.defaults(econ, category)
        m = project(econ, category, inputs, {"multiplier": [1, 1, 1], "per_10k": 0.5, "rent_multiplier": 1.0}, 0.5)
        assert m["margin"][1] == pytest.approx(econ["rates"]["net_margin"], abs=0.001)


def test_no_payback_when_the_conservative_case_loses_money(econ):
    weak = {"multiplier": [0.0, 0.3, 1.0], "per_10k": 5.0, "rent_multiplier": 1.68}
    m = project(econ, "cafe", economics.defaults(econ, "cafe"), weak, 0.23)
    assert m["profit"][0] <= 0
    assert m["payback"] is None
    assert m["payback_note"] == "may not clear breakeven under conservative assumptions"


def test_no_payback_past_the_cap(econ):
    """Profitable, but only just: a huge setup budget pushes payback past ten years."""
    ward = {"multiplier": [1.0, 1.5, 2.0], "per_10k": 0.1, "rent_multiplier": 0.6}
    inputs = {**economics.defaults(econ, "cafe"), "setup": 50_000_000}
    m = project(econ, "cafe", inputs, ward, 0.23)
    assert m["profit"][0] > 0 and m["payback"] is None
    assert "past 10 years" in m["payback_note"]


def test_bigger_outlets_pay_more_rent(econ):
    ward = {"multiplier": [0.5, 1.0, 2.0], "per_10k": 0.2, "rent_multiplier": 1.0}
    small = project(econ, "cafe", {**economics.defaults(econ, "cafe"), "sqft": 300}, ward, 0.23)
    large = project(econ, "cafe", {**economics.defaults(econ, "cafe"), "sqft": 450}, ward, 0.23)
    assert large["rent"] > small["rent"] and large["profit"][1] < small["profit"][1]


def test_rounding_matches_javascript():
    assert round_half_up(2.5) == 3 and round(2.5) == 2
    assert round_half_up(-2.5) == -2
    assert round_half_up(16.25, 1) == 16.3
    assert round_half_up(82_750, -2) == 82_800


def _entry(name, footfall, payback, profit, burden, tier):
    return {"name": name, "footfall": footfall, "payback": payback, "profit": profit, "rent_burden": burden,
            "rent_tier": tier}


def test_insight_calls_out_rent_behind_a_footfall_leader():
    entries = [
        _entry("Koregaon Park", 5.0, 30.0, 40_000, 0.16, "premium"),
        _entry("Baner Balewadi", 4.0, 14.0, 80_000, 0.09, "high"),
        _entry("Aundh ITI", 3.0, 18.0, 60_000, 0.10, "high"),
        _entry("Kothrud", 2.0, 20.0, 55_000, 0.08, "mid"),
    ]
    assert insight(entries, FLAG) == (
        "Koregaon Park has the strongest footfall in your shortlist, but premium rent pushes rent burden to 16% of "
        "projected revenue. Baner Balewadi projects a shorter payback (14 vs 30 months) on about 20% less footfall.")


def test_insight_when_the_footfall_leader_may_not_break_even():
    entries = [
        _entry("A", 6.0, None, -5_000, 0.20, "premium"),
        _entry("B", 3.0, 16.0, 70_000, 0.08, "mid"),
        _entry("C", 2.0, 22.0, 50_000, 0.09, "mid"),
    ]
    assert insight(entries, FLAG) == (
        "A has the strongest footfall in your shortlist, but premium rent pushes rent burden to 20% of projected "
        "revenue. B projects a payback of about 16 months, where A may not clear breakeven under conservative "
        "assumptions.")


def test_insight_when_footfall_and_payback_agree():
    entries = [_entry("A", 3.0, 12.0, 90_000, 0.08, "mid"), _entry("B", 2.0, 20.0, 50_000, 0.09, "mid")]
    assert insight(entries, FLAG) == "A leads your shortlist on both footfall and projected payback (about 12 months)."


def test_insight_does_not_blame_rent_when_the_leader_pays_less_of_it():
    entries = [
        _entry("A", 5.0, 20.0, 50_000, 0.07, "value"),
        _entry("B", 4.0, 16.0, 60_000, 0.08, "mid"),
        _entry("C", 3.0, 12.0, 90_000, 0.09, "mid"),
    ]
    assert insight(entries, FLAG) == ("A has the strongest footfall in your shortlist, but C projects a shorter payback "
                                "(12 vs 20 months) on about 40% less footfall.")


def test_insight_when_nothing_breaks_even_names_the_closest():
    entries = [_entry("A", 3.0, None, -1_000, 0.3, "mid"), _entry("B", 2.0, None, 45_400, 0.3, "mid")]
    assert insight(entries, FLAG) == ("None of your shortlist clears breakeven under conservative assumptions. B comes "
                                "closest, at ₹45k a month profit in the middle case.")


def test_estimated_tiers_take_their_zone_median_or_emerging(econ, streets):
    wards = pd.DataFrame({"admin_zone": ["Z1", "Z1", "Z1", "Z2"]}, index=["a", "b", "c", "d"])
    multipliers = {tier: t["multiplier"] for tier, t in econ["rent"]["tiers"].items()}
    tiers = economics.assign_tiers(wards, {"a": ["Koregaon Park"], "b": ["Kothrud-Karve Road"]}, streets, multipliers)
    assert tiers.loc["a", "rent_tier"] == "premium" and not tiers.loc["a", "rent_estimated"]
    assert tiers.loc["c", "rent_tier"] == "premium" and tiers.loc["c", "rent_estimated"]
    assert tiers.loc["d", "rent_tier"] == "emerging" and tiers.loc["d", "rent_estimated"]


def test_rent_streets_land_in_the_wards_they_name(loaded, streets):
    conn, _ = loaded
    matches, unmatched = db.rent_streets(conn, streets)
    by_street = {}
    for key, named in matches.items():
        for street in named:
            by_street.setdefault(street, set()).add(key)
    assert by_street["Koregaon Park"] == {"PMC-21"}
    assert "PMC-08" in by_street["Aundh"]
    assert "PCMC-44" in by_street["Mumbai-Pune Highway (PCMC)"]
    # M.G. Road runs through the Cantonment, which is outside every PMC and PCMC ward.
    assert unmatched == ["M.G. Road (place:Pune Cantonment)"]
