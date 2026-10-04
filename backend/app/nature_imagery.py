"""Monthly Sentinel-2 visual mosaics from Microsoft's public Planetary Computer.

Scenes are restricted to the selected UTC month and sorted by scene cloud cover.
This is a low-cloud scene mosaic, not a cloud-free or per-pixel monthly mean product.
"""

import re
import threading
import time
from datetime import UTC, datetime, timedelta
from concurrent.futures import Future

import httpx

STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"
DATA_URL = "https://planetarycomputer.microsoft.com/api/data/v1"
COLLECTION = "sentinel-2-l2a"
FIRST_MONTH = "2018-01"  # Early L2A coverage is regional; missing observations remain blank.
MAX_CLOUD_COVER = 20
_lock = threading.Lock()
_catalog_lock = threading.Lock()
_catalog: tuple[float, dict] | None = None
_mosaics: dict[str, tuple[float, dict]] = {}
_inflight: dict[str, Future] = {}


def month_bounds(month: str) -> tuple[datetime, datetime]:
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
        raise ValueError("Use a month in YYYY-MM format.")
    start = datetime.strptime(month, "%Y-%m").replace(tzinfo=UTC)
    end = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    return start, end


def iso(value: datetime) -> str:
    return value.isoformat(timespec="microseconds").replace("+00:00", "Z")


def catalog_from_latest(latest: str, now: datetime) -> dict:
    observed = datetime.fromisoformat(latest.replace("Z", "+00:00")).astimezone(UTC)
    if observed > now or observed.year < 2018:
        raise ValueError("Invalid Sentinel-2 catalog date.")
    # Only elapsed months, also allowing for a lagging provider catalog.
    stop = min(now, observed).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    cursor, _ = month_bounds(FIRST_MONTH)
    months = []
    while cursor < stop:
        months.append(cursor.strftime("%Y-%m"))
        _, cursor = month_bounds(months[-1])
    if not months:
        raise ValueError("No complete months of Sentinel-2 imagery are available.")
    return {"months": months, "latestObservation": iso(observed), "minZoom": 9,
            "maxZoom": 14, "cloudCoverMax": MAX_CLOUD_COVER}


def nature_catalog() -> dict:
    global _catalog
    with _catalog_lock:
        if _catalog and _catalog[0] > time.monotonic():
            return _catalog[1]
        now = datetime.now(UTC)
        response = httpx.get(f"{STAC_URL}/search", params={
            "collections": COLLECTION, "limit": 1, "sortby": "-datetime",
            "datetime": f"{FIRST_MONTH}-01T00:00:00Z/{iso(now)}",
        }, timeout=12)
        response.raise_for_status()
        try:
            result = catalog_from_latest(response.json()["features"][0]["properties"]["datetime"], now)
        except (KeyError, IndexError, TypeError) as error:
            raise ValueError("Invalid Sentinel-2 catalog response.") from error
        _catalog = (time.monotonic() + 3600, result)
        return result


def monthly_mosaic(month: str) -> dict:
    start, end = month_bounds(month)
    if month not in nature_catalog()["months"]:
        raise ValueError("This month is outside the available Sentinel-2 archive.")
    with _lock:
        cached = _mosaics.get(month)
        if cached and cached[0] > time.monotonic():
            return cached[1]
        flight = _inflight.get(month)
        owner = flight is None
        if owner:
            flight = Future()
            _inflight[month] = flight
    # A slow speculative month must not block a newly selected month. Duplicate
    # requests for the same month still share one registration.
    if not owner:
        return flight.result()
    try:
        response = httpx.post(f"{DATA_URL}/mosaic/register", json={
            "collections": [COLLECTION],
            # STAC intervals are inclusive, so do not include the next month's first scene.
            "datetime": f"{iso(start)}/{iso(end - timedelta(microseconds=1))}",
            "query": {"eo:cloud_cover": {"lte": MAX_CLOUD_COVER}},
            "sortby": [{"field": "eo:cloud_cover", "direction": "asc"},
                       {"field": "datetime", "direction": "desc"}],
        }, timeout=20)
        response.raise_for_status()
        body = response.json()
        search_id = body.get("id") if isinstance(body, dict) else None
        if not isinstance(search_id, str) or not re.fullmatch(r"[a-f0-9]{32}", search_id):
            raise ValueError("Invalid Sentinel-2 mosaic response.")
        result = {"month": month, "searchId": search_id, "minZoom": 9, "maxZoom": 14,
                  "cloudCoverMax": MAX_CLOUD_COVER}
        # Bound memory while allowing repeated timeline playback to reuse registered queries.
        with _lock:
            if len(_mosaics) >= 120:
                _mosaics.pop(next(iter(_mosaics)))
            _mosaics[month] = (time.monotonic() + 3600, result)
        flight.set_result(result)
        return result
    except Exception as error:
        flight.set_exception(error)
        raise
    finally:
        with _lock:
            _inflight.pop(month, None)
