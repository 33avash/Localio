"""Tag each outlet with a menu type, from its brand or its name.

The seed has no cuisine column, so this is rules, not a model: a table for
the known brands, then keywords in the name, checked from most specific to
least. A cafe that names no specialty is a general cafe. What's left is
"Other", and the pipeline checks that stays under 8% of outlets.
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
    "Indian snacks & meals",
    "Cafe, no stated specialty",
    "Other",
)

BRANDS = {
    "Baithack": "Chai & tea",
    "Blue Tokai": "Coffee",
    "Brew Culture": "Coffee",
    "Burger King": "Burgers & fried chicken",
    "Burger Singh": "Burgers & fried chicken",
    "Butter Brews": "Coffee",
    "Cafe Durga": "Coffee",
    "Cafe Goodluck": "Chai & tea",
    "Cafe Peter": "Cafe, no stated specialty",
    "Captain Coffee": "Coffee",
    "Chaayos": "Chai & tea",
    "Coffee Nation": "Coffee",
    "Crazy Cheesy Cafe": "Sandwiches & rolls",
    "Dessertino": "Bakery & desserts",
    "Dominos": "Pizza & Italian",
    "Good Flippin Burgers": "Burgers & fried chicken",
    "Haldirams": "Indian snacks & meals",
    "Hi On Chai": "Chai & tea",
    "Irani Cafe": "Chai & tea",
    "Its Street Coffee": "Coffee",
    "KFC": "Burgers & fried chicken",
    "MH99 Burgers": "Burgers & fried chicken",
    "Marz-O-Rin": "Sandwiches & rolls",
    "McDonalds": "Burgers & fried chicken",
    "Nothing Before Coffee": "Coffee",
    "Poetry": "Bakery & desserts",
    "Pokket Cafe": "Cafe, no stated specialty",
    "Popeyes": "Burgers & fried chicken",
    "S Kumar Wadewale": "Indian snacks & meals",
    "Si Nonnas": "Pizza & Italian",
    "Starbucks": "Coffee",
    "Subway": "Sandwiches & rolls",
    "Tapri": "Chai & tea",
    "Third Wave Coffee": "Coffee",
    "Wadeshwar": "Indian snacks & meals",
    "Yolkshire": "Cafe, no stated specialty",
}

# Most specific first: "Burger Mills Cafe" is burgers, "The Chai Bar And Cafe" is chai.
KEYWORDS = (
    ("Pizza & Italian", r"pizza|italian|piatto|nonna|milano|segreto"),
    ("Burgers & fried chicken", r"burger|chicken|crunch"),
    ("Sandwiches & rolls", r"sandwich|\broll"),
    ("Bakery & desserts", r"cake|bake|dessert|waffle|flour|crust|honeycomb|froozo|delice|plaisir|petit"),
    ("Indian snacks & meals", r"misal|paratha|vada|pav|bhaji|south indian|restaurant|gruh|satvik|indore|chaupati|"
                              r"\banna\b|khadadi|sawata"),
    ("Chai & tea", r"\bchai\b|\btea\b|qehhwa|matcha|chaha"),
    ("Coffee", r"coffee|kaffee|caffe|espresso|brew|bean|latte|demitasse"),
)


def menu_type(name: str, brand: str, category: str) -> str:
    if brand in BRANDS:
        return BRANDS[brand]
    lowered = name.lower()
    for kind, pattern in KEYWORDS:
        if re.search(pattern, lowered):
            return kind
    return "Cafe, no stated specialty" if category == "cafe" else "Other"


def tag(pois: pd.DataFrame) -> pd.Series:
    return pd.Series(
        [menu_type(n, b, c) for n, b, c in zip(pois["name"], pois["brand"].fillna(""), pois["category"])],
        index=pois.index,
    )


def mix(pois: pd.DataFrame, types: pd.Series) -> pd.DataFrame:
    """Share of each locality's outlets by menu type; rows sum to 1."""
    counts = pd.crosstab(pois["locality"], types).reindex(columns=list(TYPES), fill_value=0)
    return counts.div(counts.sum(axis=1), axis=0)
