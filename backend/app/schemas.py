"""JSON shapes for requests and responses, matching API_CONTRACT.md.

Python uses snake_case; the JSON uses camelCase (organization_id <-> organizationId).
"""

from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, field_validator, model_validator
from pydantic.alias_generators import to_camel


def iso_utc(value: datetime) -> str:
    return value.strftime("%Y-%m-%dT%H:%M:%SZ")


UtcTime = Annotated[datetime, PlainSerializer(iso_utc, return_type=str)]
Coordinates = tuple[float, float]  # [longitude, latitude]
Role = Literal["supporter", "staff"]
Urgency = Literal["urgent", "standard"]
RequestStatus = Literal["published", "closed"]
CheckInResponse = Literal["not_affected", "checking", "support_needed"]
ContributionKind = Literal["donate", "supplies", "volunteer"]
ContributionStatus = Literal["pledged", "user_reported_completed", "organization_confirmed"]

MAX_QUANTITY = 100_000


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class InputModel(ApiModel):
    # Trim surrounding spaces from every text field.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, str_strip_whitespace=True)


def check_quantity(value: int | None) -> int | None:
    if value is not None and not 1 <= value <= MAX_QUANTITY:
        raise ValueError("Enter a whole quantity between 1 and 100,000.")
    return value


# ----- Responses ---------------------------------------------------------------------------


class SupportLinks(ApiModel):
    website: str | None = None
    donate: str | None = None
    supplies: str | None = None
    volunteer: str | None = None


class AidRequestOut(ApiModel):
    id: str
    organization_id: str
    title: str
    item: str
    quantity: int
    fulfilled: int
    unit: str
    urgency: Urgency
    description: str
    status: RequestStatus
    confirmed_at: UtcTime
    observation_id: str | None = None
    links: SupportLinks
    created_at: UtcTime
    updated_at: UtcTime


class OrganizationOut(ApiModel):
    id: str
    name: str
    type: str
    location: str
    coordinates: Coordinates
    situation: str
    description: str
    links: SupportLinks
    updated_at: UtcTime
    sample: bool
    volunteer_role: str
    volunteer_slots: int
    requests: list[AidRequestOut]


class OrganizationSummary(ApiModel):
    id: str
    name: str
    location: str
    type: str


class SuggestedItem(ApiModel):
    item: str = Field(min_length=1, max_length=120)
    quantity: int = Field(ge=1, le=MAX_QUANTITY)
    unit: str = Field(min_length=1, max_length=40)


class ObservationOut(ApiModel):
    """A check-in: one fire event, sent to one nearby organization."""

    id: str
    organization_id: str
    title: str
    summary: str
    coordinates: Coordinates
    source: str
    observed_at: UtcTime
    proximity_km: float
    simulated: bool
    playback: bool
    detection_count: int
    draft_source: Literal["gemini", "template"]
    # Staff of the organization only; omitted for everyone else.
    question: str | None = None
    response: CheckInResponse | None = None
    responded_at: UtcTime | None = None
    suggested_items: list[SuggestedItem]


class ContributionOut(ApiModel):
    id: str
    organization_id: str
    organization_name: str
    request_id: str | None = None
    kind: ContributionKind
    summary: str
    quantity: int
    confirmed_quantity: int | None = None
    created_at: UtcTime
    status: ContributionStatus
    reported_at: UtcTime | None = None
    confirmed_at: UtcTime | None = None
    simulated: bool = True
    supporter_name: str | None = None  # only in the organization's own list


class SessionOut(ApiModel):
    id: str
    name: str
    role: Role
    organization_id: str | None = None
    demo: bool = True


class BootstrapOut(ApiModel):
    organizations: list[OrganizationOut]
    observations: list[ObservationOut]
    contributions: list[ContributionOut]
    session: SessionOut


class SearchResultOut(ApiModel):
    score: float
    request: AidRequestOut
    organization: OrganizationSummary
    explanation: str


class SearchOut(ApiModel):
    query: str
    method: Literal["tidb_vector", "keyword_fallback"]
    results: list[SearchResultOut]


class ReplayOut(ApiModel):
    playback: bool
    dataset: str
    title: str
    source: str
    observed_from: UtcTime
    observed_to: UtcTime
    detections_added: int
    detections_total: int
    events: int
    check_ins_created: int
    check_ins_updated: int
    check_ins_existing: int


# ----- Requests ----------------------------------------------------------------------------


class SupportLinksInput(InputModel):
    website: str | None = Field(default=None, max_length=500)
    donate: str | None = Field(default=None, max_length=500)
    supplies: str | None = Field(default=None, max_length=500)
    volunteer: str | None = Field(default=None, max_length=500)

    @field_validator("website", "donate", "supplies", "volunteer")
    @classmethod
    def must_be_web_address(cls, value: str | None) -> str | None:
        if not value:
            return None
        if not value.startswith(("https://", "http://")):
            raise ValueError("Links must start with https:// or http://.")
        return value


class DemoLoginIn(InputModel):
    role: Role
    organization_id: str | None = None


class RequestIn(InputModel):
    title: str = Field(min_length=1, max_length=160)
    item: str = Field(min_length=1, max_length=120)
    quantity: int
    unit: str = Field(min_length=1, max_length=40)
    urgency: Urgency
    description: str = Field(min_length=1, max_length=2000)
    observation_id: str | None = None
    links: SupportLinksInput | None = None
    confirmed: bool

    _quantity = field_validator("quantity")(check_quantity)

    @field_validator("confirmed")
    @classmethod
    def must_be_confirmed(cls, value: bool) -> bool:
        if not value:
            raise ValueError("Confirm the need with your organization before publishing.")
        return value


class RequestPatch(InputModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    item: str | None = Field(default=None, min_length=1, max_length=120)
    quantity: int | None = None
    unit: str | None = Field(default=None, min_length=1, max_length=40)
    urgency: Urgency | None = None
    description: str | None = Field(default=None, min_length=1, max_length=2000)
    observation_id: str | None = None
    links: SupportLinksInput | None = None
    status: RequestStatus | None = None
    confirmed: bool | None = None

    _quantity = field_validator("quantity")(check_quantity)

    @model_validator(mode="after")
    def content_changes_need_confirmation(self) -> "RequestPatch":
        if self.model_fields_set - {"status", "confirmed"} and self.confirmed is not True:
            raise ValueError("Confirm the need with your organization before publishing changes.")
        return self


class RequestDraftIn(InputModel):
    text: str = Field(min_length=3, max_length=1000)


class RequestDraftOut(ApiModel):
    """Fields Gemini filled from the staff's words. Anything the staff did not say is listed in `missing`."""

    title: str | None
    item: str | None
    quantity: int | None
    unit: str | None
    urgency: Urgency
    description: str | None
    other_needs: list[str]
    missing: list[str]


class CheckInIn(InputModel):
    response: CheckInResponse


class ContributionIn(InputModel):
    organization_id: str = Field(min_length=1, max_length=40)
    request_id: str | None = Field(default=None, max_length=40)
    kind: ContributionKind
    quantity: int
    note: str | None = Field(default=None, max_length=500)

    _quantity = field_validator("quantity")(check_quantity)


class ContributionStatusIn(InputModel):
    status: Literal["user_reported_completed", "organization_confirmed"]
    confirmed_quantity: int | None = None

    _quantity = field_validator("confirmed_quantity")(check_quantity)


class SearchIn(InputModel):
    query: str = Field(min_length=2, max_length=300)
    limit: int = Field(default=5, ge=1, le=20)


class ReplayIn(InputModel):
    dataset: str = Field(default="bc-wildfire-2023-08", max_length=60)
    through: date | None = None  # replay detections up to and including this UTC day
