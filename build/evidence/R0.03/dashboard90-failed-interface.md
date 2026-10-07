# ADR 0046: Dashboard profile-scoped auth probe

## Decision

Extend the existing Hermes auth fixture owner with a closed AT-hermes-config-90 mode. The probe prepares the pinned Hermes source in its disposable candidate, applies the existing profile-auth, dashboard-sanitization, and fake-auth patches, then drives the pinned dashboard CLI through its public loopback OAuth routes. The fake OAuth and OS controls stay in the existing external fixture patch. The probe emits bounded public response facts, store digests, and provider ledger counts through the existing check view.

The mode uses two temporary Hermes profiles. A successful OAuth grant is saved only in the selected profile and is then read and used by fresh public CLI processes. A separate profile flow triggers the registered atomic-replace EIO control; polling must return the fixed sanitized HTTP 400, and fresh auth-list plus tools-disabled chat must show no usable grant or accepted provider effects.

## Boundaries

Only loopback dashboard HTTP and fixed synthetic OAuth/model responses are used. The dashboard child is started and joined by the probe; its ephemeral bound port is read from Hermes's existing dashboard stdout readiness sentinel. Requests reject redirects. Global dashboard lifecycle commands are never used. Session tokens, session identifiers, synthetic credentials, response bodies, and child streams remain in memory and are not written to receipts. The probe matches the child PID to its owned process handle and checks the child-reported parent PID, UID, and GID against the current probe process; this is fixture process evidence, not installed-service identity. The root and opposite profile stores must remain byte-identical across each phase. Success-owner metadata may change during fresh use.

This probe does not establish installed-service identity, protected-controller behavior, native service isolation, or whole acceptance completion. It does not use real accounts or credentials and does not extend the dashboard product patch.

The pinned source archive excludes built web assets. The fixture supplies a fixed minimal index through the existing HERMES_WEB_DIST override inside its owned scratch directory so the public dashboard starts without acquiring UI dependencies. Frontend rendering is outside this OAuth probe. Owned dashboards receive SIGINT, which the pinned public runner handles as a clean return, with bounded SIGKILL fallback. Existing generated origin, denial, and CLI marker facts support sanitized failure attribution.
