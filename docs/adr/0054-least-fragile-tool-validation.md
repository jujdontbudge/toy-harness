# R0 least-fragile tool validation

AT-adhd-features-106 uses the existing EngineeringControl owner and public CLI. The check reads the actual application lock, canonical dependency rows, module graph, ADHD manifest and source tree, and the existing M08 research decision. It does not activate a feature or certify research/provider/native admission.

`EngineeringControl.validateLeastFragileTools(context, testSources = [], testResearch = [])` returns `Result<CheckViewV1[]>`. `context` is `OpsControlContextV1`; source overlays are canonical `FilePatchV1[]`; research overlays are canonical `ResearchDocumentOverlayV1[]`. Overlays represent external filesystem/research inputs and are accepted only in an owned R0 fake-clock/fake-model test stack. Original and replacement digests must match. No files are modified. Production and gardener scans use only actual inputs.

The three checks validate shared installed lock declarations against CONTRACTS pins, constrain ADHD effects to declared public owner interfaces, and preserve the existing M08 decision's blocked state when its choice lacks proof. TypeScript's existing parser identifies imports and ambient effect capabilities. ADHD cannot add an independent timer, OS/blocker or credential capability, startup lifecycle script, external package, or second lock. Pure planning logic and declared public owner calls remain allowed.

The existing gardener includes these checks. The registered unfiltered probe calls the public owner for the actual inventory and isolated external-source mutations: a mismatched dependency lock, a timer, a blocker capability, a credential capability, a runtime download, a private owner import, and an unproven research alternative. Its run/show receipts retain check states and source digests. It never treats M08 BLOCKED as research admission.

No command, DTO, scheduler, store, protocol or release owner is added. The implementation stays within EngineeringControl; removing it would move the source inventory, capability analysis and research decision checks into its callers. Root requests and their frozen child artifacts remain unchanged. Native dispatcher evidence and whole R0 acceptance remain separately pending.

The source unit has a two-hour limit and at most three total assigned CLI runs, including the unsupported baseline. Stop after the first passing implementation run; log remaining acceptance separately.
