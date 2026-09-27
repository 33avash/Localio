"""Tag each outlet with a menu type, from its OSM cuisine tag or its name.

OpenStreetMap's `cuisine` tag is filled in for 45% of Pune's outlets. The
first recognised value wins; when there's none, keywords in the name are
tried, most specific first. An outlet that says nothing about its menu is
a "no cuisine tagged" cafe, QSR or restaurant, which is honest about the
gap in the data rather than guessing.
"""

import re

import pandas as pd

TYPES = (
    "Coffee",
    "Chai & tea",
    "Bakery & desserts",
    "Pizza & Italian",
    "Burgers & fried chicken",
    "Sandwiches & rolls",
    "Indian",
    "Chinese & Asian",
    "Other cuisine",
    "Cafe, no cuisine tagged",
    "QSR, no cuisine tagged",
    "Restaurant, no cuisine tagged",
)

CUISINES = {
    "Coffee": {"coffee_shop", "coffee", "cafe"},
    "Chai & tea": {"tea", "chai", "juice"},
    "Bakery & desserts": {"ice_cream", "cake", "dessert", "donut", "chocolate", "bakery", "waffle", "frozen_yogurt"},
    "Pizza & Italian": {"pizza", "italian", "pasta"},
    "Burgers & fried chicken": {"burger", "chicken", "american", "french_fries", "fried_chicken"},
    "Sandwiches & rolls": {"sandwich", "kebab", "wraps", "shawarma", "breakfast", "bagel"},
    "Indian": {"indian", "regional", "south_indian", "south indian", "north_indian", "marathi", "maharashtrian",
               "misal", "biryani", "bhel", "chat", "snacks", "vada_pav", "paan", "punjabi", "gujarati", "thali"},
    "Chinese & Asian": {"chinese", "asian", "thai", "korean", "japanese", "momos", "sushi", "noodles"},
}

KEYWORDS = (
    ("Pizza & Italian", r"pizza|italian|pasta|domino"),
    ("Burgers & fried chicken", r"burger|chicken|kfc|mcdonald|popeyes"),
    ("Sandwiches & rolls", r"sandwich|subway|\broll|shawarma|wrap"),
    ("Bakery & desserts", r"cake|bake|dessert|waffle|ice ?cream|kulfi|baskin|naturals"),
    ("Chinese & Asian", r"chinese|momo|wok|noodle|sushi"),
    ("Indian", r"misal|paratha|vada|pav|bhaji|biryani|thali|dosa|idli|mess|bhel|chaat"),
    ("Chai & tea", r"\bchai\b|\btea\b|chaayos|tapri|amruttulya"),
    ("Coffee", r"coffee|starbucks|brew|espresso|caf[eé] coffee day|barista"),
)
UNTAGGED = {"cafe": "Cafe, no cuisine tagged", "fast_food": "QSR, no cuisine tagged",
            "restaurant": "Restaurant, no cuisine tagged"}


def menu_type(cuisine: str, name: str, brand: str, fmt: str) -> str:
    values = [v.strip().lower() for v in cuisine.split(";") if v.strip()]
    for value in values:
        for kind, known in CUISINES.items():
            if value in known:
                return kind
    text = f"{name} {brand}".lower()
    for kind, pattern in KEYWORDS:
        if re.search(pattern, text):
            return kind
    return "Other cuisine" if values else UNTAGGED.get(fmt, "Other cuisine")


def tag(pois: pd.DataFrame) -> pd.Series:
    return pd.Series([menu_type(c, n, b, f) for c, n, b, f in zip(pois["cuisine"], pois["name"], pois["brand"], pois["format"])],
                     index=pois.index)


def mix(pois: pd.DataFrame, types: pd.Series, wards: pd.Index) -> pd.DataFrame:
    """Share of each ward's outlets by menu type; wards without outlets are all zero."""
    counts = pd.crosstab(pois["ward"], types).reindex(index=wards, columns=list(TYPES), fill_value=0)
    return counts.div(counts.sum(axis=1).replace(0, 1), axis=0)
