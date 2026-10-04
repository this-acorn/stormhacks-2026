"""Published ECCC smoke forecast hours, pinned to the latest RAQDPS model run."""

import threading
import time
import xml.etree.ElementTree as ET
from datetime import UTC, datetime, timedelta

import httpx

GEOMET_URL = "https://geo.weather.gc.ca/geomet"
SMOKE_LAYER = "RAQDPS.Sfc_PM2.5-WildfireSmokePlume"
NS = {"w": "http://www.opengis.net/wms"}
_lock = threading.Lock()
_xml: str | None = None
_expires = 0.0


def stamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


def iso(value: datetime) -> str:
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_catalog(xml: str, now: datetime) -> dict:
    try:
        root = ET.fromstring(xml)
        layer = next(node for node in root.findall(".//w:Layer", NS)
                     if node.findtext("w:Name", "", NS) == SMOKE_LAYER)
        dimensions = {node.attrib["name"]: node for node in layer.findall("w:Dimension", NS)}
        run = stamp(dimensions["reference_time"].attrib["default"])
        if run > now or now - run > timedelta(hours=36):
            raise ValueError("The latest smoke model run is unavailable or outdated.")
        published = []
        for item in (dimensions["time"].text or "").strip().split(","):
            if "/" not in item:
                published.append(stamp(item))
                continue
            first, last, interval = item.split("/")
            if interval != "PT1H":
                raise ValueError("Unexpected smoke forecast interval.")
            start, end = stamp(first), stamp(last)
            if end < start or end - start > timedelta(hours=144):
                raise ValueError("Invalid smoke forecast range.")
            published.extend(start + timedelta(hours=i)
                             for i in range(int((end - start).total_seconds() / 3600) + 1))
        current_hour = now.replace(minute=0, second=0, microsecond=0)
        times = sorted({t for t in published if current_hour <= t <= run + timedelta(hours=72)})
        if not times:
            raise ValueError("No current smoke forecast hours are available.")
        box = layer.find("w:EX_GeographicBoundingBox", NS)
        bounds = [float(box.findtext("w:" + name, "", NS)) for name in
                  ("westBoundLongitude", "southBoundLatitude", "eastBoundLongitude", "northBoundLatitude")]
    except (ET.ParseError, StopIteration, KeyError, AttributeError, TypeError) as error:
        raise ValueError("Invalid smoke forecast metadata.") from error
    return {
        "source": "ECCC · RAQDPS", "layer": SMOKE_LAYER, "modelRun": iso(run),
        "times": [iso(t) for t in times], "bounds": bounds,
        "resolutionKm": 10, "coverage": "North America", "units": "µg/m³",
    }


def latest_smoke_forecast() -> dict:
    global _xml, _expires
    with _lock:
        now = datetime.now(UTC)
        if _xml is None or time.monotonic() >= _expires:
            response = httpx.get(GEOMET_URL, params={
                "service": "WMS", "version": "1.3.0", "request": "GetCapabilities", "layer": SMOKE_LAYER,
            }, timeout=12, follow_redirects=True)
            response.raise_for_status()
            result = parse_catalog(response.text, now)
            _xml, _expires = response.text, time.monotonic() + 600
            return result
        return parse_catalog(_xml, now)
