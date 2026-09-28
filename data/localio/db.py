"""PostGIS: load the seed data, then do every spatial join in SQL.

The db service is a throwaway PostGIS (tmpfs, no volume), so each run
starts from an empty database. Geometry is stored in WGS84 (4326) for the
map and in UTM 43N (32643) for areas in metres.
"""

import os
import time

import pandas as pd
import psycopg
from shapely import wkb

from localio.sources import Ward

DEFAULT_URL = "postgresql://localio:localio@db:5432/localio"
# Offices, colleges and stations: the places that bring people to a ward.
DRAWS = ("offices", "colleges", "stations")

SCHEMA = """
CREATE EXTENSION IF NOT EXISTS postgis;
DROP TABLE IF EXISTS wards, pois, places, colleges, offices, stations CASCADE;
CREATE TABLE wards (key text PRIMARY KEY, corporation text, number int, title text, admin_zone text,
                    population int, geom geometry(MultiPolygon, 4326), g32 geometry(MultiPolygon, 32643));
CREATE TABLE pois (id text PRIMARY KEY, amenity text, format text, name text, brand text, cuisine text,
                   geom geometry(Point, 4326), ward text);
CREATE TABLE places (name text, place text, geom geometry(Point, 4326));
CREATE TABLE colleges (name text, geom geometry(Point, 4326));
CREATE TABLE offices (name text, geom geometry(Point, 4326));
CREATE TABLE stations (name text, geom geometry(Point, 4326));
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
            "INSERT INTO pois VALUES (%(id)s, %(amenity)s, %(format)s, %(name)s, %(brand)s, %(cuisine)s, "
            "ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326), NULL)", pois)
        cur.executemany("INSERT INTO places VALUES (%s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326))",
                        [(name, kind, lon, lat) for lon, lat, name, kind in context["places"]])
        for table in DRAWS:
            cur.executemany(f"INSERT INTO {table} VALUES (%s, ST_SetSRID(ST_MakePoint(%s, %s), 4326))",
                            [(name, lon, lat) for lon, lat, name in context[table]])
        for table in ("wards", "pois", "places", *DRAWS):
            cur.execute(f"CREATE INDEX ON {table} USING gist (geom)")


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


def wards_frame(conn: psycopg.Connection) -> pd.DataFrame:
    """One row per ward, with its area in km², its GeoJSON, and how many
    offices, colleges and stations sit inside it."""
    counts = ", ".join(f"(SELECT count(*) FROM {t} x WHERE ST_Contains(w.geom, x.geom)) AS {t}" for t in DRAWS)
    rows = conn.execute(f"""
        SELECT key, corporation, number, title, admin_zone, population,
               ST_Area(g32) / 1e6 AS area_km2, ST_AsGeoJSON(geom, 5) AS geojson, {counts}
        FROM wards w ORDER BY key""").fetchall()
    columns = ["key", "corporation", "number", "title", "admin_zone", "population", "area_km2", "geojson", *DRAWS]
    return pd.DataFrame(rows, columns=columns).set_index("key")


def pois_frame(conn: psycopg.Connection) -> pd.DataFrame:
    rows = conn.execute("""
        SELECT id, amenity, format, name, brand, cuisine, ward, ST_X(geom) AS lon, ST_Y(geom) AS lat
        FROM pois WHERE ward IS NOT NULL ORDER BY id""").fetchall()
    return pd.DataFrame(rows, columns=["id", "amenity", "format", "name", "brand", "cuisine", "ward", "lon", "lat"])


def ward_places(conn: psycopg.Connection) -> dict[str, list[str]]:
    """The OSM place names inside each ward. Ward titles are official but
    often name a landmark ("Balgandharva"), while people ask about places
    ("Deccan Gymkhana"), so these become the ward's aliases."""
    rows = conn.execute("""
        SELECT w.key, array_agg(DISTINCT pl.name ORDER BY pl.name)
        FROM wards w JOIN places pl ON ST_Contains(w.geom, pl.geom)
        WHERE pl.name <> '' GROUP BY w.key""").fetchall()
    return dict(rows)


def suburbs(conn: psycopg.Connection) -> dict[str, str]:
    """For each PCMC ward, the OSM place inside it that best stands for it:
    a suburb over a neighbourhood, then the one nearest the ward's middle."""
    rows = conn.execute("""
        SELECT DISTINCT ON (w.key) w.key, pl.name
        FROM wards w JOIN places pl ON ST_Contains(w.geom, pl.geom)
        WHERE w.corporation = 'PCMC' AND pl.name <> ''
        ORDER BY w.key, (pl.place = 'suburb') DESC, ST_Distance(pl.geom, ST_PointOnSurface(w.geom))""").fetchall()
    return dict(rows)


def nearest_places(conn: psycopg.Connection) -> dict[str, str]:
    """The OSM place nearest each ward's interior point, for naming PCMC
    wards that have no place inside them."""
    rows = conn.execute("""
        SELECT w.key, (SELECT pl.name FROM places pl WHERE pl.name <> ''
                       ORDER BY pl.geom <-> ST_PointOnSurface(w.geom) LIMIT 1)
        FROM wards w""").fetchall()
    return dict(rows)


def rent_streets(conn: psycopg.Connection, streets: list[dict]) -> tuple[dict[str, list[str]], list[str]]:
    """Put each published high street in the wards it runs through. A street
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
