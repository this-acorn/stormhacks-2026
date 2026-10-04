"""Check the running backend end to end against the real TiDB database and Gemini.

Start the server first (from the backend folder):
    .venv/Scripts/python -m uvicorn app.main:app --port 8000
Then, in a second terminal:
    .venv/Scripts/python scripts/verify_live.py
    (stop the server with Ctrl+C and start it again)
    .venv/Scripts/python scripts/verify_live.py --after-restart

This changes demo data (a replay, a pledge, a marker request). Restore the original demo with
POST /api/v1/demo/reset, or: .venv/Scripts/python -m app.init_db --reset
"""

import argparse
import json
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path

import httpx

STATE_FILE = Path(tempfile.gettempdir()) / "aidatlas-verify.json"
failures: list[str] = []

REQUEST = {
    "item": "Bottled water (24-pack)",
    "quantity": 10,
    "unit": "cases",
    "urgency": "standard",
    "description": "Created by scripts/verify_live.py to check that data survives a server restart.",
    "confirmed": True,
}


def check(ok: bool, label: str, detail: object = "") -> bool:
    if not ok:
        failures.append(label)
    print(f"{'PASS' if ok else 'FAIL'}  {label}" + (f"  ({detail})" if detail != "" else ""))
    return ok


def signed_in(base: str, role: str, organization_id: str | None = None) -> httpx.Client:
    client = httpx.Client(base_url=f"{base}/api/v1", timeout=90)
    body = {"role": role} | ({"organizationId": organization_id} if organization_id else {})
    client.post("/auth/demo", json=body).raise_for_status()
    return client


def fulfilled(client: httpx.Client, organization_id: str, request_id: str) -> int:
    organization = client.get(f"/organizations/{organization_id}").json()
    return next(r["fulfilled"] for r in organization["requests"] if r["id"] == request_id)


def full_run(staff: httpx.Client, supporter: httpx.Client) -> None:
    rejected = staff.patch("/organizations/coast/requests/coast-request-1", json={"quantity": 999, "confirmed": True})
    check(rejected.status_code == 403, "Okanagan staff cannot edit Coast's request", rejected.status_code)

    invalid = staff.post("/organizations/okanagan/requests", json=REQUEST | {"title": "Invalid", "quantity": 0})
    body = invalid.json()
    check(
        invalid.status_code == 422 and body.get("code") == "validation_error" and "quantity" in body.get("fields", {}),
        "Invalid input gets a useful 422",
        body.get("detail", ""),
    )

    marker = staff.post("/organizations/okanagan/requests", json=REQUEST | {"title": f"Verification marker {datetime.now(UTC):%H:%M:%S}"})
    if check(marker.status_code == 201, "Staff publish a request", marker.status_code):
        STATE_FILE.write_text(json.dumps({"marker": marker.json()["id"]}))

    first = staff.post("/demo/replay-observations", json={"through": "2023-08-17"}).json()
    second = staff.post("/demo/replay-observations", json={"through": "2023-08-17"}).json()
    check(
        second.get("checkInsCreated") == 0 and second.get("detectionsAdded") == 0,
        "Replaying the same data again creates no duplicates",
        f"first run: {first.get('checkInsCreated')} created; second run: {second.get('checkInsExisting')} already existed",
    )
    mine = [o for o in staff.get("/observations").json() if o["organizationId"] == "okanagan"]
    if check(bool(mine), "Okanagan Community Relief received a check-in"):
        print(f"      {mine[0]['proximityKm']} km away · draft by {mine[0]['draftSource']}: {mine[0].get('question', '')}")
        check(mine[0]["draftSource"] == "gemini", "Gemini wrote the check-in draft (the template is only the fallback)")

    search = supporter.post("/search", json={"query": "I want to send winter clothes for children"}).json()
    check(search.get("method") == "tidb_vector", "Search used TiDB vector search", search.get("method"))
    for result in search.get("results", [])[:3]:
        print(f"      {result['score']:.3f}  {result['request']['item']}  ({result['organization']['name']})")
    top = search["results"][0]["request"]["item"] if search.get("results") else ""
    check("child" in top.lower(), "The top result is children's winter clothing", top)

    before = fulfilled(supporter, "okanagan", "okanagan-request-1")
    pledge = supporter.post(
        "/contributions",
        json={"organizationId": "okanagan", "requestId": "okanagan-request-1", "kind": "supplies", "quantity": 1},
    ).json()
    check(fulfilled(supporter, "okanagan", "okanagan-request-1") == before, "A pledge does not change the received count")
    supporter.patch(f"/contributions/{pledge['id']}/status", json={"status": "user_reported_completed"})
    for _ in range(2):
        staff.patch(f"/contributions/{pledge['id']}/status", json={"status": "organization_confirmed"})
    after = fulfilled(supporter, "okanagan", "okanagan-request-1")
    check(after == before + 1, "Confirming twice counts the supplies once", f"{before} -> {after}")

    print("\nNow stop the server (Ctrl+C), start it again, and run: scripts/verify_live.py --after-restart")


def after_restart(staff: httpx.Client) -> None:
    if not STATE_FILE.exists():
        print("Run scripts/verify_live.py without --after-restart first.")
        sys.exit(1)
    marker = json.loads(STATE_FILE.read_text())["marker"]
    ids = [r["id"] for r in staff.get("/requests", params={"organizationId": "okanagan"}).json()]
    check(marker in ids, "The request created before the restart is still in TiDB", marker)
    staff.patch(f"/organizations/okanagan/requests/{marker}", json={"status": "closed"})  # tidy up
    STATE_FILE.unlink()


def main() -> None:
    parser = argparse.ArgumentParser(description="Check the running AidAtlas backend end to end.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--after-restart", action="store_true", help="check that data survived a server restart")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    try:
        health = httpx.get(f"{base}/api/v1/health", timeout=30).json()
    except httpx.HTTPError as exc:
        print(f"Cannot reach the server at {base} ({exc}). Start it first.")
        sys.exit(1)
    check(health.get("database") == "connected", "TiDB is connected", health.get("database"))
    check(health.get("vectorSearch") == "tidb", "TiDB vector search is available", health.get("vectorSearch"))
    check(health.get("gemini") == "configured", "A Gemini key is configured", health.get("gemini"))

    staff = signed_in(base, "staff", "okanagan")
    if args.after_restart:
        after_restart(staff)
    else:
        full_run(staff, signed_in(base, "supporter"))

    print(f"\n{'All checks passed.' if not failures else f'{len(failures)} check(s) failed: ' + '; '.join(failures)}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
