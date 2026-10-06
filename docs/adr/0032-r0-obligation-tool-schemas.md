# ADR 0032: R0 Obligations tool parameter schemas

**Status:** accepted for the R0 schema-feasibility slice
**Scope:** the five Hermes tool parameter schemas required by `AT-obligations-76`
**Owner:** `@toy/contracts`

## Written interface

The source module `packages/contracts/src/obligations/v1/tool-schemas.mts` exports the following Zod schemas and tool-name mapping:

| Export | Wire tool | Generated DTO name |
| --- | --- | --- |
| `toyCaptureParametersSchema` | `toy_capture` | `ToyCaptureParametersV1` |
| `toyDueParametersSchema` | `toy_due` | `ToyDueParametersV1` |
| `toyResolveParametersSchema` | `toy_resolve` | `ToyResolveParametersV1` |
| `toyDeferParametersSchema` | `toy_defer` | `ToyDeferParametersV1` |
| `toySatisfyParametersSchema` | `toy_satisfy` | `ToySatisfyParametersV1` |

`obligationToolParameters` maps those exact five wire names to their Zod schemas. `obligationToolSchemaInventory` maps the five DTO names above to those schemas for the existing contracts generator. No tool result schema or Obligations service port is introduced here.

## Decision

The source mirrors the normative tool inputs in `personal-assistant-harness/specs/obligations.md` §5. It composes the canonical `observationEvidenceRefSchema`, `recordRefSchema`, `uuidSchema`, `instantSchema`, and `revisionSchema`; it does not recreate shared evidence or identifier DTOs. The revision input narrows the canonical decimal revision schema to the normative 19-character wire limit.

The existing generator emits JSON Schema Draft 2020-12 and DTOs from the central schema inventory. It rejects `$ref`/`$defs` and `oneOf`, so nested values remain inline and Zod unions emit `anyOf`. The branches in capture and defer have distinct `mode` literals, making those unions mutually exclusive while preserving each accepted input. The generator supports `anyOf` and resolves reused schemas inline.

Zod array refinements enforce unique IDs and recurrence dates at the source boundary; matching `uniqueItems: true` metadata carries the same rule into generated JSON Schema. The amendment patch refinement rejects an empty patch; `minProperties: 1` metadata carries that constraint into generated JSON Schema. These metadata keywords are structural schema keywords, not defaults.

`toy_due` fields besides `schema_version` and `view` remain optional in the input schemas. Its documented defaults are applied by the service after validation; schema validation does not coerce, remove fields, or insert defaults. Draft 2020-12 validation must use Ajv2020 with `coerceTypes`, `removeAdditional`, and `useDefaults` disabled.

The schemas establish structural R0 feasibility only. Temporal validity, signed-PostgreSQL-bigint bounds, evidence span matching, configured business calendars, recurrence semantics, due cross-field rules, and mutation authorization remain service behavior and are not claimed as implemented or passed here.

## Integration contract

The contracts owner adds `obligationToolSchemaInventory` and `obligationToolParameters` to its public surface and adds the five schemas to the existing `schemaInventory`. The existing sole generator produces one Draft 2020-12 artifact per inventory entry and generated DTOs. No second generator, R1 port, queue protocol, or generated file is owned by this decision.

The R0 fault spike will validate representative accepted and rejected payloads against each generated artifact with Ajv2020, including unknown-field rejection, capture/defer mode separation, nonempty patch, unique arrays, and `toy_due` optional-field/default behavior. Passing that spike is evidence for the relevant R0 feasibility check only; it is not an AT pass for this preparation change.

The first actual generation check encountered the old optional-nullable rejection inherited from the deferred Swift projection. The active TypeScript inference and Python `NotRequired[Optional[T]]` TypedDict projection preserve absent versus explicit null without that rejection. The unsupported Swift path remains deferred; the active sole generator now emits these normative optional-nullable fields.
