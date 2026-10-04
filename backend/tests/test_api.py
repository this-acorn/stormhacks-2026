from sqlalchemy import func, select

from app import ai
from app.db import SessionLocal
from app.firms import load_dataset
from app.models import AidRequest, CheckIn

API = "/api/v1"

NEW_REQUEST = {
    "title": "Drinking water for evacuated families",
    "item": "Bottled water (24-pack)",
    "quantity": 60,
    "unit": "cases",
    "urgency": "urgent",
    "description": "Families staying at our hall need drinking water while the fire is active nearby.",
    "links": {"donate": "https://example.org/okanagan/donate"},
    "confirmed": True,
}


def check_in_orgs() -> set[str]:
    with SessionLocal() as db:
        return set(db.scalars(select(CheckIn.organization_id)))


def check_in_count() -> int:
    with SessionLocal() as db:
        return db.scalar(select(func.count()).select_from(CheckIn))


def fulfilled(request_id: str) -> int:
    with SessionLocal() as db:
        return db.get(AidRequest, request_id).fulfilled


def replay(client, through: str | None = None) -> dict:
    response = client.post(f"{API}/demo/replay-observations", json={"through": through} if through else {})
    assert response.status_code == 200, response.text
    return response.json()


# ----- Sign-in and permissions ---------------------------------------------------------------


def test_sign_in_is_decided_by_the_server(login):
    anonymous = login()
    response = anonymous.get(f"{API}/me")
    assert response.status_code == 401
    assert response.json() == {"detail": "Sign in to continue.", "code": "not_authenticated"}

    # A first visit signs the visitor in as the demo supporter.
    boot = anonymous.get(f"{API}/bootstrap")
    assert boot.status_code == 200
    assert boot.json()["session"] == {"id": "demo-supporter", "name": "Alex Morgan", "role": "supporter", "demo": True}
    assert anonymous.get(f"{API}/me").json()["role"] == "supporter"

    # A forged cookie is ignored.
    forged = login()
    forged.cookies.set("aidatlas_session", "eyJ1aWQiOiJkZW1vLXN0YWZmIn0.forged")
    assert forged.get(f"{API}/me").status_code == 401


def test_staff_publish_only_for_their_own_organization(login):
    okanagan, coast, supporter = login("staff", "okanagan"), login("staff", "coast"), login("supporter")

    created = okanagan.post(f"{API}/organizations/okanagan/requests", json=NEW_REQUEST)
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["organizationId"] == "okanagan" and body["fulfilled"] == 0 and body["status"] == "published"
    assert body["links"] == {"donate": "https://example.org/okanagan/donate"}
    assert body["createdAt"].endswith("Z")

    # Cross-organization edits are rejected by the server, whatever the frontend shows.
    patch = {"quantity": 5, "confirmed": True}
    rejected = okanagan.patch(f"{API}/organizations/coast/requests/coast-request-1", json=patch)
    assert rejected.status_code == 403 and rejected.json()["code"] == "forbidden"
    assert okanagan.post(f"{API}/organizations/coast/requests", json=NEW_REQUEST).status_code == 403
    assert supporter.post(f"{API}/organizations/okanagan/requests", json=NEW_REQUEST).status_code == 403

    updated = coast.patch(f"{API}/organizations/coast/requests/coast-request-1", json={"quantity": 250, "confirmed": True})
    assert updated.status_code == 200 and updated.json()["quantity"] == 250
    with SessionLocal() as db:  # saved in the database, not just echoed back
        assert db.get(AidRequest, "coast-request-1").quantity == 250

    closed = coast.patch(f"{API}/organizations/coast/requests/coast-request-1", json={"status": "closed"})
    assert closed.status_code == 200 and closed.json()["status"] == "closed"
    public = [r["id"] for r in supporter.get(f"{API}/organizations/coast").json()["requests"]]
    assert "coast-request-1" not in public  # closed requests are only shown to the organization's staff


def test_validation_errors_are_specific(login):
    staff = login("staff", "okanagan")
    one = staff.post(f"{API}/organizations/okanagan/requests", json=NEW_REQUEST | {"quantity": 0})
    assert one.status_code == 422
    assert one.json() == {
        "detail": "Enter a whole quantity between 1 and 100,000.",
        "code": "validation_error",
        "fields": {"quantity": "Enter a whole quantity between 1 and 100,000."},
    }

    two = staff.post(f"{API}/organizations/okanagan/requests", json=NEW_REQUEST | {"quantity": 0, "confirmed": False})
    assert two.json()["detail"] == "Check these fields: quantity, confirmed."

    below = staff.patch(f"{API}/organizations/okanagan/requests/okanagan-request-1", json={"quantity": 10, "confirmed": True})
    assert below.status_code == 422 and "46 kits already received" in below.json()["detail"]

    unconfirmed = staff.patch(f"{API}/organizations/okanagan/requests/okanagan-request-1", json={"quantity": 200})
    assert unconfirmed.status_code == 422 and "Confirm the need" in unconfirmed.json()["detail"]

    bad_link = staff.post(f"{API}/organizations/okanagan/requests", json=NEW_REQUEST | {"links": {"donate": "example.org"}})
    assert bad_link.json()["fields"] == {"links.donate": "Links must start with https:// or http://."}

    missing = staff.get(f"{API}/organizations/nowhere")
    assert missing.status_code == 404 and missing.json() == {"detail": "Organization not found.", "code": "not_found"}


# ----- Satellite replay and check-ins --------------------------------------------------------


def test_replay_creates_each_check_in_once_and_follows_new_data(login):
    staff = login("staff", "okanagan")

    first = replay(staff, "2023-08-17")
    assert first["playback"] is True and first["checkInsCreated"] >= 2
    assert check_in_orgs() == {"okanagan", "shuswap"}  # Lake Country's first nearby detections are on 18 Aug

    again = replay(staff, "2023-08-17")
    assert again["checkInsCreated"] == 0 and again["detectionsAdded"] == 0
    assert again["checkInsExisting"] == first["checkInsCreated"]
    assert check_in_count() == first["checkInsCreated"]

    later = replay(staff, "2023-08-18")
    assert later["checkInsCreated"] >= 1 and "lake-country" in check_in_orgs()

    replay(staff)  # the whole dataset
    replay(staff)
    with SessionLocal() as db:
        pairs = db.execute(select(CheckIn.event_id, CheckIn.organization_id)).all()
    assert len(pairs) == len(set(pairs))  # never two check-ins for one fire and one organization
    assert "vernon" not in check_in_orgs() and "coast" not in check_in_orgs()  # both are beyond 10 km


def test_check_in_drafts_fall_back_when_gemini_fails(login, monkeypatch):
    class BrokenModels:
        def generate_content(self, **kwargs):
            raise RuntimeError("quota exceeded")

    class BrokenClient:
        models = BrokenModels()

    monkeypatch.setattr(ai, "_client", lambda: BrokenClient())
    staff = login("staff", "okanagan")
    replay(staff, "2023-08-17")

    mine = [o for o in staff.get(f"{API}/observations").json() if o["organizationId"] == "okanagan"]
    assert mine and mine[0]["draftSource"] == "template"
    assert "Is your site affected" in mine[0]["question"] and mine[0]["suggestedItems"]

    # Manual request creation keeps working while Gemini is down.
    assert staff.post(f"{API}/organizations/okanagan/requests", json=NEW_REQUEST).status_code == 201


def test_check_in_drafts_use_gemini_when_it_answers(login, monkeypatch):
    class Response:
        parsed = ai._DraftSchema(
            question="NASA satellites detected heat about 2 km from your hub. Is your site affected, and do you need support?",
            suggested_items=[ai._DraftItemSchema(item="N95 respirator masks", quantity=150, unit="masks")],
        )

    class Models:
        def generate_content(self, **kwargs):
            return Response()

    class Client:
        models = Models()

    monkeypatch.setattr(ai, "_client", lambda: Client())
    staff = login("staff", "okanagan")
    replay(staff, "2023-08-17")
    mine = next(o for o in staff.get(f"{API}/observations").json() if o["organizationId"] == "okanagan")
    assert mine["draftSource"] == "gemini"
    assert mine["suggestedItems"] == [{"item": "N95 respirator masks", "quantity": 150, "unit": "masks"}]


def fake_request_draft(monkeypatch, **fields):
    """Make Gemini answer a request draft with these fields; returns the prompts it was sent."""
    prompts = []
    answer = {"title": None, "item": None, "quantity": None, "unit": None, "urgency": "standard"}
    answer |= {"description": None, "other_needs": []} | fields

    class Models:
        def generate_content(self, **kwargs):
            prompts.append(kwargs["contents"])
            return type("Response", (), {"parsed": ai._RequestDraftSchema(**answer)})()

    monkeypatch.setattr(ai, "_client", lambda: type("Client", (), {"models": Models()})())
    return prompts


def test_request_drafts_fill_fields_from_staff_words(login, monkeypatch):
    prompts = fake_request_draft(
        monkeypatch,
        title="Volunteers needed for flood response",
        item="Volunteers",
        quantity=10,
        unit="people",
        urgency="urgent",
        description="Flooding has reached our area. We urgently need at least 10 volunteers.",
        other_needs=["Sandbags"],
    )
    staff = login("staff", "coast")
    with SessionLocal() as db:
        before = db.scalar(select(func.count()).select_from(AidRequest))

    text = "Flood here, need volunteers urgently, at least 10. Sandbags too"
    response = staff.post(f"{API}/organizations/coast/requests/draft", json={"text": text})
    assert response.status_code == 200, response.text
    assert response.json() == {
        "title": "Volunteers needed for flood response",
        "item": "Volunteers",
        "quantity": 10,
        "unit": "people",
        "urgency": "urgent",
        "description": "Flooding has reached our area. We urgently need at least 10 volunteers.",
        "otherNeeds": ["Sandbags"],
        "missing": [],
    }
    assert text in prompts[0] and "Coast Community Kitchen" in prompts[0]
    with SessionLocal() as db:  # a draft is never saved
        assert db.scalar(select(func.count()).select_from(AidRequest)) == before


def test_request_drafts_list_what_the_staff_did_not_say(login, monkeypatch):
    # No number given, and values outside the request limits are dropped rather than published.
    fake_request_draft(monkeypatch, title="", item="Volunteers", quantity=0, unit="people", description="x" * 701)
    staff = login("staff", "coast")
    body = staff.post(f"{API}/organizations/coast/requests/draft", json={"text": "need volunteers"}).json()
    assert body["item"] == "Volunteers" and body["quantity"] is None
    assert body["missing"] == ["title", "quantity", "description"]


def test_only_an_organizations_staff_can_draft_its_requests(login, monkeypatch):
    fake_request_draft(monkeypatch, item="Volunteers")
    path, body = f"{API}/organizations/coast/requests/draft", {"text": "need volunteers"}
    assert login().post(path, json=body).status_code == 401
    assert login("supporter").post(path, json=body).status_code == 403
    assert login("staff", "okanagan").post(path, json=body).status_code == 403


def test_request_drafts_report_when_gemini_is_unavailable(login):
    # The tests run without GEMINI_API_KEY, so Gemini is unavailable.
    response = login("staff", "coast").post(f"{API}/organizations/coast/requests/draft", json={"text": "need volunteers"})
    assert response.status_code == 503
    assert response.json()["detail"] == "AI drafting is unavailable right now. Please fill in the form instead."


def test_check_ins_stay_private_until_staff_publish(login):
    okanagan, coast, supporter = login("staff", "okanagan"), login("staff", "coast"), login("supporter")
    replay(okanagan, "2023-08-17")

    public = supporter.get(f"{API}/observations").json()
    assert public and all("question" not in o and "response" not in o and o["suggestedItems"] == [] for o in public)
    assert all(o["playback"] is True and o["simulated"] is False and o["source"].startswith("NASA FIRMS") for o in public)

    own = next(o for o in okanagan.get(f"{API}/observations").json() if o["organizationId"] == "okanagan")
    other = next(o for o in okanagan.get(f"{API}/observations").json() if o["organizationId"] == "shuswap")
    assert own["question"] and own["suggestedItems"] and own["proximityKm"] <= 10
    assert own["observedAt"].startswith("2023-08-1") and "Historical replay" in own["summary"]
    assert "question" not in other

    url = f"{API}/observations/{own['id']}/check-in"
    assert supporter.post(url, json={"response": "support_needed"}).status_code == 403
    assert coast.post(url, json={"response": "support_needed"}).status_code == 403
    assert okanagan.post(url, json={"response": "maybe"}).status_code == 422
    answered = okanagan.post(url, json={"response": "support_needed"})
    assert answered.status_code == 200 and answered.json()["response"] == "support_needed"

    # Answering publishes nothing; publishing is a separate, confirmed step.
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(AidRequest).where(AidRequest.check_in_id.is_not(None))) == 0
    published = okanagan.post(f"{API}/organizations/okanagan/requests", json=NEW_REQUEST | {"observationId": own["id"]})
    assert published.status_code == 201 and published.json()["observationId"] == own["id"]
    wrong = okanagan.post(f"{API}/organizations/okanagan/requests", json=NEW_REQUEST | {"observationId": other["id"]})
    assert wrong.status_code == 422


def test_detections_are_geojson_with_playback_labels(login):
    staff = login("staff", "okanagan")
    assert staff.get(f"{API}/detections").json() == {"type": "FeatureCollection", "features": []}

    replay(staff, "2023-08-15")
    features = staff.get(f"{API}/detections").json()["features"]
    expected = [d for d in load_dataset("bc-wildfire-2023-08").detections if d.acquired_at.day == 15]
    assert len(features) == len(expected)
    first = features[0]
    assert first["geometry"]["type"] == "Point" and len(first["geometry"]["coordinates"]) == 2
    assert first["properties"]["playback"] is True and first["properties"]["acquiredAt"].endswith("Z")
    strong = staff.get(f"{API}/detections", params={"minConfidence": "high"}).json()["features"]
    assert all(f["properties"]["confidence"] == "high" for f in strong)


# ----- Contributions ---------------------------------------------------------------------------


def test_only_confirmed_supplies_count_and_confirming_twice_counts_once(login):
    supporter, okanagan, coast = login("supporter"), login("staff", "okanagan"), login("staff", "coast")
    pledge = {"organizationId": "okanagan", "requestId": "okanagan-request-1", "kind": "supplies", "quantity": 5}

    created = supporter.post(f"{API}/contributions", json=pledge)
    assert created.status_code == 201 and created.json()["status"] == "pledged"
    contribution_id = created.json()["id"]
    assert fulfilled("okanagan-request-1") == 46  # a pledge is intent, not delivery

    status_url = f"{API}/contributions/{contribution_id}/status"
    reported = supporter.patch(status_url, json={"status": "user_reported_completed"})
    assert reported.status_code == 200 and reported.json()["status"] == "user_reported_completed"
    assert fulfilled("okanagan-request-1") == 46

    assert supporter.patch(status_url, json={"status": "organization_confirmed"}).status_code == 403
    assert coast.patch(status_url, json={"status": "organization_confirmed"}).status_code == 403

    confirmed = okanagan.patch(status_url, json={"status": "organization_confirmed"})
    assert confirmed.status_code == 200 and confirmed.json()["confirmedQuantity"] == 5
    assert fulfilled("okanagan-request-1") == 51
    again = okanagan.patch(status_url, json={"status": "organization_confirmed"})
    assert again.status_code == 200 and again.json()["status"] == "organization_confirmed"
    assert fulfilled("okanagan-request-1") == 51  # not 56

    too_many = supporter.post(f"{API}/contributions", json=pledge | {"quantity": 70})  # only 69 still needed
    assert too_many.status_code == 409 and too_many.json()["code"] == "conflict"

    stars = supporter.get(f"{API}/me/contributions").json()
    assert stars[0]["id"] == contribution_id and stars[0]["summary"] == "5 kits · Emergency supply kits"
    review = okanagan.get(f"{API}/organizations/okanagan/contributions").json()
    assert {c["supporterName"] for c in review} == {"Alex Morgan"}
    assert coast.get(f"{API}/organizations/okanagan/contributions").status_code == 403


def test_donations_and_volunteering_never_touch_supply_counts(login):
    supporter, nepal = login("supporter"), login("staff", "nepal")
    donation = supporter.post(f"{API}/contributions", json={"organizationId": "nepal", "kind": "donate", "quantity": 40})
    assert donation.status_code == 201 and donation.json()["summary"] == "$40 USD contribution"
    confirm = nepal.patch(f"{API}/contributions/{donation.json()['id']}/status", json={"status": "organization_confirmed"})
    assert confirm.status_code == 200
    assert fulfilled("nepal-request-1") == 57

    no_request = supporter.post(f"{API}/contributions", json={"organizationId": "nepal", "kind": "supplies", "quantity": 3})
    assert no_request.status_code == 422 and no_request.json()["fields"] == {"requestId": "Choose which request these supplies are for."}


# ----- Search and demo controls ----------------------------------------------------------------


def test_search_without_ai_says_it_is_keyword_search(login):
    client = login()
    response = client.post(f"{API}/search", json={"query": "I want to send winter clothes for children"})
    assert response.status_code == 200
    body = response.json()
    assert body["method"] == "keyword_fallback"  # SQLite has no vector search, so the result is labelled honestly
    items = [r["request"]["item"] for r in body["results"]]
    assert items[0] in {"Children's winter jackets", "Children's mittens and toques"}
    assert body["results"][0]["explanation"].startswith("Contains the words")
    assert client.post(f"{API}/search", json={"query": ""}).status_code == 422


def test_reset_restores_the_original_demo(login):
    staff = login("staff", "okanagan")
    replay(staff, "2023-08-17")
    staff.post(f"{API}/organizations/okanagan/requests", json=NEW_REQUEST)
    assert staff.post(f"{API}/demo/reset").status_code == 200
    assert check_in_count() == 0
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(AidRequest)) == 12
    assert staff.get(f"{API}/me").json()["organizationId"] == "okanagan"  # the demo cookie still works
