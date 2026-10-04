from datetime import UTC, date, datetime
from io import BytesIO
import json

import httpx
import numpy as np
from PIL import Image
import pytest

from app import nature_overview as overview


def png(color=(30, 60, 90, 255)):
    stream = BytesIO()
    Image.new("RGBA", (256, 256), color).save(stream, format="PNG")
    return stream.getvalue()


def encode(image):
    stream = BytesIO()
    Image.fromarray(image).save(stream, format="PNG")
    return stream.getvalue()


def test_unseen_land_and_polar_night_are_dark_while_never_imaged_daylight_stays_clear():
    image = np.zeros((8, 8, 4), dtype=np.uint8)
    image[4, 0] = image[0, 0] = [200, 150, 100, 255]
    seen = image[..., 3] > 0
    coverage = seen.copy()
    coverage[4, 1] = True  # Land the satellite observed in another month.
    dark, clear = [*overview.NO_DAYLIGHT, 255], [0, 0, 0, 0]
    january = overview.fill_gaps(image, seen, coverage, "2024-01")
    assert january[4, 0].tolist() == january[0, 0].tolist() == [200, 150, 100, 255]
    assert january[4, 1].tolist() == dark
    assert january[4, 2].tolist() == clear  # Daylit ocean: the basemap shows through.
    assert january[0, 2].tolist() == dark  # Arctic polar night.
    assert january[7, 2].tolist() == clear  # Antarctic summer.
    july = overview.fill_gaps(image, seen, coverage, "2024-07")
    assert july[0, 2].tolist() == clear and july[7, 2].tolist() == dark


def test_saved_months_are_reshaded_against_every_month_without_downloads(tmp_path, monkeypatch):
    monkeypatch.setattr(overview, "SIZE", 256)
    monkeypatch.setattr(overview, "MAX_ZOOM", 0)
    left, right = np.zeros((256, 256, 4), np.uint8), np.zeros((256, 256, 4), np.uint8)
    left[100:150, :128] = right[100:150, 128:] = [30, 60, 90, 255]
    # A month saved before shading existed: raw tiles and no mask of what was seen.
    (tmp_path / "2024-01/0/0").mkdir(parents=True)
    (tmp_path / "2024-01/0/0/0.png").write_bytes(encode(left))
    (tmp_path / "2024-01/manifest.json").write_text(json.dumps({"version": 1, "month": "2024-01"}))
    store = overview.NatureOverviewStore(tmp_path)
    with httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(200, content=encode(right)))) as client:
        store.prepare("2024-02", [date(2024, 2, 1)], client)
    assert store.refill() == 2
    dark, observed = (*overview.NO_DAYLIGHT, 255), (30, 60, 90, 255)
    january, february = (Image.open(store.tile(month, 0, 0, 0)) for month in ("2024-01", "2024-02"))
    assert january.getpixel((10, 120)) == february.getpixel((200, 120)) == observed
    assert january.getpixel((200, 120)) == february.getpixel((10, 120)) == dark
    assert january.getpixel((10, 200)) == (0, 0, 0, 0)  # Never imaged, in daylight.
    assert january.getpixel((10, 5)) == dark  # Polar night.
    tiles = [tmp_path / month / "0/0/0.png" for month in ("2024-01", "2024-02")]
    saved = [path.read_bytes() for path in tiles]
    store.refill()
    assert [path.read_bytes() for path in tiles] == saved


def test_median_uses_only_observed_pixels_and_keeps_no_data_transparent():
    frames = [np.array([[[20, 40, 60, 255], [100, 120, 140, 255], [0, 0, 0, 0]]], dtype=np.uint8),
              np.array([[[40, 80, 100, 255], [255, 255, 255, 0], [255, 255, 255, 0]]], dtype=np.uint8)]
    result = overview.composite(frames)
    assert result.tolist() == [[[30, 60, 80, 255], [100, 120, 140, 255], [0, 0, 0, 0]]]


def test_only_advertised_sentinel_dates_are_used_including_leap_days():
    xml = f'''<Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:o="http://www.opengis.net/ows/1.1">
    <Contents><Layer><o:Identifier>{overview.LAYER}</o:Identifier><Dimension>
    <Value>2024-02-28/2024-03-01/P1D</Value><Value>2024-03-03</Value>
    </Dimension></Layer></Contents></Capabilities>'''.encode()
    assert overview.published_dates(xml) == [date(2024, 2, 28), date(2024, 2, 29), date(2024, 3, 1), date(2024, 3, 3)]
    with pytest.raises(ValueError):
        overview.published_dates(xml.replace(overview.LAYER.encode(), b"different_satellite"))


def test_saves_month_once_and_serves_it_again_after_a_process_restart(tmp_path, monkeypatch):
    monkeypatch.setattr(overview, "SIZE", 256)
    monkeypatch.setattr(overview, "MAX_ZOOM", 0)
    calls = []

    def request(req):
        calls.append(req)
        return httpx.Response(200, content=png())

    days = [date(2024, 1, 31), date(2024, 2, 1), date(2024, 2, 29), date(2024, 3, 1)]
    store = overview.NatureOverviewStore(tmp_path)
    with httpx.Client(transport=httpx.MockTransport(request)) as client:
        record = store.prepare("2024-02", days, client)
        assert record["dates"] == ["2024-02-01", "2024-02-29"]
        assert sorted(req.url.params["TIME"] for req in calls) == record["dates"]
        assert all(req.url.params["LAYERS"] == overview.LAYER for req in calls)
        assert all(req.url.params["SRS"] == "EPSG:3857" for req in calls)
        restored = overview.NatureOverviewStore(tmp_path)
        assert restored.prepare("2024-02", days, client) == record
        assert len(calls) == 2
        tile = restored.tile("2024-02", 0, 0, 0)
        assert Image.open(tile).getpixel((128, 128)) == (30, 60, 90, 255)
        assert restored.publish()["months"] == ["2024-02"]
        assert restored.snapshot()["minZoom"] == 0


def test_provider_failure_does_not_publish_an_empty_or_partial_month(tmp_path, monkeypatch):
    monkeypatch.setattr(overview, "SIZE", 256)
    store = overview.NatureOverviewStore(tmp_path)
    with httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(503))) as client:
        with pytest.raises(httpx.HTTPStatusError):
            store.prepare("2024-02", [date(2024, 2, 2)], client)
    assert store.metadata("2024-02") is None
    assert store.snapshot() is None
    with pytest.raises(FileNotFoundError):
        store.tile("2024-02", 0, 0, 0)
    with pytest.raises(ValueError):
        store.tile("../../secret", 0, 0, 0)
    with pytest.raises(ValueError):
        store.tile("2024-02", 18, 0, 0)


def test_explicit_unreadable_dates_are_recorded_and_never_replaced_with_another_month(tmp_path, monkeypatch):
    monkeypatch.setattr(overview, "SIZE", 256)
    monkeypatch.setattr(overview, "MAX_ZOOM", 0)
    calls = []

    def request(req):
        calls.append(req.url.params["TIME"])
        return httpx.Response(200, content=png())

    store = overview.NatureOverviewStore(tmp_path)
    dates = [date(2024, 2, 1), date(2024, 2, 2)]
    with httpx.Client(transport=httpx.MockTransport(request)) as client:
        record = store.prepare("2024-02", dates, client, {dates[0], date(2024, 1, 31)})
    assert calls == record["dates"] == ["2024-02-02"]
    assert record["excludedDates"] == ["2024-02-01"]
    assert "unreadable" in record["exclusionReason"]


def test_tile_endpoint_reads_saved_files_without_processing_or_upstream_requests(tmp_path, monkeypatch, login):
    import app.routers.hazards as routes
    store = overview.NatureOverviewStore(tmp_path)
    path = tmp_path / "2024-02/0/0/0.png"
    path.parent.mkdir(parents=True)
    path.write_bytes(png())
    (tmp_path / "2024-02/manifest.json").write_text(json.dumps({"version": 1, "month": "2024-02"}))
    monkeypatch.setattr(routes, "overview_store", store)
    monkeypatch.setattr(store, "prepare", lambda *args: pytest.fail("A tile request must not process images"))
    client = login()
    response = client.get("/api/v1/hazards/nature/overview/2024-02/0/0/0.png")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert "max-age=86400" in response.headers["cache-control"]
    assert response.content == png()
    assert client.get("/api/v1/hazards/nature/overview/2024-02/0/1/0.png").status_code == 400
    assert client.get("/api/v1/hazards/nature/overview/2024-03/0/0/0.png").status_code == 404


def test_catalog_prefers_saved_archive_without_contacting_the_mosaic_provider(monkeypatch, login):
    import app.routers.hazards as routes
    from app import nature_imagery
    saved = {"months": ["2018-01", "2018-02"], "minZoom": 0, "overviewMaxZoom": 2}
    monkeypatch.setattr(routes, "overview_catalog", lambda: saved)
    monkeypatch.setattr(nature_imagery, "nature_catalog", lambda: pytest.fail("Saved playback must work without remote catalog lookup"))
    assert login().get("/api/v1/hazards/nature").json() == saved


def test_catalog_does_not_advertise_unsaved_months(tmp_path, monkeypatch, login):
    monkeypatch.setattr(overview, "overview_store", overview.NatureOverviewStore(tmp_path))
    assert login().get("/api/v1/hazards/nature").status_code == 503


def test_background_refresh_prepares_only_new_completed_months(tmp_path, monkeypatch):
    class Today(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 10, 4, tzinfo=UTC)

    monkeypatch.setattr(overview, "datetime", Today)
    store = overview.NatureOverviewStore(tmp_path)
    monkeypatch.setattr(store, "snapshot", lambda: {"months": ["2026-08"]})
    dates = [date(2026, 9, 1), date(2026, 9, 30), date(2026, 10, 2)]
    monkeypatch.setattr(store, "dates", lambda client: dates)
    events = []
    monkeypatch.setattr(store, "prepare", lambda month, days, client: events.append((month, days)))
    monkeypatch.setattr(store, "publish", lambda: events.append("published"))
    store.refresh()
    assert events == [("2026-09", dates), "published"]


def test_background_failure_retains_published_archive_and_retries_later(tmp_path, monkeypatch):
    store = overview.NatureOverviewStore(tmp_path)
    snapshot = {"months": ["2024-01"], "overviewMaxZoom": overview.MAX_ZOOM}
    (tmp_path / "catalog.json").write_text(json.dumps(snapshot))
    monkeypatch.setattr(store, "dates", lambda client: [date(2024, 2, 15), date(2024, 3, 2)])
    attempts = []

    def fail(month, days, client):
        attempts.append(month)
        raise ValueError("Provider unavailable")

    monkeypatch.setattr(store, "prepare", fail)
    monkeypatch.setattr(store, "publish", lambda: pytest.fail("Do not publish failed imagery"))
    for _ in range(2):
        with pytest.raises(ValueError, match="Provider unavailable"):
            store.refresh()
        assert store.snapshot() == snapshot
    assert attempts == ["2024-02", "2024-02"]
