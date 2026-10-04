from datetime import UTC, datetime
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import httpx
import pytest

from app import nature_imagery as nature

NOW = datetime(2026, 10, 4, 12, tzinfo=UTC)


@pytest.fixture(autouse=True)
def empty_cache(monkeypatch):
    monkeypatch.setattr(nature, "_catalog", None)
    monkeypatch.setattr(nature, "_mosaics", {})
    monkeypatch.setattr(nature, "_inflight", {})


def test_months_exclude_the_current_month_and_handle_a_lagging_archive():
    result = nature.catalog_from_latest("2026-10-03T15:41:01Z", NOW)
    assert result["months"][0] == "2018-01"
    assert result["months"][-1] == "2026-09"
    assert len(result["months"]) == 105
    assert "2026-10" not in result["months"]
    lagging = nature.catalog_from_latest("2026-08-20T00:00:00Z", NOW)
    assert lagging["months"][-1] == "2026-07"
    with pytest.raises(ValueError):
        nature.catalog_from_latest("2026-10-05T00:00:00Z", NOW)


@pytest.mark.parametrize("month", ["2025-00", "2025-13", "2025-1", "2025-07/2025-09", "invalid"])
def test_rejects_malformed_months_before_network_requests(month):
    with pytest.raises(ValueError):
        nature.month_bounds(month)


def test_monthly_query_is_confined_to_one_month_sorts_cloud_cover_and_reuses_registration(monkeypatch):
    monkeypatch.setattr(nature, "nature_catalog", lambda: {"months": ["2024-02", "2025-12"]})
    requests = []

    def post(url, **kwargs):
        requests.append((url, kwargs["json"]))
        return httpx.Response(200, json={"id": "a" * 32}, request=httpx.Request("POST", url))

    monkeypatch.setattr(nature.httpx, "post", post)
    assert nature.monthly_mosaic("2024-02")["month"] == "2024-02"
    assert nature.monthly_mosaic("2024-02")["searchId"] == "a" * 32
    assert len(requests) == 1
    query = requests[0][1]
    assert query["collections"] == ["sentinel-2-l2a"]
    assert query["datetime"] == "2024-02-01T00:00:00.000000Z/2024-02-29T23:59:59.999999Z"
    assert query["query"] == {"eo:cloud_cover": {"lte": 20}}
    assert query["sortby"][0] == {"field": "eo:cloud_cover", "direction": "asc"}
    nature.monthly_mosaic("2025-12")
    assert requests[-1][1]["datetime"].endswith("2025-12-31T23:59:59.999999Z")
    with pytest.raises(ValueError):
        nature.monthly_mosaic("2026-10")
    assert len(requests) == 2


def test_catalog_is_cached_but_network_failure_is_not_cached(monkeypatch):
    calls = []

    def get(url, **kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            raise httpx.ConnectError("offline")
        return httpx.Response(200, json={"features": [{"properties": {"datetime": "2025-07-15T00:00:00Z"}}]},
                              request=httpx.Request("GET", url))

    monkeypatch.setattr(nature.httpx, "get", get)
    with pytest.raises(httpx.ConnectError):
        nature.nature_catalog()
    assert nature.nature_catalog()["months"][-1] == "2025-06"
    nature.nature_catalog()
    assert len(calls) == 2
    assert calls[1]["params"]["collections"] == "sentinel-2-l2a"


def test_slow_preload_does_not_block_another_month_and_duplicates_share_registration(monkeypatch):
    monkeypatch.setattr(nature, "nature_catalog", lambda: {"months": ["2025-07", "2025-08"]})
    started, release = Event(), Event()
    requests = []

    def post(url, **kwargs):
        interval = kwargs["json"]["datetime"]
        requests.append(interval)
        if interval.startswith("2025-07"):
            started.set()
            assert release.wait(5)
        return httpx.Response(200, json={"id": "a" * 32}, request=httpx.Request("POST", url))

    monkeypatch.setattr(nature.httpx, "post", post)
    with ThreadPoolExecutor(max_workers=3) as pool:
        slow = pool.submit(nature.monthly_mosaic, "2025-07")
        assert started.wait(2)
        duplicate = pool.submit(nature.monthly_mosaic, "2025-07")
        selected = pool.submit(nature.monthly_mosaic, "2025-08")
        try:
            assert selected.result(timeout=2)["month"] == "2025-08"
            assert not slow.done()
        finally:
            release.set()
        assert slow.result() == duplicate.result()
    assert len(requests) == 2
    assert nature._inflight == {}


def test_failed_registration_can_be_retried(monkeypatch):
    monkeypatch.setattr(nature, "nature_catalog", lambda: {"months": ["2025-07"]})
    calls = []

    def post(url, **kwargs):
        calls.append(url)
        if len(calls) == 1:
            raise httpx.ConnectError("offline")
        return httpx.Response(200, json={"id": "a" * 32}, request=httpx.Request("POST", url))

    monkeypatch.setattr(nature.httpx, "post", post)
    with pytest.raises(httpx.ConnectError):
        nature.monthly_mosaic("2025-07")
    assert nature._inflight == {}
    assert nature.monthly_mosaic("2025-07")["month"] == "2025-07"
    assert len(calls) == 2


def test_public_monthly_api_returns_errors_without_demo_imagery(login, monkeypatch):
    import app.routers.hazards as routes

    client = login()
    monkeypatch.setattr(routes, "overview_catalog", lambda: {"months": ["2026-09"], "minZoom": 0})
    assert client.get("/api/v1/hazards/nature").json()["months"][-1] == "2026-09"
    assert client.get("/api/v1/hazards/nature/2025-13").status_code == 400

    def offline(month):
        raise httpx.ConnectError("offline")

    monkeypatch.setattr(routes, "monthly_mosaic", offline)
    result = client.get("/api/v1/hazards/nature/2025-07")
    assert result.status_code == 503
    assert "unavailable" in result.json()["detail"]
