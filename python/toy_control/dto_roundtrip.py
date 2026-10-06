import json

from toy_contracts import (
    UUID,
    Digest,
    FocusSession,
    IngestReceipt,
    Instant,
    ObservationEvidenceRef,
    ObservationRef,
    PrincipalId,
    Revision,
    RunContext,
    UInt64String,
)


def roundtrip_fixture() -> str:
    quote = "å 👩🏽‍💻 café"
    observation: ObservationEvidenceRef = {
        "observationRef": ObservationRef("life://observation/550e8400-e29b-41d4-a716-446655440009"),
        "documentId": UUID("550e8400-e29b-41d4-a716-446655440008"),
        "byteFrom": Revision("7"),
        "byteTo": Revision(str(7 + len(quote.encode("utf-8")))),
        "quote": quote,
    }
    context: RunContext = {
        "profile": "toy",
        "runId": UUID("550e8400-e29b-41d4-a716-446655440001"),
        "parentRunId": None,
        "actorId": PrincipalId("550e8400-e29b-41d4-a716-446655440002"),
        "sessionId": "dto-fixture-session",
        "turnId": "dto-fixture-turn",
        "wireSchemaVersion": "toy-agent/v1",
        "contractVersion": 1,
        "recordRevision": Revision("9007199254740993"),
        "releaseDigest": Digest("a" * 64),
        "generation": Revision("9007199254740995"),
        "source": "cli",
        "permissionRefs": [UUID("550e8400-e29b-41d4-a716-446655440003")],
    }
    focus: FocusSession = {
        "id": UUID("550e8400-e29b-41d4-a716-446655440004"),
        "focusGeneration": UUID("550e8400-e29b-41d4-a716-446655440005"),
        "revision": UInt64String("18446744073709551615"),
        "commitmentId": UUID("550e8400-e29b-41d4-a716-446655440006"),
        "objective": "Synthetic DTO round-trip",
        "startsAt": Instant("2026-10-06T00:00:00.000Z"),
        "endsAt": Instant("2026-10-06T00:25:00.000Z"),
        "state": "active",
        "ruleSetId": UUID("550e8400-e29b-41d4-a716-446655440007"),
        "policyHash": Digest("b" * 64),
    }
    ingest: IngestReceipt = {
        "receiptId": UUID("550e8400-e29b-41d4-a716-446655440010"),
        "deviceId": UUID("550e8400-e29b-41d4-a716-446655440011"),
        "streamId": UUID("550e8400-e29b-41d4-a716-446655440012"),
        "committedThroughSeq": UInt64String("9007199254740997"),
        "committedEventIds": [UUID("550e8400-e29b-41d4-a716-446655440013")],
        "observationRefs": [observation],
        "committedWatermark": UInt64String("9007199254740999"),
        "serverTime": Instant("2026-10-06T00:00:00.000Z"),
        "nextUploadAfterMs": 3000,
    }
    encoded = json.dumps([context, focus, ingest], ensure_ascii=False)
    return json.dumps(json.loads(encoded), ensure_ascii=False)
