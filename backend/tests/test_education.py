import csv
import hashlib
import io
import json
import urllib.error
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import education, education_data as source
from app.main import app


def snapshot():
    return json.loads((Path(__file__).parents[1] / "data/education.json").read_text(encoding="utf-8"))


def page(release="202602"):
    return ''.join(f'<a href="https://download.uis.unesco.org/bdds/{release}/{name}.zip">Download</a>' for name in ("SDG", "OPRI"))


def test_discovers_latest_complete_release_and_ignores_untrusted_links():
    html = page("202502") + page() + '<a href="https://example.com/bdds/202609/SDG.zip">Invalid</a>'
    assert source.discover_release(html) == "202602"


@pytest.mark.parametrize("html", ["<html>Unavailable</html>", page().replace("202602/OPRI", "202509/OPRI"), page("209901")])
def test_rejects_incomplete_invalid_or_future_release(html):
    with pytest.raises(ValueError):
        source.discover_release(html)


def test_parser_uses_latest_years_and_same_year_counts_without_filling_gaps(tmp_path):
    def csv_text(headers, rows):
        stream = io.StringIO()
        writer = csv.writer(stream)
        writer.writerow(headers)
        writer.writerows(rows)
        return stream.getvalue()

    paths = {}
    for dataset in ("SDG", "OPRI"):
        paths[dataset] = tmp_path / f"{dataset}.zip"
        rows = ([['AAA', source.RATE, 2022, 12.5, '', ''], ['AAA', source.RATE, 2025, 0, 'NIL', 'NAT_EST'],
                 ['AAA', source.RATE, 2024, 0, 'NA', ''], ['BBB', source.RATE, 2025, 101, '', '']]
                if dataset == "SDG" else [['AAA', source.COUNT, 2022, 125, '', ''],
                                            ['AAA', '299905', 2025, 6, '', ''], ['AAA', '299932', 2025, 6, '', ''],
                                            ['AAA', '999975', 2025, 12, '', ''], ['AAA', '999976', 2025, 3, '', '']])
        with zipfile.ZipFile(paths[dataset], "w") as archive:
            archive.writestr(f"{dataset}_COUNTRY.csv", csv_text(['COUNTRY_ID', 'COUNTRY_NAME_EN'], [['AAA', 'Example'], ['BBB', 'Missing']]))
            archive.writestr(f"{dataset}_DATA_NATIONAL.csv", csv_text(['COUNTRY_ID', 'INDICATOR_ID', 'YEAR', 'VALUE', 'MAGNITUDE', 'QUALIFIER'], rows))
            archive.writestr(f"{dataset}_METADATA.csv", 'COUNTRY_ID,INDICATOR_ID,YEAR,TYPE,METADATA\n')
    result = source.build_snapshot("202602", paths, {"features": []})
    assert result["release"] == "February 2026"
    country = result["countries"][0]
    assert list(country["years"]) == ['2022', '2025']
    assert country["years"]['2025'] == {"rate": 0, "count": None, "ages": [6, 14], "flags": ['NAT_EST'], "notes": []}
    assert result["countries"][1]["years"] == {}


def test_conditional_download_reuses_only_a_real_cached_file(tmp_path, monkeypatch):
    path = tmp_path / '202602-SDG.zip'
    path.write_bytes(b'cached archive')
    source.write_json(path.with_suffix('.zip.http.json'), {'etag': 'v1'})
    def unchanged(request, **kwargs):
        assert request.get_header('If-none-match') == 'v1'
        raise urllib.error.HTTPError(request.full_url, 304, 'Not modified', {}, None)
    monkeypatch.setattr(source.urllib.request, 'urlopen', unchanged)
    assert source.download('https://download.uis.unesco.org/bdds/202602/SDG.zip', path) == path
    assert path.read_bytes() == b'cached archive'


def test_invalid_download_does_not_replace_the_old_archive(tmp_path, monkeypatch):
    path = tmp_path / '202602-SDG.zip'
    path.write_bytes(b'old archive')
    body = io.BytesIO(b'<html>upstream error</html>')
    body.headers = {}
    monkeypatch.setattr(source.urllib.request, 'urlopen', lambda *args, **kwargs: body)
    with pytest.raises(zipfile.BadZipFile):
        source.download('https://download.uis.unesco.org/bdds/202602/SDG.zip', path)
    assert path.read_bytes() == b'old archive'
    assert not list(tmp_path.glob('*.part'))


def test_source_rejects_rollback_before_downloading_archives(tmp_path, monkeypatch):
    previous = snapshot()
    previous['releaseId'] = '202609'
    body = io.BytesIO(page().encode())
    monkeypatch.setattr(source.urllib.request, 'urlopen', lambda *args, **kwargs: body)
    with pytest.raises(ValueError, match='older release'):
        source.refresh_snapshot(tmp_path, previous)
    assert not list(tmp_path.iterdir())


@pytest.mark.parametrize(('previous_release', 'revision', 'rebuild'), [
    ('202602', False, False), ('202602', True, True), ('202502', False, True),
])
def test_detects_new_releases_and_revisions_within_a_release(tmp_path, monkeypatch, previous_release, revision, rebuild):
    previous = snapshot()
    previous['releaseId'] = previous_release
    previous['sources'] = []
    for dataset in ('SDG', 'OPRI'):
        payload = dataset.encode()
        previous['sources'].append({'url': f'https://download.uis.unesco.org/bdds/{previous_release}/{dataset}.zip',
                                    'sha256': hashlib.sha256(payload).hexdigest()})
        (tmp_path / f'202602-{dataset}.zip').write_bytes(payload + (b'revised' if revision else b''))
    source.write_json(tmp_path / 'countries-v5.1.2.geojson', {'features': []})
    monkeypatch.setattr(source.urllib.request, 'urlopen', lambda *args, **kwargs: io.BytesIO(page().encode()))
    monkeypatch.setattr(source, 'download', lambda url, path, **kwargs: path)
    calls = []
    def build(release, paths, boundaries):
        calls.append(release)
        return {**previous, 'releaseId': release, 'release': 'February 2026'}
    monkeypatch.setattr(source, 'build_snapshot', build)
    result = source.refresh_snapshot(tmp_path, previous)
    assert calls == (['202602'] if rebuild else [])
    assert result['releaseId'] == '202602'
    assert result['checkedAt'] != previous['checkedAt']


def test_daily_refresh_persists_new_data_and_survives_a_restart(tmp_path, monkeypatch):
    old = snapshot()
    old['checkedAt'] = (datetime.now(UTC) - timedelta(days=2)).isoformat()
    seed = tmp_path / 'seed.json'
    source.write_json(seed, old)
    store = education.EducationStore(tmp_path / 'cache', seed)
    updated = snapshot()
    updated['checkedAt'] = datetime.now(UTC).isoformat()
    updated['release'] = 'September 2026'
    updated['releaseId'] = '202609'
    calls = []
    def refresh(cache, previous):
        calls.append(previous)
        assert store.snapshot()['updates']['state'] == 'checking'
        return updated
    monkeypatch.setattr(education, 'refresh_snapshot', refresh)
    store.refresh_if_due()
    store.refresh_if_due()
    assert len(calls) == 1
    assert store.snapshot()['releaseId'] == '202609'
    assert store.snapshot()['updates']['state'] == 'current'
    restarted = education.EducationStore(tmp_path / 'cache', seed)
    assert restarted.snapshot()['releaseId'] == '202609'
    restarted.refresh_if_due()
    assert len(calls) == 1
    restarted.next_check = datetime.now(UTC) - timedelta(seconds=1)
    restarted.refresh_if_due()
    assert len(calls) == 2


def test_failure_preserves_data_and_check_timestamp_then_recovers(tmp_path, monkeypatch):
    seed = tmp_path / 'seed.json'
    old = snapshot()
    source.write_json(seed, old)
    store = education.EducationStore(tmp_path / 'cache', seed)
    def fail(*args):
        raise ValueError('changed source schema')
    monkeypatch.setattr(education, 'refresh_snapshot', fail)
    store.refresh_if_due(force=True)
    result = store.snapshot()
    assert result['countries'] == old['countries']
    assert result['updates']['checkedAt'] == old['checkedAt']
    assert result['updates']['state'] == 'stale'
    assert not (tmp_path / 'cache/latest.json').exists()
    monkeypatch.setattr(education, 'refresh_snapshot', lambda *args: old)
    store.refresh_if_due(force=True)
    assert store.snapshot()['updates']['state'] == 'current'


def test_endpoint_exposes_data_and_freshness_without_http_caching(monkeypatch):
    from app.routers import hazards
    monkeypatch.setattr(hazards.education_store, 'snapshot', lambda: {'updates': {'state': 'current'}})
    response = TestClient(app).get('/api/v1/hazards/education')
    assert response.status_code == 200
    assert response.headers['cache-control'] == 'no-store'
    assert response.json()['updates']['state'] == 'current'


def test_rejects_invalid_rates_and_severe_data_loss():
    data = snapshot()
    data['countries'] = data['countries'][:5]
    with pytest.raises(ValueError, match='coverage'):
        source.validate_snapshot(data)
    data = snapshot()
    country = next(country for country in data['countries'] if country['years'])
    next(iter(country['years'].values()))['rate'] = float('nan')
    with pytest.raises(ValueError, match='rate'):
        source.validate_snapshot(data)
