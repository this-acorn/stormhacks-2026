"""Shade unobserved land and polar night in the saved monthly globe. Downloads nothing."""

import time

from app.nature_overview import overview_store


def main():
    started = time.monotonic()
    count = overview_store.refill()
    print(f"Shaded {count} saved months at {overview_store.root} ({time.monotonic() - started:.0f}s)", flush=True)


if __name__ == "__main__":
    main()
