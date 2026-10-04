"""Read a downloaded NASA FIRMS dataset and group its detections into fire events."""

import csv
import hashlib
import json
import math
import re
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "firms"
DEFAULT_DATASET = "bc-wildfire-2023-08"
EVENT_CELL_KM = 2.0

SATELLITES = {"N20": "NOAA-20", "N21": "NOAA-21", "N": "Suomi NPP"}
CONFIDENCE = {"l": "low", "n": "nominal", "h": "high"}


@dataclass(frozen=True)
class Detection:
    source_key: str
    event_key: str
    latitude: float
    longitude: float
    acquired_at: datetime  # UTC
    confidence: str
    frp_mw: float | None
    brightness_k: float | None
    day_night: str
    satellite: str
    instrument: str


@dataclass(frozen=True)
class Dataset:
    name: str
    metadata: dict
    detections: list[Detection]  # oldest first


def _number(value: str) -> float | None:
    try:
        return float(value)
    except ValueError:
        return None


def group_into_events(points: list[tuple[float, float]]) -> list[int]:
    """Detections in the same or touching 2 km grid cells belong to the same fire event.

    Returns a group number for each (latitude, longitude) point.
    """
    if not points:
        return []
    mid_latitude = sum(lat for lat, _ in points) / len(points)
    cell_lat = EVENT_CELL_KM / 110.574
    cell_lon = EVENT_CELL_KM / (111.320 * math.cos(math.radians(mid_latitude)))
    cells = [(math.floor(lat / cell_lat), math.floor(lon / cell_lon)) for lat, lon in points]

    # Union-find over occupied cells: link every cell to its occupied neighbours.
    parent = {cell: cell for cell in cells}

    def root(cell):
        while parent[cell] != cell:
            parent[cell] = parent[parent[cell]]
            cell = parent[cell]
        return cell

    for i, j in list(parent):
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                neighbour = (i + di, j + dj)
                if neighbour in parent:
                    a, b = root((i, j)), root(neighbour)
                    if a != b:
                        parent[a] = b

    numbers: dict = {}
    return [numbers.setdefault(root(cell), len(numbers)) for cell in cells]


@lru_cache
def load_dataset(name: str) -> Dataset:
    """Load data/firms/<name>.csv. Raises KeyError if that dataset was never downloaded."""
    csv_path = DATA_DIR / f"{name}.csv"
    if not re.fullmatch(r"[a-z0-9-]+", name) or not csv_path.exists():
        raise KeyError(name)
    metadata = json.loads((DATA_DIR / f"{name}.json").read_text(encoding="utf-8"))

    rows, seen = [], set()
    with open(csv_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["type"] != "0":  # keep presumed vegetation fires; skip static and offshore heat sources
                continue
            time = row["acq_time"].zfill(4)
            key = f"{name}:{row['satellite']}:{row['acq_date']}T{time}:{row['latitude']},{row['longitude']}"
            if key in seen:
                continue
            seen.add(key)
            acquired = datetime.strptime(f"{row['acq_date']} {time}", "%Y-%m-%d %H%M")
            rows.append((acquired, float(row["latitude"]), float(row["longitude"]), key, row))
    rows.sort(key=lambda r: (r[0], r[3]))

    groups = group_into_events([(lat, lon) for _, lat, lon, _, _ in rows])
    # An event is named after its earliest detection, so the name stays the same on every replay.
    first_key: dict[int, str] = {}
    for (_, _, _, key, _), group in zip(rows, groups):
        first_key.setdefault(group, key)

    detections = [
        Detection(
            source_key=key,
            event_key=f"{name}:{hashlib.sha1(first_key[group].encode()).hexdigest()[:12]}",
            latitude=lat,
            longitude=lon,
            acquired_at=acquired,
            confidence=CONFIDENCE.get(row["confidence"], row["confidence"]),
            frp_mw=_number(row["frp"]),
            brightness_k=_number(row["bright_ti4"]),
            day_night=row["daynight"],
            satellite=SATELLITES.get(row["satellite"], row["satellite"]),
            instrument=row["instrument"],
        )
        for (acquired, lat, lon, key, row), group in zip(rows, groups)
    ]
    return Dataset(name=name, metadata=metadata, detections=detections)
