"""Precomputed global Sentinel-2 browse mosaics, served as ordinary saved PNG tiles.

HLS S30 contains Sentinel-2 observations only (not the Landsat HLS L30 product).
We take a per-channel median of NASA GIBS's daily rendered RGB browse images.
These visual composites are not scientific reflectance rasters or cloud-free maps.
"""

import asyncio
import json
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from io import BytesIO
from pathlib import Path
from uuid import uuid4
from xml.etree import ElementTree as ET

import httpx
import numpy as np
from PIL import Image

from app.nature_imagery import month_bounds

ROOT = Path(__file__).resolve().parents[1]
LAYER = "HLS_S30_Nadir_BRDF_Adjusted_Reflectance"
GIBS = "https://gibs.earthdata.nasa.gov"
MAX_ZOOM = 2
SIZE = 256 * 2 ** MAX_ZOOM
WORLD = 20037508.342789244
log = logging.getLogger(__name__)


def published_dates(content: bytes) -> list[date]:
    """Expand only the provider's advertised dates; never let WMS snap to an old day."""
    ns = {"w": "http://www.opengis.net/wmts/1.0", "o": "http://www.opengis.net/ows/1.1"}
    for layer in ET.fromstring(content).findall(".//w:Layer", ns):
        if layer.findtext("o:Identifier", namespaces=ns) != LAYER:
            continue
        dates = set()
        for value in layer.findall("w:Dimension/w:Value", ns):
            parts = (value.text or "").split("/")
            if len(parts) == 1:
                dates.add(date.fromisoformat(parts[0][:10]))
            elif len(parts) == 3 and parts[2] == "P1D":
                current, end = date.fromisoformat(parts[0][:10]), date.fromisoformat(parts[1][:10])
                while current <= end:
                    dates.add(current)
                    current += timedelta(days=1)
            else:
                raise ValueError("Unexpected Sentinel-2 imagery date interval.")
        if dates:
            return sorted(dates)
    raise ValueError("Sentinel-2 browse archive is unavailable.")


def composite(frames: list[np.ndarray]) -> np.ndarray:
    """Median of observed RGB pixels, preserving genuinely unobserved pixels as alpha=0."""
    stack = np.stack(frames)
    result = np.zeros(stack.shape[1:], dtype=np.uint8)
    # Integer sorting avoids the large masked/float temporaries of nanmedian.
    for top in range(0, result.shape[0], 32):
        part = stack[:, top:top + 32]
        valid = part[..., 3] > 0
        count = valid.sum(axis=0).astype(np.int32)
        values = np.where(valid[..., None], part[..., :3], 255)
        values.sort(axis=0)
        lower, upper = np.maximum(count - 1, 0) // 2, count // 2
        low = np.take_along_axis(values, lower[None, ..., None], axis=0)[0].astype(np.uint16)
        high = np.take_along_axis(values, upper[None, ..., None], axis=0)[0].astype(np.uint16)
        result[top:top + 32, :, :3] = ((low + high) // 2).astype(np.uint8)
        result[top:top + 32, :, 3] = (count > 0).astype(np.uint8) * 255
    result[result[..., 3] == 0] = 0
    return result


def atomic_write(path: Path, content: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        temporary.write_bytes(content)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


class NatureOverviewStore:
    def __init__(self, root: Path = ROOT / "data/nature-overview/v1"):
        self.root = root
        self.lock = threading.Lock()

    def metadata(self, month: str) -> dict | None:
        month_bounds(month)
        try:
            data = json.loads((self.root / month / "manifest.json").read_text(encoding="utf-8"))
            return data if data.get("month") == month and data.get("version") == 1 else None
        except (OSError, ValueError):
            return None

    def snapshot(self) -> dict | None:
        try:
            data = json.loads((self.root / "catalog.json").read_text(encoding="utf-8"))
            return data if data.get("months") and data.get("overviewMaxZoom") == MAX_ZOOM else None
        except (OSError, ValueError):
            return None

    def publish(self) -> dict:
        with self.lock:
            records = []
            for path in sorted(self.root.glob("????-??/manifest.json")):
                record = self.metadata(path.parent.name)
                if record:
                    records.append(record)
            if not records:
                raise ValueError("No saved Sentinel-2 months are ready.")
            data = {
                "months": [record["month"] for record in records],
                "latestObservation": max(record["dates"][-1] for record in records) + "T00:00:00Z",
                "minZoom": 0, "maxZoom": 14, "detailMinZoom": 9,
                "overviewMaxZoom": MAX_ZOOM, "cloudCoverMax": 20,
                "overviewSource": "NASA HLS S30 / Sentinel-2 / GIBS",
            }
            atomic_write(self.root / "catalog.json", json.dumps(data).encode())
            return data

    def tile(self, month: str, z: int, x: int, y: int) -> Path:
        month_bounds(month)
        if not (0 <= z <= MAX_ZOOM and 0 <= x < 2 ** z and 0 <= y < 2 ** z):
            raise ValueError("Invalid overview tile coordinates.")
        if not self.metadata(month):
            raise FileNotFoundError("This monthly overview has not been prepared yet.")
        path = self.root / month / str(z) / str(x) / f"{y}.png"
        if not path.is_file():
            raise FileNotFoundError("Monthly overview tile unavailable.")
        return path

    def dates(self, client: httpx.Client) -> list[date]:
        response = client.get(f"{GIBS}/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml")
        response.raise_for_status()
        return published_dates(response.content)

    def prepare(self, month: str, dates: list[date], client: httpx.Client,
                excluded_dates: set[date] | None = None) -> dict:
        cached = self.metadata(month)
        if cached:
            return cached
        start, end = month_bounds(month)
        if end.date() > datetime.now(UTC).date():
            raise ValueError("Only completed months can be prepared.")
        excluded = sorted(day for day in (excluded_dates or set()) if start.date() <= day < end.date())
        days = sorted(day for day in dates if start.date() <= day < end.date() and day not in excluded)
        if not days:
            raise ValueError("No observations in this month.")

        def read_day(day: date) -> np.ndarray:
            response = client.get(f"{GIBS}/wms/epsg3857/best/wms.cgi", params={
                "SERVICE": "WMS", "VERSION": "1.1.1", "REQUEST": "GetMap",
                "LAYERS": LAYER, "STYLES": "", "SRS": "EPSG:3857",
                "BBOX": f"{-WORLD},{-WORLD},{WORLD},{WORLD}",
                "WIDTH": SIZE, "HEIGHT": SIZE, "FORMAT": "image/png",
                "TRANSPARENT": "TRUE", "TIME": day.isoformat(),
            })
            response.raise_for_status()
            if not response.content.startswith(b"\x89PNG\r\n\x1a\n"):
                raise ValueError(f"The provider did not return satellite imagery for {day}.")
            with Image.open(BytesIO(response.content)) as image:
                if image.size != (SIZE, SIZE):
                    raise ValueError("Unexpected satellite image dimensions.")
                return np.array(image.convert("RGBA"))

        with ThreadPoolExecutor(max_workers=4) as pool:
            image = Image.fromarray(composite(list(pool.map(read_day, days))))
        if image.getchannel("A").getextrema()[1] == 0:
            raise ValueError("This month has no visible observations.")
        for z in range(MAX_ZOOM + 1):
            level = image.resize((256 * 2 ** z, 256 * 2 ** z), Image.Resampling.LANCZOS)
            for x in range(2 ** z):
                for y in range(2 ** z):
                    output = BytesIO()
                    level.crop((x * 256, y * 256, (x + 1) * 256, (y + 1) * 256)).save(output, format="PNG")
                    atomic_write(self.root / month / str(z) / str(x) / f"{y}.png", output.getvalue())
        record = {
            "version": 1, "month": month, "dates": [day.isoformat() for day in days],
            "builtAt": datetime.now(UTC).isoformat(), "layer": LAYER,
            "maxZoom": MAX_ZOOM, "projection": "EPSG:3857", "size": [SIZE, SIZE],
            "sourceResolutionMeters": 30,
            "excludedDates": [day.isoformat() for day in excluded],
            "exclusionReason": "Explicitly excluded unreadable provider observations during preparation." if excluded else None,
            "processing": "Per-channel median of daily rendered RGB browse images; clouds and gaps may remain.",
            "source": "https://gibs.earthdata.nasa.gov/layer-metadata/v1.0/HLS_S30_Nadir_BRDF_Adjusted_Reflectance.json",
        }
        # Publish only after every tile exists; request handlers never generate imagery.
        atomic_write(self.root / month / "manifest.json", json.dumps(record).encode())
        return record

    def refresh(self):
        # The initial archive is explicitly prepared by the CLI, not by a page view.
        snapshot = self.snapshot()
        if not snapshot:
            return
        with httpx.Client(timeout=60) as client:
            dates = self.dates(client)
            stop = min(datetime.now(UTC).date(), dates[-1]).replace(day=1)
            current = month_bounds(snapshot["months"][-1])[1].date()
            while current < stop:
                month = current.strftime("%Y-%m")
                self.prepare(month, dates, client)
                self.publish()
                current = month_bounds(month)[1].date()

    async def run(self):
        while True:
            try:
                await asyncio.to_thread(self.refresh)
            except Exception:
                log.exception("Saved Sentinel-2 archive refresh failed; keeping published imagery")
            await asyncio.sleep(3600)


overview_store = NatureOverviewStore()


def overview_catalog() -> dict:
    snapshot = overview_store.snapshot()
    if not snapshot:
        raise ValueError("The saved monthly satellite archive has not been prepared yet.")
    return snapshot
