"""Build the demo replay dataset from NASA FIRMS' public yearly archive (no API key needed).

Takes the VIIRS NOAA-20 (JPSS-1) 2023 Canada file, keeps only detections in BC's Southern
Interior from 15 to 19 August 2023 (the McDougall Creek and Bush Creek East fires), and writes
them unchanged to data/firms/, with a metadata file describing the source and filter.

Run from the backend folder:
    .venv/Scripts/python scripts/build_firms_dataset.py
    .venv/Scripts/python scripts/build_firms_dataset.py --source path/to/viirs-jpss1_2023_Canada.csv
"""

import argparse
import csv
import io
import json
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

SOURCE_URL = "https://firms.modaps.eosdis.nasa.gov/data/country/viirs-jpss1/2023/viirs-jpss1_2023_Canada.csv"
DATASET = "bc-wildfire-2023-08"
# Bounding box (south, north, west, east) and inclusive UTC date range.
SOUTH, NORTH, WEST, EAST = 49.0, 51.6, -121.5, -117.5
FIRST_DAY, LAST_DAY = "2023-08-15", "2023-08-19"

OUT_DIR = Path(__file__).resolve().parent.parent / "data" / "firms"


def keep(row: dict[str, str]) -> bool:
    return (
        FIRST_DAY <= row["acq_date"] <= LAST_DAY
        and SOUTH <= float(row["latitude"]) <= NORTH
        and WEST <= float(row["longitude"]) <= EAST
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", help="local copy of the yearly CSV; downloaded from FIRMS when omitted")
    args = parser.parse_args()

    if args.source:
        stream = open(args.source, newline="", encoding="utf-8")
    else:
        print(f"Downloading {SOURCE_URL} (about 140 MB)...")
        stream = io.TextIOWrapper(urllib.request.urlopen(SOURCE_URL), encoding="utf-8", newline="")

    with stream:
        reader = csv.DictReader(stream)
        fieldnames = reader.fieldnames
        rows = [row for row in reader if keep(row)]

    rows.sort(key=lambda r: (r["acq_date"], r["acq_time"], r["latitude"], r["longitude"]))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    csv_path = OUT_DIR / f"{DATASET}.csv"
    with open(csv_path, "w", newline="", encoding="utf-8") as out:
        writer = csv.DictWriter(out, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    metadata = {
        "dataset": DATASET,
        "title": "BC Southern Interior wildfires, 15-19 August 2023",
        "source": "NASA FIRMS",
        "product": "VIIRS 375 m active fire detections, NOAA-20 (JPSS-1), yearly country archive",
        "source_url": SOURCE_URL,
        "filter": {
            "bbox": {"south": SOUTH, "north": NORTH, "west": WEST, "east": EAST},
            "first_day_utc": FIRST_DAY,
            "last_day_utc": LAST_DAY,
        },
        "rows": len(rows),
        "built_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "citation": (
            "We acknowledge the use of data from NASA's Fire Information for Resource Management System "
            "(FIRMS) (https://www.earthdata.nasa.gov/data/tools/firms), part of NASA's Earth Science Data "
            "and Information System (ESDIS)."
        ),
        "notes": "Each row is a satellite heat detection, not a confirmed fire perimeter or damage area.",
    }
    (OUT_DIR / f"{DATASET}.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(rows)} detections to {csv_path}")


if __name__ == "__main__":
    main()
