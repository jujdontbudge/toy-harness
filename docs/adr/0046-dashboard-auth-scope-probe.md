# ADR 0046: Dashboard profile-scoped auth probe

## Decision

Extend the existing Hermes auth fixture owner with a closed AT-hermes-config-90 mode. The probe prepares the pinned Hermes source in its disposable candidate, applies the existing profile-auth, dashboard-sanitization, and fake-auth patches, then drives the pinned dashboard CLI through its public loopback OAuth routes. The fake OAuth and OS controls stay in the existing external fixture patch. The probe emits bounded public response facts, store digests, and provider ledger counts through the existing check view.

The mode uses two temporary Hermes profiles. A successful OAuth grant is saved only in the selected profile and is then read and used by fresh public CLI processes. A separate profile flow triggers the registered atomic-replace EIO control; polling must return the fixed sanitized HTTP 400, and fresh auth-list plus tools-disabled chat must show no usable grant or accepted provider effects.

## Boundaries

Only loopback dashboard HTTP and fixed synthetic OAuth/model responses are used. The dashboard child is started and joined by the probe; its ephemeral bound port is read from Hermes's existing dashboard stdout readiness sentinel. Requests reject redirects. Global dashboard lifecycle commands are never used. Session tokens, session identifiers, synthetic credentials, response bodies, and child streams remain in memory and are not written to receipts. The probe matches the child PID to its owned process handle and checks the child-reported parent PID, UID, and GID against the current probe process; this is fixture process evidence, not installed-service identity. The root and opposite profile stores must remain byte-identical across each phase. Success-owner metadata may change during fresh use.

This probe does not establish installed-service identity, protected-controller behavior, native service isolation, or whole acceptance completion. It does not use real accounts or credentials and does not extend the dashboard product patch.

The pinned source archive excludes built web assets. The fixture supplies a fixed minimal index through the existing HERMES_WEB_DIST override inside its owned scratch directory so the public dashboard starts without acquiring UI dependencies. Frontend rendering is outside this OAuth probe. Owned dashboards receive SIGINT, which the pinned public runner handles as a clean return, with bounded SIGKILL fallback. Existing generated origin, denial, and CLI marker facts support sanitized failure attribution.

## Terminal receipt observation

The saved third attempt reached approved public OAuth and changed the success-profile store, then returned a null parsed child receipt. Pinned candidate source shows dashboard startup redirects Python stdout to stderr while the fixture prints its terminal receipt through current stdout. The historical runtime cause remains unproven because the old readback inspected only stdout and discarded parse failures and actual process close facts.

The admitted observation repair classifies expected generated terminal receipt candidates in both already bounded owned streams in memory. It reports only fixed classifications, capped counts, schema issue codes and allowlisted canonical schema paths. Unknown path segments collapse to a fixed OTHER category. Validation messages, rejected values, arbitrary keys, line previews, token-bearing receipt objects and raw streams never enter public evidence. Actual owned process status, signal, timeout, overflow and spawn-error booleans are independent of the child receipt.

Full strict generated validation, expected operation/phase and child identity matching remain required. A matching stderr receipt is diagnostic only; stdout-only acceptance is unchanged. Duplicate or ambiguous expected receipts cannot establish a successful child. The one newly instrumented unfiltered CLI run retains all three original mandatory cells and may remain failed at its first cell. Parent review of its separating public facts precedes any producer-output repair or further acceptance run.

## Verified receipt-channel repair

The second newly instrumented CLI run observed exactly one strict generated dashboard receipt on stderr with matching owned identity, zero schema rejection, and actual process exit 0 with no signal, timeout, overflow or spawn error. The first changed run was refused by the controller before receipt publication. The controller classifies unfiltered native auth from the verified behavioral Hermes manifest and its auth scenario instead of a duplicate ID list. The older save-fault and fresh-process manifests name concrete public Hermes commands, so a shared owner-method annotation cannot classify them. Check IDs and owner restrictions remain unchanged. Evidence: `build/evidence/R0.03/dashboard90-second-diagnostic-summary.json` and `dashboard90-workflow-final-cli/AT-hermes-config-84-run.json`.

The fixture captures its receipt stdout before importing Hermes and emits its terminal generated receipt explicitly to that stream. It does not reset global stdout or change dashboard authentication. The consumer retains stdout-only acceptance and full strict schema validation. Original three-case acceptance and affected auth regressions must pass after this source change; whole protected AT/card acceptance remains pending.
