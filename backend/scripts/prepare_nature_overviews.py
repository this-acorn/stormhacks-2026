"""Build the saved monthly globe once. No imagery processing happens on a map click."""

import argparse
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date

import httpx

from app.nature_imagery import month_bounds
from app.nature_overview import overview_store


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", default="2018-01")
    parser.add_argument("--end", required=True)
    parser.add_argument("--workers", type=int, default=3, choices=range(1, 5))
    parser.add_argument("--exclude-date", type=date.fromisoformat, action="append", default=[],
                        help="Omit a verified unreadable provider observation; recorded in the month manifest.")
    args = parser.parse_args()
    cursor, _ = month_bounds(args.start)
    stop, _ = month_bounds(args.end)
    if cursor > stop:
        parser.error("--start must be no later than --end")
    months = []
    while cursor <= stop:
        month = cursor.strftime("%Y-%m")
        months.append(month)
        _, cursor = month_bounds(month)
    started = time.monotonic()
    with httpx.Client(timeout=60, transport=httpx.HTTPTransport(retries=2)) as client:
        dates = overview_store.dates(client)
        # Prepare the initial view and start of playback first, then the rest.
        order = list(dict.fromkeys([months[-1], months[0], *months]))
        failures = []
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            jobs = {pool.submit(overview_store.prepare, month, dates, client, set(args.exclude_date)): month for month in order}
            for done, job in enumerate(as_completed(jobs), 1):
                month = jobs[job]
                try:
                    job.result()
                    print(f"{done}/{len(months)} saved {month} ({time.monotonic() - started:.0f}s)", flush=True)
                except Exception as error:
                    failures.append(month)
                    print(f"{done}/{len(months)} FAILED {month}: {type(error).__name__}: {error}", flush=True)
        if failures:
            raise SystemExit(f"Retry incomplete months: {', '.join(failures)}. Saved months will be reused.")
    catalog = overview_store.publish()
    print(f"Published {len(catalog['months'])} months at {overview_store.root}", flush=True)


if __name__ == "__main__":
    main()
