"""Check the current UIS release and refresh frontend/backend education seeds.

Run from frontend: py -3.12 scripts/build-education-data.py
No release date is pinned. The running API also checks automatically every day.
"""

import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from app.education_data import refresh_snapshot, write_json  # noqa: E402


def main():
    output = ROOT / "frontend/public/data/education.json"
    previous = json.loads(output.read_text(encoding="utf-8")) if output.exists() else None
    data = refresh_snapshot(ROOT / "backend/.cache/education", previous)
    write_json(output, data)
    write_json(ROOT / "backend/data/education.json", data)
    write_json(ROOT / "backend/.cache/education/latest.json", data)
    years = Counter(max(map(int, country["years"])) for country in data["countries"] if country["years"])
    print(json.dumps({"release": data["release"], "checkedAt": data["checkedAt"],
                      "countriesWithData": sum(years.values()), "latestYearCoverage": dict(sorted(years.items()))}))


if __name__ == "__main__":
    main()
