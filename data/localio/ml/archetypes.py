"""Market types: group wards with similar food-and-drink profiles.

k-means on standardised ward profiles, with k from 3 to 6 chosen by
silhouette score. The clusters describe the 140 wards; they aren't a
prediction. Each cluster is named from whichever feature sets its centre
furthest from the city average, and each ward also gets the three wards
whose profiles are closest to its own.
"""

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import StandardScaler

K_RANGE = range(3, 7)
SIMILAR = 3

PROFILE = ("log_outlets_per_10k", "chain_share", "restaurant_share", "late_night_share", "capacity", "cafe_share")

# (feature, above or below average) -> the name a cluster gets when that is
# what sets it apart most.
NAMES = {
    ("capacity", 1): "Busy high street",
    ("capacity", -1): "Quiet suburb",
    ("log_outlets_per_10k", 1): "Crowded market",
    ("log_outlets_per_10k", -1): "Under-served area",
    ("chain_share", 1): "Chain corridor",
    ("chain_share", -1): "Independent pocket",
    ("late_night_share", 1): "Late-night strip",
    ("late_night_share", -1): "Daytime trade",
    ("restaurant_share", 1): "Restaurant row",
    ("restaurant_share", -1): "Snack and cafe strip",
    ("cafe_share", 1): "Cafe quarter",
    ("cafe_share", -1): "QSR belt",
}


def profiles(wards: pd.DataFrame, capacity: pd.Series) -> pd.DataFrame:
    """What each ward's food and drink looks like. Wards with no outlets get
    the median share for the share features, so they cluster on the rest."""
    outlets = wards["total_pois"].replace(0, np.nan)
    frame = pd.DataFrame({
        "log_outlets_per_10k": np.log1p(wards["total_per_10k"]),
        "chain_share": wards["chain_count"] / outlets,
        "restaurant_share": wards["restaurant_count"] / outlets,
        "late_night_share": wards["late_night_count"] / wards["hours_known"].replace(0, np.nan),
        "capacity": capacity,
        "cafe_share": wards["cafe_count"] / outlets,
    }, index=wards.index)
    return frame.fillna(frame.median())


def cluster(profile: pd.DataFrame) -> tuple[pd.Series, dict]:
    """Label each locality with a market type; also return what the report needs."""
    z = StandardScaler().fit_transform(profile)
    fits = {k: KMeans(n_clusters=k, n_init=20, random_state=0).fit(z) for k in K_RANGE}
    silhouettes = {k: float(silhouette_score(z, fit.labels_)) for k, fit in fits.items()}
    best = max(silhouettes, key=silhouettes.get)
    kmeans = fits[best]

    names = _names(kmeans.cluster_centers_)
    labels = pd.Series([names[c] for c in kmeans.labels_], index=profile.index)
    types = [
        {
            "name": names[c],
            "localities": sorted(profile.index[kmeans.labels_ == c]),
            "centre": {feature: round(float(v), 2) for feature, v in zip(PROFILE, kmeans.cluster_centers_[c])},
        }
        for c in range(best)
    ]
    report = {"k": best, "silhouette": round(silhouettes[best], 3),
              "silhouette_by_k": {k: round(s, 3) for k, s in silhouettes.items()}, "types": types}
    return labels, report


def similar(profile: pd.DataFrame) -> pd.Series:
    """The SIMILAR localities with the closest standardised profiles, nearest first."""
    z = StandardScaler().fit_transform(profile)
    _, neighbours = NearestNeighbors(n_neighbors=SIMILAR + 1).fit(z).kneighbors(z)
    names = profile.index.to_numpy()
    return pd.Series([list(names[row[1:]]) for row in neighbours], index=profile.index)


def _names(centres: np.ndarray) -> list[str]:
    """Name each cluster by its most distinctive feature, never reusing a name."""
    used, names = set(), []
    for centre in centres:
        for i in np.argsort(-np.abs(centre)):
            name = NAMES[(PROFILE[i], 1 if centre[i] > 0 else -1)]
            if name not in used:
                break
        used.add(name)
        names.append(name)
    return names
