# ADR 0047: Ops outside-option research fixture

## Decision

Add AT-ops-44 as an unfiltered registered CLI probe handled by the existing Hermes `ModelRouteProbe.run` owner under the `research.component-receipts` scenario. Reuse `ResearchComponentComparisonV3`, the indexed A14 row, `EngineeringControl.checkResearch`, and the existing fixed external executor/resource-reader fixture. Do not add a DTO, module, protocol, or service.

The probe derives A14's source archive and required requirement IDs from the current register inspection. It supplies a seeded V3 decision overlay for A14, obtains the execution receipt from `ModelRoute.delegationReceipt`, and checks the resulting A14 component decision through `EngineeringControl.checkResearch`. Its outside option uses `example: null`; two named options use truthful A14 tool labels in `tool` and `example`. Each option is separately linked to seeded evidence. The fixture-only positive record states that the selected option runs on the existing Mac, which remains the authoritative application host.

## Registered phases

The AT-ops-44 manifest has four exact phases:

- `outside-selected-with-evidence` selects the seeded outside candidate when its fixture evidence supports the strongest suitable choice among the named options.
- `outside-without-primary-support` removes the outside option's primary support and expects the research gate to block the decision.
- `outside-route-mismatch` uses the existing external executor's wrong-observed-model fault and expects the A14 route validation to block the decision.
- `mapped-requirement-removed` removes one requirement ID derived from A14's current missing-requirement readback and expects that exact ID to remain missing.

The successful record must preserve all IDs returned by A14's current `missingRequirementIds`, the indexed release gate, source-backed validation, and the `AT-ops-44` acceptance link. The positive route receipt must be observed research with the pinned skill and current expected route. Every phase uses seeded evidence and zero live provider sends.

## Boundaries

This is a deterministic fixture comparison, not real-world research, an independent ranking system, or proof that any real option is most reliable. The V3 `resources` field is free text. The positive phase checks the fixture's explicit Mac-host claim; it does not establish a generic semantic application-host policy. Protected/native execution, actual protected identity, live primary research, and whole acceptance remain unverified. Probe records keep `nativeExecutionVerified` and `wholeATComplete` false.

AT-authority-60 keeps its existing manifest, 17 phases, M03 target, and behavior unchanged.
