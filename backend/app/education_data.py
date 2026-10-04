"""Build nationally comparable education series from the current UIS release."""

import csv
import hashlib
import io
import json
import math
import re
import tempfile
import urllib.request
import urllib.error
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from html.parser import HTMLParser

BULK_URL = "https://databrowser.uis.unesco.org/resources/bulk"


class ReleaseLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.releases = {"SDG": set(), "OPRI": set()}

    def handle_starttag(self, tag, attrs):
        if tag != "a":
            return
        match = re.fullmatch(
            r"https://download\.uis\.unesco\.org/bdds/(\d{6})/(SDG|OPRI)\.zip",
            dict(attrs).get("href", ""),
        )
        if match:
            release, dataset = match.groups()
            datetime.strptime(release, "%Y%m")
            self.releases[dataset].add(release)


def discover_release(html):
    parser = ReleaseLinks()
    parser.feed(html)
    if not all(parser.releases.values()):
        raise ValueError("UIS did not advertise both education archives.")
    latest = {max(values) for values in parser.releases.values()}
    if len(latest) != 1:
        raise ValueError("UIS is publishing an incomplete release; retry later.")
    release = latest.pop()
    if release > datetime.now(timezone.utc).strftime("%Y%m"):
        raise ValueError("UIS advertised a future release.")
    return release


def write_json(path, data):
    """Readers see either a complete old file or a complete validated replacement."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                     suffix=".tmp", delete=False) as stream:
        temp = Path(stream.name)
        try:
            json.dump(data, stream, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        except BaseException:
            stream.close()
            temp.unlink(missing_ok=True)
            raise
    try:
        temp.replace(path)
    finally:
        temp.unlink(missing_ok=True)


def download(url, path, revalidate=True):
    """Conditional GET detects revisions even when UIS reuses a release URL."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and not revalidate:
        return path
    headers = {"User-Agent": "AidAtlas education data updater"}
    metadata = path.with_suffix(path.suffix + ".http.json")
    if path.exists() and metadata.exists():
        try:
            saved = json.loads(metadata.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            saved = {}
        if saved.get("etag"):
            headers["If-None-Match"] = saved["etag"]
        if saved.get("modified"):
            headers["If-Modified-Since"] = saved["modified"]
    try:
        response = urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=120)
    except urllib.error.HTTPError as error:
        if error.code == 304 and path.exists():
            return path
        raise
    with response, tempfile.NamedTemporaryFile(dir=path.parent, suffix=".part", delete=False) as stream:
        temp = Path(stream.name)
        try:
            size = 0
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > 300 * 1024 * 1024:
                    raise ValueError("UIS archive exceeds the supported download size.")
                stream.write(chunk)
            stream.close()
            if path.suffix == ".zip":
                with zipfile.ZipFile(temp) as archive:
                    dataset = path.stem.split("-")[-1]
                    required = {f"{dataset}_{name}.csv" for name in ("COUNTRY", "DATA_NATIONAL", "METADATA")}
                    if not required.issubset(archive.namelist()):
                        raise ValueError("UIS archive schema changed.")
            else:
                json.loads(temp.read_text(encoding="utf-8"))
            temp.replace(path)
            write_json(metadata, {"etag": response.headers.get("ETag"),
                                  "modified": response.headers.get("Last-Modified")})
        finally:
            temp.unlink(missing_ok=True)
    return path


def validate_snapshot(data):
    if data.get("schemaVersion") != 1 or data.get("indicators") != {"rate": RATE, "count": COUNT}:
        raise ValueError("Unsupported education indicators or schema.")
    countries = data.get("countries", [])
    if len({country["id"] for country in countries}) != len(countries):
        raise ValueError("Duplicate countries.")
    if sum(bool(country["years"]) for country in countries) < 100:
        raise ValueError("Education coverage unexpectedly fell below 100 countries.")
    for country in countries:
        for year, row in country["years"].items():
            if int(year) not in data["years"] or int(year) > datetime.now(timezone.utc).year:
                raise ValueError("Invalid observation year.")
            if not math.isfinite(row["rate"]) or not 0 <= row["rate"] <= 100:
                raise ValueError("Invalid out-of-school rate.")
            if row["count"] is not None and (not isinstance(row["count"], int) or row["count"] < 0):
                raise ValueError("Invalid child count.")


def refresh_snapshot(cache, previous=None):
    request = urllib.request.Request(BULK_URL, headers={"User-Agent": "AidAtlas education data updater"})
    with urllib.request.urlopen(request, timeout=45) as response:
        release = discover_release(response.read().decode("utf-8"))
    if previous:
        previous_release = previous.get("releaseId") or re.search(r"/bdds/(\d{6})/", previous["sources"][0]["url"])[1]
        if release < previous_release:
            raise ValueError("UIS advertised an older release; keeping the existing data.")
    paths = {dataset: download(f"https://download.uis.unesco.org/bdds/{release}/{dataset}.zip",
                               cache / f"{release}-{dataset}.zip") for dataset in ("SDG", "OPRI")}
    hashes = {hashlib.sha256(path.read_bytes()).hexdigest() for path in paths.values()}
    if previous and previous_release == release and hashes == {source["sha256"] for source in previous["sources"]}:
        result = dict(previous, releaseId=release)
    else:
        boundaries = download(BOUNDARIES, cache / "countries-v5.1.2.geojson", revalidate=False)
        result = build_snapshot(release, paths, json.loads(boundaries.read_text(encoding="utf-8")))
    validate_snapshot(result)
    if previous:
        old_count = sum(bool(country["years"]) for country in previous["countries"])
        new_count = sum(bool(country["years"]) for country in result["countries"])
        if new_count < old_count * 0.8:
            raise ValueError("Large unexpected coverage loss; keeping the previous data for review.")
    result["checkedAt"] = datetime.now(timezone.utc).isoformat()
    return result

FIRST_YEAR = 2000
RATE = "ROFST.1T2.CP"
COUNT = "OFST.1T2.CP"
AGES = {"299905", "299932", "999975", "999976"}
BOUNDARIES = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson"


def read_csv(archive, member):
    with io.TextIOWrapper(archive.open(member), encoding="utf-8-sig", newline="") as stream:
        yield from csv.DictReader(stream)


def number(row):
    # UIS uses numeric zero for NOT APPLICABLE. It must not become 0%.
    if row["MAGNITUDE"] not in ("", "NIL"):
        return None
    try:
        value = float(row["VALUE"])
        return value if math.isfinite(value) and value >= 0 else None
    except (ValueError, TypeError):
        return None


def build_snapshot(release, paths, original):
    data = {}
    names = {}
    sources = []
    notes = {}
    for dataset, wanted in [("OPRI", AGES | {COUNT}), ("SDG", {RATE})]:
        url = f"https://download.uis.unesco.org/bdds/{release}/{dataset}.zip"
        path = paths[dataset]
        sources.append({"url": url, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
        with zipfile.ZipFile(path) as archive:
            names.update({r["COUNTRY_ID"]: r["COUNTRY_NAME_EN"] for r in read_csv(archive, f"{dataset}_COUNTRY.csv")})
            for row in read_csv(archive, f"{dataset}_DATA_NATIONAL.csv"):
                if row["INDICATOR_ID"] not in wanted or int(row["YEAR"]) < FIRST_YEAR:
                    continue
                key = (row["COUNTRY_ID"], int(row["YEAR"]))
                indicator = row["INDICATOR_ID"]
                if indicator in data.get(key, {}):
                    raise ValueError(f"Duplicate national observation: {key} {indicator}")
                data.setdefault(key, {})[indicator] = row
            # Preserve country/year footnotes; source and data-status fields are
            # already represented by provenance and observation qualifiers.
            for row in read_csv(archive, f"{dataset}_METADATA.csv"):
                if row["INDICATOR_ID"] != (COUNT if dataset == "OPRI" else RATE):
                    continue
                if not row["YEAR"].isdigit() or int(row["YEAR"]) < FIRST_YEAR:
                    continue
                if row["TYPE"].startswith(("Source:", "Data Status:")):
                    continue
                note = row["METADATA"].strip()
                if note:
                    notes.setdefault((row["COUNTRY_ID"], int(row["YEAR"])), set()).add(note)
        print(f"Read {dataset}", flush=True)

    countries = {code: {"id": code, "name": name, "center": None, "years": {}} for code, name in names.items()}
    for (code, year), values in sorted(data.items()):
        if code not in countries or RATE not in values:
            continue
        rate = number(values[RATE])
        if rate is None or rate > 100:
            continue
        count = number(values[COUNT]) if COUNT in values else None
        age_values = {key: number(values[key]) if key in values else None for key in AGES}
        start, primary_duration, secondary_start, secondary_duration = [age_values[key] for key in ("299905", "299932", "999975", "999976")]
        ages = None
        if all(v is not None and v.is_integer() and v > 0 for v in age_values.values()) and start + primary_duration == secondary_start:
            ages = [int(start), int(secondary_start + secondary_duration - 1)]
        flags = sorted({values[key]["QUALIFIER"] for key in (RATE, COUNT) if key in values and values[key]["QUALIFIER"]})
        countries[code]["years"][str(year)] = {
            "rate": rate,
            "count": round(count) if count is not None else None,
            "ages": ages,
            "flags": flags,
            "notes": sorted(notes.get((code, year), [])),
        }

    features = []
    for feature in original["features"]:
        p = feature["properties"]
        code = p["ISO_A3_EH"] if p["ISO_A3_EH"] != "-99" else f"geo-{p['ADM0_A3']}"
        if code == "ATA":
            continue
        country = countries.setdefault(code, {"id": code, "name": p["NAME_EN"], "center": None, "years": {}})
        country["center"] = [p["LABEL_X"], p["LABEL_Y"]]
        country["zoom"] = min(5, max(2.5, p["MIN_LABEL"] - 0.7))
        features.append({"type": "Feature", "id": code, "properties": {"id": code}, "geometry": feature["geometry"]})

    coverage = Counter(int(year) for country in countries.values() for year in country["years"])
    years = list(range(FIRST_YEAR, max(coverage) + 1))
    # Prefer the latest broadly reported year; do not hide the newer sparse year.
    default_year = max(year for year, count in coverage.items() if count >= max(coverage.values()) * 0.6)
    result = {
        "schemaVersion": 1,
        "source": "UNESCO Institute for Statistics",
        "sourceUrl": "https://databrowser.uis.unesco.org/resources/bulk",
        "release": datetime.strptime(release, "%Y%m").strftime("%B %Y"),
        "releaseId": release,
        "builtAt": datetime.now(timezone.utc).isoformat(),
        "license": "CC BY-SA 3.0 IGO",
        "licenseUrl": "https://creativecommons.org/licenses/by-sa/3.0/igo/",
        "indicators": {"rate": RATE, "count": COUNT},
        "scope": "Primary and lower secondary school-age children, both sexes. Upper secondary ages excluded. National official age ranges; no compulsory-education filter.",
        "method": "Published combined UIS administrative-series rate and count, matched by ISO country and year. No interpolation, carry-forward or invented counts. Non-applicable, suppressed, low-reliability and invalid observations excluded. Not enrolled is not a measure of daily attendance or the reason for being out of school.",
        "sources": sources,
        "boundaries": {"source": "Natural Earth 1:50m, v5.1.2", "url": BOUNDARIES, "license": "Public domain"},
        "years": years,
        "defaultYear": default_year,
        "countries": sorted(countries.values(), key=lambda c: c["name"]),
    }
    return result
