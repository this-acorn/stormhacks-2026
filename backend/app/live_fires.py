"""Current FIRMS observations for Explore, independent of the historical demo database."""

import asyncio
import csv
import gzip
import io
import json
import logging
import math
import threading
import time
from datetime import UTC, datetime, timedelta

import httpx

FEED_URL = "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv"
CACHE_SECONDS = 600
REFRESH_SECONDS = 540  # the background refresh lands before the cached feed expires
log = logging.getLogger(__name__)
_lock = threading.Lock()
_cached: dict | None = None
_bodies = (b"", b"")  # the cached feed as JSON, plain and gzip-compressed
_expires = 0.0


def iso(value: datetime) -> str:
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def acquired(date: str, hhmm: str) -> datetime:
    """FIRMS writes "2026-10-04" and "930". Read by hand: strptime alone took seconds on the global feed."""
    hhmm = hhmm.zfill(4)
    if len(date) != 10 or date[4] != "-" or date[7] != "-" or len(hhmm) != 4:
        raise ValueError(f"Unexpected FIRMS time: {date} {hhmm}")
    return datetime(int(date[:4]), int(date[5:7]), int(date[8:]), int(hhmm[:2]), int(hhmm[2:]), tzinfo=UTC)


def parse_fires(text: str, now: datetime) -> dict:
    reader = csv.DictReader(io.StringIO(text))
    required = {"latitude", "longitude", "acq_date", "acq_time", "confidence", "frp"}
    if not required.issubset(reader.fieldnames or []):
        raise ValueError("FIRMS returned an invalid observation file.")
    cutoff = now - timedelta(hours=24)
    points = []
    seen = set()
    newest = None
    for row in reader:
        try:
            stamp = acquired(row["acq_date"], row["acq_time"])
            lng, lat, frp = float(row["longitude"]), float(row["latitude"]), float(row["frp"])
        except (ValueError, TypeError, KeyError):
            continue
        if not all(math.isfinite(v) for v in (lng, lat, frp)) or not (-180 <= lng <= 180 and -90 <= lat <= 90):
            continue
        if stamp > now:
            continue
        newest = max(newest, stamp) if newest else stamp
        key = (lng, lat, stamp)
        if stamp < cutoff or row["confidence"] not in ("n", "h", "nominal", "high") or key in seen:
            continue
        seen.add(key)
        points.append((lng, lat, max(0, frp), stamp))
    if newest and newest < cutoff:
        raise ValueError("FIRMS has not published observations from the past 24 hours.")

    # Adjacent ~3 km cells group nearby detections; every valid pixel is retained.
    cells: dict[tuple[int, int], list[int]] = {}
    for index, (lng, lat, _, _) in enumerate(points):
        cells.setdefault((math.floor(lng / 0.03), math.floor(lat / 0.03)), []).append(index)
    parent = {cell: cell for cell in cells}

    def find(cell):
        while parent[cell] != cell:
            parent[cell] = parent[parent[cell]]
            cell = parent[cell]
        return cell

    for cell in cells:
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                other = (cell[0] + dx, cell[1] + dy)
                if other in cells:
                    parent[find(other)] = find(cell)
    groups: dict[tuple[int, int], list[int]] = {}
    for cell, members in cells.items():
        groups.setdefault(find(cell), []).extend(members)

    start = min((p[3] for p in points), default=cutoff)
    end = max((p[3] for p in points), default=cutoff)
    clusters, detections = [], []
    for index, members in enumerate(sorted(groups.values(), key=lambda group: -sum(points[i][2] for i in group))):
        group = [points[i] for i in members]
        lngs, lats, powers, stamps = zip(*group)
        weight = sum(max(p, 1) for p in powers)
        clusters.append({
            "id": f"current-fire-{index}",
            "center": [sum(p[0] * max(p[2], 1) for p in group) / weight,
                       sum(p[1] * max(p[2], 1) for p in group) / weight],
            "bbox": [min(lngs), min(lats), max(lngs), max(lats)],
            "count": len(group), "frpTotal": round(sum(powers)), "frpMax": max(powers),
            "first": iso(min(stamps)), "last": iso(max(stamps)), "place": None,
        })
        detections.extend([lng, lat, (stamp - start).total_seconds() / 60, frp, index]
                          for lng, lat, frp, stamp in group)
    return {
        "title": "Satellite heat detections, past 24 hours",
        "source": "NASA FIRMS · VIIRS NOAA-20 375 m · near real time",
        "note": "Satellite heat detections, not confirmed wildfires. Some may be industrial or agricultural heat sources. Satellite observation and publication introduce a delay.",
        "playback": False, "start": iso(start), "end": iso(end),
        "windowStart": iso(cutoff), "windowEnd": iso(now),
        "clusters": clusters, "detections": detections,
    }


def download() -> tuple[dict, tuple[bytes, bytes]]:
    # Grouping the global feed takes seconds, so each download is parsed once and served until it
    # expires. The 24-hour window then ends at download time, which windowEnd reports.
    now = datetime.now(UTC)
    response = httpx.get(FEED_URL, timeout=25, follow_redirects=True,
                         headers={"User-Agent": "AidAtlas wildfire observations"})
    response.raise_for_status()
    result = parse_fires(response.text, now)
    result["builtAt"] = iso(now)
    # Encoded once too: serializing and compressing every detection took seconds per request.
    body = json.dumps(result, separators=(",", ":"), allow_nan=False).encode()
    return result, (body, gzip.compress(body, compresslevel=6))


def _store(result: dict, bodies: tuple[bytes, bytes]):
    global _cached, _bodies, _expires
    _cached, _bodies, _expires = result, bodies, time.monotonic() + CACHE_SECONDS


def refresh():
    """Download the next feed while the current one keeps being served."""
    fresh = download()
    with _lock:
        _store(*fresh)


async def keep_fresh():
    # Replaces the feed before it expires, so a page view never waits seconds for NASA and the parse.
    while True:
        try:
            await asyncio.to_thread(refresh)
        except Exception as error:
            log.warning("FIRMS refresh failed; requests will retry: %s", error)
        await asyncio.sleep(REFRESH_SECONDS)


def latest_fires() -> dict:
    with _lock:
        if _cached is None or time.monotonic() >= _expires:
            _store(*download())
        return _cached


def latest_fires_body(gzipped: bool) -> bytes:
    """The current feed as a response body, refreshed like latest_fires()."""
    latest_fires()
    return _bodies[gzipped]
