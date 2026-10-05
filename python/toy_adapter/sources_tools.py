from collections.abc import Sequence
from typing import Final, Protocol

from toy_contracts.generated import (
    UUID as SourceId,
)
from toy_contracts.generated import (
    Instant as ISOInstant,
)
from toy_contracts.generated import (
    SourceStatus,
    ToySourcesStatusInputV1,
    ToySourcesStatusResultV1,
)


class SourcesOwner(Protocol):
    async def inventory(self) -> Sequence[SourceStatus]: ...

    async def status(self, source_id: SourceId) -> SourceStatus: ...


class Clock(Protocol):
    def now(self) -> ISOInstant: ...


TOOL_REGISTRATION: Final[dict[str, str]] = {
    "name": "toy_sources_status",
    "plugin": "toy",
    "plugin_version": "1.0.0",
    "toolset": "toy",
    "input_schema": "ToySourcesStatusInputV1",
    "result_schema": "ToySourcesStatusResultV1",
}


async def toy_sources_status(
    input_data: ToySourcesStatusInputV1,
    sources: SourcesOwner,
    clock: Clock,
) -> ToySourcesStatusResultV1:
    source_ids = input_data.get("source_ids")
    if source_ids is None:
        rows = await sources.inventory()
    else:
        rows = [await sources.status(source_id) for source_id in source_ids]
    return {
        "ok": True,
        "data": {"sources": list(rows), "checked_at": clock.now()},
    }
