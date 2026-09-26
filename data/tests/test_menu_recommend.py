import pandas as pd

from localio.menu import menu_type, tag
from localio.recommend import sentence

CITY = {"cafe": 0.3, "fast_food": 0.2}


def test_brand_beats_keywords():
    assert menu_type("Starbucks FC Road", "Starbucks", "cafe") == "Coffee"


def test_most_specific_keyword_wins():
    assert menu_type("Burger Mills Cafe", "Non Branded", "fast_food") == "Burgers & fried chicken"
    assert menu_type("The Chai Bar And Cafe Katraj", "Non Branded", "cafe") == "Chai & tea"


def test_fallbacks():
    assert menu_type("Boho Boho", "Non Branded", "cafe") == "Cafe, no stated specialty"
    assert menu_type("Yougo", "Non Branded", "fast_food") == "Other"


def test_other_stays_under_eight_percent(pois):
    assert (tag(pois) == "Other").mean() < 0.08


def _row(**overrides):
    row = {
        "cafe_score": 20.0, "fast_food_score": 5.0, "cafe_per_10k": 0.0, "fast_food_per_10k": 0.2,
        "cafe_count": 0, "fast_food_count": 2, "population": 12345, "total_pois": 1, "low_confidence": True,
    }
    return pd.Series({**row, **overrides})


def test_sentence_fills_every_slot_and_pluralises():
    text = sentence(_row(), CITY)
    assert "{" not in text and "}" not in text
    assert "no cafes yet among 12,345 residents" in text
    assert "Only 1 outlet here" in text


def test_sentence_calls_a_close_race():
    assert sentence(_row(fast_food_score=19.0, low_confidence=False), CITY).startswith("Cafe and QSR score about the same")


def test_near_median_is_not_called_crowded():
    text = sentence(_row(cafe_count=3, cafe_per_10k=0.33, low_confidence=False), CITY)
    assert "close to the city median" in text
