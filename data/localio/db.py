"""PostGIS: load the seed data, then do every spatial join and distance in SQL.

The db service is a throwaway PostGIS (tmpfs, no volume), so each run
starts from an empty database and can't pick up stale tables. Geometry is
stored in WGS84 (4326) for the map and in UTM 43N (32643) for metres.
"""

import os
import time

import pandas as pd
import psycopg
from shapely import wkb

from localio.sources import Ward

DEFAULT_URL = "postgresql://localio:localio@db:5432/localio"
CITY_CENTRE = (73.8567, 18.5204)

SCHEMA = """
CREATE EXTENSION IF NOT EXISTS postgis;
DROP TABLE IF EXISTS wards, pois, places, colleges, offices, stations, roads, road_cells CASCADE;
CREATE TABLE wards (key text PRIMARY KEY, corporation text, number int, title text, admin_zone text,
                    population int, geom geometry(MultiPolygon, 4326), g32 geometry(MultiPolygon, 32643));
CREATE TABLE pois (id text PRIMARY KEY, amenity text, format text, name text, brand text, cuisine text,
                   opening_hours text, geom geometry(Point, 4326), g32 geometry(Point, 32643), ward text);
CREATE TABLE places (name text, place text, geom geometry(Point, 4326));
CREATE TABLE colleges (name text, g32 geometry(Point, 32643));
CREATE TABLE offices (name text, g32 geometry(Point, 32643));
CREATE TABLE stations (name text, g32 geometry(Point, 32643));
CREATE TABLE roads (class text, g32 geometry(LineString, 32643));
CREATE TABLE road_cells (metres int, g32 geometry(Point, 32643));
"""


def connect(url: str | None = None, attempts: int = 20) -> psycopg.Connection:
    """Connect, waiting briefly for the db container to accept connections."""
    url = url or os.environ.get("LOCALIO_DB", DEFAULT_URL)
    for attempt in range(attempts):
        try:
            return psycopg.connect(url, autocommit=True)
        except psycopg.OperationalError:
            if attempt == attempts - 1:
                raise
            time.sleep(1)


def load(conn: psycopg.Connection, wards: list[Ward], pois: list[dict], context: dict) -> None:
    conn.execute(SCHEMA)
    with conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO wards VALUES (%s, %s, %s, %s, %s, %s, ST_Multi(ST_Force2D(ST_GeomFromWKB(%s, 4326))), NULL)",
            [(w.key, w.corporation, w.number, w.title, w.admin_zone, w.population, wkb.dumps(w.geometry)) for w in wards])
        cur.execute("UPDATE wards SET g32 = ST_Transform(geom, 32643)")
        cur.executemany(
            "INSERT INTO pois VALUES (%(id)s, %(amenity)s, %(format)s, %(name)s, %(brand)s, %(cuisine)s, %(opening_hours)s, "
            "ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326), NULL, NULL)", pois)
        cur.execute("UPDATE pois SET g32 = ST_Transform(geom, 32643)")
        cur.executemany("INSERT INTO places VALUES (%s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326))",
                        [(name, kind, lon, lat) for lon, lat, name, kind in context["places"]])
        for table in ("colleges", "offices", "stations"):
            cur.executemany(f"INSERT INTO {table} VALUES (%s, ST_Transform(ST_SetSRID(ST_MakePoint(%s, %s), 4326), 32643))",
                            [(name, lon, lat) for lon, lat, name in context[table]])
        cur.executemany("INSERT INTO roads VALUES (%s, ST_Transform(ST_SetSRID(ST_GeomFromText(%s), 4326), 32643))",
                        [(r["class"], "LINESTRING(" + ",".join(f"{x} {y}" for x, y in r["coords"]) + ")")
                         for r in context["classified_roads"]])
        size = context["road_grid"]["cell_m"]
        cur.executemany("INSERT INTO road_cells VALUES (%s, ST_SetSRID(ST_MakePoint(%s, %s), 32643))",
                        [(m, (i + 0.5) * size, (j + 0.5) * size) for i, j, m in context["road_grid"]["cells"]])
        for table, column in (("wards", "g32"), ("pois", "g32"), ("colleges", "g32"), ("offices", "g32"),
                              ("stations", "g32"), ("roads", "g32"), ("road_cells", "g32"), ("places", "geom")):
            cur.execute(f"CREATE INDEX ON {table} USING gist ({column})")


def assign_wards(conn: psycopg.Connection) -> dict:
    """Put each outlet in the ward that contains it (ST_Contains), and count
    what falls outside every ward or inside two overlapping ones."""
    overlaps = conn.execute("""
        SELECT count(*) FROM (SELECT p.id FROM pois p JOIN wards w ON ST_Contains(w.geom, p.geom)
                              GROUP BY p.id HAVING count(*) > 1) x""").fetchone()[0]
    conn.execute("""
        UPDATE pois SET ward = m.key FROM (
            SELECT DISTINCT ON (p.id) p.id, w.key FROM pois p JOIN wards w ON ST_Contains(w.geom, p.geom)
            ORDER BY p.id, w.key) m
        WHERE pois.id = m.id""")
    outside = conn.execute("SELECT count(*) FROM pois WHERE ward IS NULL").fetchone()[0]
    return {"outside": outside, "in_two_wards": overlaps}


def pcmc_names(conn: psycopg.Connection) -> dict[str, str]:
    """PCMC wards have no names in the source; use the OSM place inside each,
    preferring a suburb over a neighbourhood, then the one nearest the ward's middle."""
    rows = conn.execute("""
        SELECT DISTINCT ON (w.key) w.key, pl.name
        FROM wards w JOIN places pl ON ST_Contains(w.geom, pl.geom)
        WHERE w.corporation = 'PCMC' AND pl.name <> ''
        ORDER BY w.key, (pl.place = 'suburb') DESC, ST_Distance(pl.geom, ST_PointOnSurface(w.geom))""").fetchall()
    return dict(rows)


def pois_frame(conn: psycopg.Connection) -> pd.DataFrame:
    rows = conn.execute("""
        SELECT id, amenity, format, name, brand, cuisine, opening_hours, ward,
               ST_X(geom) AS lon, ST_Y(geom) AS lat FROM pois WHERE ward IS NOT NULL ORDER BY id""").fetchall()
    return pd.DataFrame(rows, columns=["id", "amenity", "format", "name", "brand", "cuisine", "opening_hours", "ward",
                                       "lon", "lat"])


def wards_frame(conn: psycopg.Connection) -> pd.DataFrame:
    rows = conn.execute("""
        SELECT key, corporation, number, title, admin_zone, population,
               ST_Area(g32) / 1e6 AS area_km2, ST_AsGeoJSON(geom, 5) AS geojson
        FROM wards ORDER BY key""").fetchall()
    frame = pd.DataFrame(rows, columns=["key", "corporation", "number", "title", "admin_zone", "population", "area_km2",
                                        "geojson"])
    return frame.set_index("key")


def nearest_places(conn: psycopg.Connection) -> dict[str, str]:
    """The OSM place nearest each ward's interior point, for naming wards
    that have no place inside them."""
    rows = conn.execute("""
        SELECT w.key, (SELECT pl.name FROM places pl WHERE pl.name <> ''
                       ORDER BY pl.geom <-> ST_PointOnSurface(w.geom) LIMIT 1)
        FROM wards w""").fetchall()
    return dict(rows)


def ward_places(conn: psycopg.Connection) -> dict[str, list[str]]:
    """The OSM place names inside each ward. Ward titles are official but
    often name a landmark ("Balgandharva"), while people ask about places
    ("Deccan Gymkhana"), so these become the ward's aliases."""
    rows = conn.execute("""
        SELECT w.key, array_agg(DISTINCT pl.name ORDER BY pl.name)
        FROM wards w JOIN places pl ON ST_Contains(w.geom, pl.geom)
        WHERE pl.name <> '' GROUP BY w.key""").fetchall()
    return dict(rows)


def rent_streets(conn: psycopg.Connection, streets: list[dict]) -> tuple[dict[str, list[str]], list[str]]:
    """Put each published rent street in the wards it runs through. A street
    names its wards by official title ("ward:Koregaon Park") or by an OSM
    place, which lands in whichever ward contains it ("place:Aundh"). Returns
    ward key -> streets, and the references that matched no ward."""
    matches: dict[str, list[str]] = {}
    unmatched = []
    for street in streets:
        for ref in street["wards"]:
            kind, name = ref.split(":", 1)
            if kind == "ward":
                rows = conn.execute("SELECT key FROM wards WHERE title = %s", (name,)).fetchall()
            else:
                rows = conn.execute("""
                    SELECT DISTINCT w.key FROM wards w JOIN places pl ON ST_Contains(w.geom, pl.geom)
                    WHERE pl.name = %s""", (name,)).fetchall()
            if not rows:
                unmatched.append(f"{street['street']} ({ref})")
            for (key,) in rows:
                if street["street"] not in matches.setdefault(key, []):
                    matches[key].append(street["street"])
    return matches, unmatched


def ward_features(conn: psycopg.Connection) -> pd.DataFrame:
    """The capacity model's inputs, one row per ward. None of them is derived
    from the food and drink outlets the model predicts."""
    centre = f"ST_Transform(ST_SetSRID(ST_MakePoint({CITY_CENTRE[0]}, {CITY_CENTRE[1]}), 4326), 32643)"
    rows = conn.execute(f"""
        WITH w AS (SELECT key, population, g32, ST_Area(g32) / 1e6 AS km2, ST_PointOnSurface(g32) AS inside FROM wards)
        SELECT w.key,
               w.population / w.km2 AS residents_per_km2,
               (SELECT ST_Distance(x.g32, w.inside) FROM colleges x ORDER BY x.g32 <-> w.inside LIMIT 1) / 1000 AS km_to_college,
               (SELECT ST_Distance(x.g32, w.inside) FROM offices x ORDER BY x.g32 <-> w.inside LIMIT 1) / 1000 AS km_to_office,
               (SELECT ST_Distance(x.g32, w.inside) FROM stations x ORDER BY x.g32 <-> w.inside LIMIT 1) / 1000 AS km_to_station,
               COALESCE((SELECT sum(r.metres) FROM road_cells r WHERE ST_Contains(w.g32, r.g32)), 0) / w.km2 AS road_m_per_km2,
               COALESCE((SELECT sum(ST_Length(ST_Intersection(r.g32, w.g32))) FROM roads r
                         WHERE ST_Intersects(r.g32, w.g32)), 0) / w.km2 AS classified_road_m_per_km2,
               ST_Distance(w.inside, {centre}) / 1000 AS km_from_centre
        FROM w ORDER BY w.key""").fetchall()
    columns = ["key", "residents_per_km2", "km_to_college", "km_to_office", "km_to_station", "road_m_per_km2",
               "classified_road_m_per_km2", "km_from_centre"]
    return pd.DataFrame(rows, columns=columns).set_index("key").astype(float)
