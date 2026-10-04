from datetime import UTC, datetime

import pytest

from app.smoke_forecast import SMOKE_LAYER, parse_catalog

NOW = datetime(2026, 10, 4, 12, 30, tzinfo=UTC)


def catalog(run="2026-10-04T00:00:00Z", times="2026-10-04T00:00:00Z/2026-10-07T00:00:00Z/PT1H"):
    return f'''<WMS_Capabilities xmlns="http://www.opengis.net/wms"><Capability><Layer><Layer>
      <Name>{SMOKE_LAYER}</Name>
      <Dimension name="time">{times}</Dimension>
      <Dimension name="reference_time" default="{run}"/>
      <EX_GeographicBoundingBox><westBoundLongitude>-176</westBoundLongitude><southBoundLatitude>16</southBoundLatitude>
        <eastBoundLongitude>-18</eastBoundLongitude><northBoundLatitude>80</northBoundLatitude></EX_GeographicBoundingBox>
    </Layer></Layer></Capability></WMS_Capabilities>'''


def test_uses_published_hours_and_model_run_not_72_hours_invented_from_now():
    result = parse_catalog(catalog(), NOW)
    assert result["times"][0] == "2026-10-04T12:00:00Z"
    assert result["times"][-1] == "2026-10-07T00:00:00Z"
    assert len(result["times"]) == 61
    assert result["modelRun"] == "2026-10-04T00:00:00Z"
    assert result["bounds"] == [-176, 16, -18, 80]


def test_does_not_fill_missing_hours_in_an_explicit_time_list():
    times = "2026-10-04T12:00:00Z,2026-10-04T15:00:00Z"
    assert parse_catalog(catalog(times=times), NOW)["times"] == times.split(",")


@pytest.mark.parametrize("xml", [
    "<html>Unavailable</html>", "not xml", catalog(run="2023-08-17T00:00:00Z"),
    catalog(run="2026-10-05T00:00:00Z"), catalog(times="2026-10-03T00:00:00Z"),
    catalog(times="2026-10-04T00:00:00Z/2026-10-07T00:00:00Z/P1M"),
])
def test_rejects_invalid_expired_or_future_run_metadata(xml):
    with pytest.raises(ValueError):
        parse_catalog(xml, NOW)
