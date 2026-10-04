"""Clearly labelled demo data: fictional organizations, their requests and the demo accounts.

Every organization has `sample = True`, and every name, need and contribution is fictional. The
three BC organizations sit near real August 2023 fire detections, so the historical replay sends
them check-ins (Vernon is 28 km away on purpose: outside the 10 km rule, it gets none).
"""

from datetime import datetime

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.models import AidRequest, CheckIn, Contribution, FireDetection, FireEvent, Organization, User

SEEDED_AT = datetime(2026, 10, 2, 17, 30)
SUPPORTER_ID = "demo-supporter"
DEFAULT_STAFF_ORGANIZATION = "okanagan"

ORGANIZATIONS = [
    {
        "id": "okanagan", "name": "Okanagan Community Relief", "type": "Relief organization",
        "location": "Kelowna, British Columbia", "coordinates": (-119.496, 49.888),
        "situation": "Our community hub is preparing essential supplies for families displaced by nearby wildfire activity. Local volunteers are coordinating distribution.",
        "description": "A volunteer-run hub that stores and distributes emergency supplies for families across the Central Okanagan.",
        "volunteer_role": "Community supply packing", "volunteer_slots": 8, "staff": "Jamie Chen",
    },
    {
        "id": "coast", "name": "Coast Community Kitchen", "type": "Community centre",
        "location": "Vancouver, British Columbia", "coordinates": (-123.121, 49.283),
        "situation": "Our kitchen prepares warm meals for neighbours facing food insecurity. Pantry supplies help keep the kitchen open throughout the week.",
        "description": "A neighbourhood community centre whose kitchen serves free hot meals five days a week.",
        "volunteer_role": "Meal preparation", "volunteer_slots": 12, "staff": "Sam Rivera",
    },
    {
        "id": "guatemala", "name": "Highland Care Collective", "type": "Community clinic",
        "location": "Antigua, Guatemala", "coordinates": (-90.734, 14.558),
        "situation": "Community teams are delivering clean water to villages after heavy rainfall affected local roads and water supplies.",
        "description": "A small community clinic and outreach team serving highland villages around Antigua.",
        "volunteer_role": "Water kit assembly", "volunteer_slots": 6, "staff": "Lucía Ramírez",
    },
    {
        "id": "morocco", "name": "Atlas Neighbour Network", "type": "Community centre",
        "location": "Marrakesh, Morocco", "coordinates": (-7.982, 31.63),
        "situation": "We support rural communities with essential household supplies and help families prepare for colder nights.",
        "description": "A community centre linking volunteers in Marrakesh with families in nearby mountain villages.",
        "volunteer_role": "Supply sorting", "volunteer_slots": 10, "staff": "Youssef Amrani",
    },
    {
        "id": "kenya", "name": "Tana River Community Hub", "type": "Relief organization",
        "location": "Garissa, Kenya", "coordinates": (39.646, -0.453),
        "situation": "Local coordinators are restocking water and hygiene supplies for households affected by seasonal flooding.",
        "description": "A relief hub coordinating flood response for households along the Tana River.",
        "volunteer_role": "Hygiene pack assembly", "volunteer_slots": 8, "staff": "Amina Hassan",
    },
    {
        "id": "nepal", "name": "Valley Together", "type": "Children's charity",
        "location": "Kathmandu, Nepal", "coordinates": (85.324, 27.717),
        "situation": "Neighbourhood volunteers are assembling school supplies for children returning to class after local disruptions.",
        "description": "A children's charity supporting school attendance for children in the Kathmandu Valley.",
        "volunteer_role": "School kit packing", "volunteer_slots": 6, "staff": "Pema Sherpa",
    },
    {
        "id": "philippines", "name": "Bayanihan Coastal Care", "type": "Relief organization",
        "location": "Tacloban, Philippines", "coordinates": (125.005, 11.243),
        "situation": "Our coastal community is preparing emergency supplies and supporting households with limited access to clean drinking water.",
        "description": "A coastal relief organization helping households prepare for typhoon season.",
        "volunteer_role": "Water distribution", "volunteer_slots": 10, "staff": "Maria Santos",
    },
    {
        "id": "korea", "name": "Han River Neighbours", "type": "Elderly-care organization",
        "location": "Seoul, South Korea", "coordinates": (126.978, 37.566),
        "situation": "Our volunteer team checks in on older neighbours during periods of extreme heat and delivers everyday essentials.",
        "description": "A neighbourhood elderly-care organization supporting older adults who live alone.",
        "volunteer_role": "Wellness check-in calls", "volunteer_slots": 15, "staff": "Ji-woo Park",
    },
    {
        "id": "lake-country", "name": "Lake Country Seniors' Residence", "type": "Elderly-care facility",
        "location": "Lake Country, British Columbia", "coordinates": (-119.414, 50.054),
        "situation": "Our residence cares for 60 older adults. Staff and volunteers run daily activities and accompany residents to appointments.",
        "description": "A non-profit residence and day program for older adults in Lake Country.",
        "volunteer_role": "Activity companions", "volunteer_slots": 6, "staff": "Helen Ward",
    },
    {
        "id": "shuswap", "name": "North Shuswap Community Hall", "type": "Community centre",
        "location": "Scotch Creek, British Columbia", "coordinates": (-119.455, 50.915),
        "situation": "The hall hosts a weekly food share, youth drop-in nights and seasonal events for the small communities of the North Shuswap.",
        "description": "A volunteer-run community centre serving Scotch Creek, Celista and nearby communities.",
        "volunteer_role": "Food share setup", "volunteer_slots": 8, "staff": "Owen Mitchell",
    },
    {
        "id": "vernon", "name": "Vernon Children's Fund", "type": "Children's charity",
        "location": "Vernon, British Columbia", "coordinates": (-119.272, 50.267),
        "situation": "We run an after-school program and provide seasonal clothing for children from low-income families.",
        "description": "A children's charity running after-school programs and clothing drives in the North Okanagan.",
        "volunteer_role": "After-school program helpers", "volunteer_slots": 5, "staff": "Nadia Brooks",
    },
]

# (id, organization, item, title, quantity, fulfilled, unit, urgency, description)
REQUESTS = [
    ("okanagan-request-1", "okanagan", "Emergency supply kits", "Emergency supply kits for local families", 120, 46, "kits", "urgent",
     "Kits with water, a flashlight, a first-aid kit and non-perishable snacks for families who had to leave home at short notice."),
    ("coast-request-1", "coast", "Pantry food boxes", "Pantry food boxes for local families", 200, 138, "boxes", "standard",
     "Boxes of non-perishable pantry food such as rice, pasta, canned vegetables and beans to keep our free meal program running."),
    ("guatemala-request-1", "guatemala", "Water filter kits", "Water filter kits for local families", 80, 25, "kits", "urgent",
     "Household water filter kits so families in highland villages can drink safely while roads and pipes are repaired."),
    ("morocco-request-1", "morocco", "Warm blankets", "Warm blankets for local families", 160, 89, "blankets", "standard",
     "New warm blankets for families in mountain villages ahead of cold winter nights."),
    ("kenya-request-1", "kenya", "Hygiene packs", "Hygiene packs for local families", 100, 32, "packs", "urgent",
     "Hygiene packs with soap, toothpaste, sanitary pads and water purification tablets for families displaced by flooding."),
    ("nepal-request-1", "nepal", "School supply packs", "School supply packs for local families", 90, 57, "packs", "standard",
     "School supply packs with notebooks, pencils and a backpack for children returning to class."),
    ("philippines-request-1", "philippines", "Drinking water cases", "Drinking water cases for local families", 140, 38, "cases", "urgent",
     "Cases of bottled drinking water for coastal households preparing for typhoon season."),
    ("korea-request-1", "korea", "Cooling care kits", "Cooling care kits for local families", 70, 41, "kits", "standard",
     "Cooling care kits with a fan, cooling towels and oral rehydration salts for older adults living alone during heatwaves."),
    ("lake-country-request-1", "lake-country", "Large-print books and puzzles", "Large-print books and puzzles for residents", 40, 9, "sets", "standard",
     "Large-print books and jigsaw puzzles for our residents' daily activity program."),
    ("shuswap-request-1", "shuswap", "Non-perishable food hampers", "Food hampers for the weekly food share", 50, 18, "hampers", "standard",
     "Non-perishable food hampers for families who come to our weekly food share."),
    ("vernon-request-1", "vernon", "Children's winter jackets", "Winter jackets for children in our program", 60, 12, "jackets", "standard",
     "New winter jackets in children's sizes 4 to 12 for kids in our after-school program before the first snow."),
    ("vernon-request-2", "vernon", "Children's mittens and toques", "Mittens and toques for children", 80, 20, "sets", "standard",
     "Warm mittens and toques (winter hats) in children's sizes for outdoor play this winter."),
]

# (id, organization, request, kind, quantity, status, created, confirmed)
CONTRIBUTIONS = [
    ("sample-contribution-1", "coast", "coast-request-1", "supplies", 12, "organization_confirmed",
     datetime(2026, 9, 12, 14, 0), datetime(2026, 9, 13, 16, 0)),
    ("sample-contribution-2", "nepal", None, "donate", 25, "organization_confirmed",
     datetime(2026, 9, 21, 10, 30), datetime(2026, 9, 22, 9, 0)),
    ("sample-contribution-3", "okanagan", None, "volunteer", 2, "pledged",
     datetime(2026, 10, 1, 19, 0), None),
]


def staff_id(organization_id: str) -> str:
    return "demo-staff" if organization_id == DEFAULT_STAFF_ORGANIZATION else f"demo-staff-{organization_id}"


def _rows() -> list:
    rows: list = []
    for o in ORGANIZATIONS:
        base = f"https://example.org/{o['id']}"
        rows.append(Organization(
            id=o["id"], name=o["name"], type=o["type"], location=o["location"],
            longitude=o["coordinates"][0], latitude=o["coordinates"][1],
            situation=o["situation"], description=o["description"],
            website_url=base, donate_url=f"{base}/donate", supplies_url=f"{base}/supplies", volunteer_url=f"{base}/volunteer",
            volunteer_role=o["volunteer_role"], volunteer_slots=o["volunteer_slots"], sample=True,
            created_at=SEEDED_AT, updated_at=SEEDED_AT,
        ))
    rows.append(User(id=SUPPORTER_ID, name="Alex Morgan", role="supporter", created_at=SEEDED_AT))
    for o in ORGANIZATIONS:
        rows.append(User(id=staff_id(o["id"]), name=o["staff"], role="staff", organization_id=o["id"], created_at=SEEDED_AT))
    for rid, org, item, title, quantity, fulfilled, unit, urgency, description in REQUESTS:
        rows.append(AidRequest(
            id=rid, organization_id=org, item=item, title=title, quantity=quantity, fulfilled=fulfilled, unit=unit,
            urgency=urgency, description=description, status="published",
            confirmed_at=SEEDED_AT, created_at=SEEDED_AT, updated_at=SEEDED_AT,
        ))
    for cid, org, request, kind, quantity, status, created, confirmed in CONTRIBUTIONS:
        rows.append(Contribution(
            id=cid, user_id=SUPPORTER_ID, organization_id=org, request_id=request, kind=kind, quantity=quantity,
            status=status, created_at=created, confirmed_at=confirmed,
            confirmed_quantity=quantity if status == "organization_confirmed" else None,
        ))
    return rows


def seed(db: Session) -> int:
    """Add any demo rows that are missing. Existing rows are left alone. Returns how many were added."""
    added = 0
    for row in _rows():
        if db.get(type(row), row.id) is None:
            db.add(row)
            db.flush()  # parents first, so foreign keys always point at existing rows
            added += 1
    db.commit()
    return added


def reset(db: Session) -> int:
    """Delete everything, including replayed satellite data, and add the demo data again."""
    for model in (Contribution, AidRequest, CheckIn, FireDetection, FireEvent, User, Organization):
        db.execute(delete(model))
    db.commit()
    return seed(db)
