import pandas as pd

from localio.menu import menu_type
from localio.recommend import level, sentence

REFERENCE = {"cafe": 0.3, "fast_food": 0.2}


def test_cuisine_tag_wins():
    assert menu_type("coffee_shop", "Some Place", "", "cafe") == "Coffee"
    assert menu_type("north_indian;chinese", "", "", "restaurant") == "Indian"


def test_name_keywords_when_there_is_no_tag():
    assert menu_type("", "Burger Mills Cafe", "", "fast_food") == "Burgers & fried chicken"
    assert menu_type("", "Domino's Pizza", "Domino's", "fast_food") == "Pizza & Italian"


def test_untagged_outlets_say_so():
    assert menu_type("", "Boho Boho", "", "cafe") == "Cafe, no cuisine tagged"
    assert menu_type("", "Shree Swami", "", "restaurant") == "Restaurant, no cuisine tagged"
    assert menu_type("mexican", "", "", "restaurant") == "Other cuisine"


def _row(**overrides):
    row = {
        "cafe_score": 20.0, "fast_food_score": 5.0, "cafe_per_10k": 0.0, "fast_food_per_10k": 0.2,
        "cafe_count": 0, "fast_food_count": 2, "population": 12345, "total_pois": 1, "low_confidence": True,
    }
    return pd.Series({**row, **overrides})


def test_sentence_fills_every_slot_and_pluralises():
    text = sentence(_row(), REFERENCE)
    assert "{" not in text and "}" not in text
    assert "No cafes are mapped yet among 12,345 residents" in text
    assert "Only 1 outlet mapped here" in text


def test_sentence_calls_a_close_race():
    assert sentence(_row(fast_food_score=19.0, low_confidence=False), REFERENCE).startswith("Cafe and QSR score about the same")


def test_near_the_reference_is_average_not_crowded():
    text = sentence(_row(cafe_count=3, cafe_per_10k=0.33, low_confidence=False), REFERENCE)
    assert "close to the 0.30 in well-mapped wards" in text


def test_competition_levels():
    assert level(0, 0.0, 1.0) == "none mapped"
    assert level(1, 0.5, 1.0) == "light"
    assert level(3, 1.5, 1.0) == "average"
    assert level(9, 1.6, 1.0) == "heavy"
