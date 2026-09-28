"""Rent: typical rent from the listings, tiers from published streets, and
how wards without a street get theirs."""

import statistics

import pandas as pd
import pytest

from localio import db, rent, sources


@pytest.fixture(scope="module")
def streets(seed_dir):
    return rent.load_streets(sources.load_csv(seed_dir / "rent_high_streets.csv"))


@pytest.fixture(scope="module")
def factor(streets):
    return rent.multipliers(streets, 0.6)


def test_typical_rent_is_the_listing_median(seed_dir):
    listings = sources.load_csv(seed_dir / "rent_listings.csv")
    assert len(listings) == 25
    by_hand = statistics.median(int(r["rent_inr_month"]) / int(r["sq_ft"]) for r in listings)
    assert rent.typical_rent(listings) == by_hand == pytest.approx(137.5)


def test_tier_multipliers_are_mean_street_rents_over_the_mid_tier(factor):
    # premium: J.M. Road 420, M.G. Road 360, F.C. Road 350, Koregaon Park 350; mid: 230, 210.
    assert factor["premium"] == round((420 + 360 + 350 + 350) / 4 / ((230 + 210) / 2), 2) == 1.68
    assert factor["mid"] == 1.0
    assert factor["emerging"] == 0.6
    assert [factor[t] for t in rent.TIERS] == sorted(factor.values(), reverse=True)


def test_every_benchmark_is_sourced_or_marked_an_assumption(seed_dir):
    for row in sources.load_csv(seed_dir / "rent_benchmarks.csv"):
        assert float(row["low"]) <= float(row["high"]), row["key"]
        assert row["url"].startswith("https://") if row["basis"] == "published" else row["basis"] == "assumption"


def test_wards_off_a_published_street_take_their_zone_or_emerging(streets, factor):
    wards = pd.DataFrame({"admin_zone": ["Z1", "Z1", "Z1", "Z2"]}, index=["a", "b", "c", "d"])
    tiers = rent.assign_tiers(wards, {"a": ["Koregaon Park"], "b": ["Kothrud-Karve Road"]}, streets, factor)
    assert tiers.loc["a", "rent_tier"] == "premium" and not tiers.loc["a", "rent_estimated"]
    # Zone Z1 has premium and mid; the estimate takes the upper middle.
    assert tiers.loc["c", "rent_tier"] == "premium" and tiers.loc["c", "rent_estimated"]
    assert tiers.loc["d", "rent_tier"] == "emerging" and tiers.loc["d", "rent_multiplier"] == 0.6


def test_streets_land_in_the_wards_they_name(loaded, streets):
    conn, _ = loaded
    matches, unmatched = db.rent_streets(conn, streets)
    wards_of = {}
    for key, named in matches.items():
        for street in named:
            wards_of.setdefault(street, set()).add(key)
    assert wards_of["Koregaon Park"] == {"PMC-21"}
    assert "PMC-08" in wards_of["Aundh"]
    assert "PCMC-44" in wards_of["Mumbai-Pune Highway (PCMC)"]
    # M.G. Road runs through the Cantonment, which is outside every PMC and PCMC ward.
    assert unmatched == ["M.G. Road (place:Pune Cantonment)"]
