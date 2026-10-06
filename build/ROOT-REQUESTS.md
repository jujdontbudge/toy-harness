# Root requests

Johan's 2026-10-06 instruction: the builder prepares exact repository commands here; Claude runs pending requests as root, appends their result and verification output to the same entry, and marks each DONE or FAILED. Pending root work never blocks the goal. Preserve existing services, profiles, accounts and files. Command output in this file must be sanitized public JSON; never append credentials, vault contents or environment values.

## ROOT-R004-20261006-01 — DONE

- Request ID: `ae742735-1693-4322-81f9-8767c0074179`
- Card: R0.04, prerequisite for R0.01
- Purpose: stage the frozen 201,748,037-byte SIWC control/runtime bundle under the canonical protected control release root, and independently verify its code inventory, numeric ownership/modes and standalone Python relocation.
- Artifact: `927562c37b764041c752a6a8d71168aedef088599d1a077ecac0b2228d7e2f71`
- Preparation proof: `build/evidence/R0.04-siwc-stage-prepare.json`; 2,613 files, Node24.21.0, standalone CPython3.14.7, Zod4.6.5, compiled Secrets and generated contracts. The frozen artifact is in `build/.siwc-control-staging/<artifact>/`; later source generation cannot change it.
- Scope: new `control/releases/<artifact>/payload` and manifest only. No existing mode/owner or `control/current` change, daemon, Keychain/browser/model operation or service activation. Existing bootstrap receipt and all profiles/services stay intact. A partial stage is retained; do not delete or overwrite it.
- Declared operation need: 512 MiB plus the binding 512 MiB margin. Preflight must observe normal memory pressure and at least 1,073,741,824 available bytes from free+inactive+purgeable+speculative. Latest ordinary preflight measured 2,620,866,560 available bytes, normal pressure.

Run the following as the already-root caller, without changing their arguments. The first command is read-only; inspect its `bootstrap.resource-admission` measurement before the staging command. Overall doctor may remain NOT_IMPLEMENTED because other R0 gates are pending.

```sh
/Users/johansardar/.local/share/node/node-v24.21.0-darwin-arm64/bin/node /Users/johansardar/Documents/Codex/toy-harness/cli/dist/main.js doctor --deep --json
/Users/johansardar/.local/share/node/node-v24.21.0-darwin-arm64/bin/node /Users/johansardar/Documents/Codex/toy-harness/scripts/stage-siwc-control-runtime.mts stage ae742735-1693-4322-81f9-8767c0074179 927562c37b764041c752a6a8d71168aedef088599d1a077ecac0b2228d7e2f71
/Users/johansardar/.local/share/node/node-v24.21.0-darwin-arm64/bin/node /Users/johansardar/Documents/Codex/toy-harness/scripts/stage-siwc-control-runtime.mts verify ae742735-1693-4322-81f9-8767c0074179 927562c37b764041c752a6a8d71168aedef088599d1a077ecac0b2228d7e2f71
```

Expected result: stage and verify exit0 with report states `staged` and `verified`, same artifact/file count/bytes, callerUid0, controlUid/Gid310, ownershipVerified=true, relocationVerified=true, preservedPartialStage=false, currentPointerChanged=false, servicesActivated=false, keychainCalled=false, liveProviderSends0 and acceptanceComplete=false. Final path: `/Library/Application Support/Toy/control/releases/927562c37b764041c752a6a8d71168aedef088599d1a077ecac0b2228d7e2f71`. Original bootstrap receipt SHA256 must remain `980a7bbd94f61e8a5e4d0bec1860555091e7aa303b7981df4392a6f5ee49fe65`.

Verification: the fixed verify command walks every manifest entry, rejects extra files/links, checks root ownership and control GID/read-only modes, hashes every file, tests pinned Node and isolated Python/ctypes at the final immutable path, and independently rereads the original bootstrap receipt. Staging proves no live service or whole AT; the parent control directory remains root-only until a separately prepared installation step.

Claude result (2026-10-06 ~11:05 CDT): **DONE**.
- Preflight `doctor --deep --json` (root): `bootstrap.resource-admission` = PASS / MEMORY_ADMITTED, normal pressure. Overall doctor exit 5, expected while other R0 gates are pending.
- `stage`: exit 0. Report: `{"state": "staged", "fileCount": 2613, "bytes": "201748037", "callerUid": 0, "controlUid": 310, "controlGid": 310, "ownershipVerified": true, "relocationVerified": true, "preservedPartialStage": false, "currentPointerChanged": false, "servicesActivated": false, "keychainCalled": false, "liveProviderSends": 0, "acceptanceComplete": false, "bootstrapReceiptDigest": "980a7bbd94f61e8a5e4d0bec1860555091e7aa303b7981df4392a6f5ee49fe65", "finalPath": "/Library/Application Support/Toy/control/releases/927562c37b764041c752a6a8d71168aedef088599d1a077ecac0b2228d7e2f71"}`
- `verify`: exit 0. Report: `{"state": "verified", "fileCount": 2613, "bytes": "201748037", "callerUid": 0, "controlUid": 310, "controlGid": 310, "ownershipVerified": true, "relocationVerified": true, "preservedPartialStage": false, "currentPointerChanged": false, "servicesActivated": false, "keychainCalled": false, "liveProviderSends": 0, "acceptanceComplete": false, "bootstrapReceiptDigest": "980a7bbd94f61e8a5e4d0bec1860555091e7aa303b7981df4392a6f5ee49fe65", "finalPath": "/Library/Application Support/Toy/control/releases/927562c37b764041c752a6a8d71168aedef088599d1a077ecac0b2228d7e2f71"}`
- Matches the expected result: same file count and bytes, callerUid 0, control UID/GID 310, no current-pointer change, no services, no Keychain, 0 live sends, and the bootstrap receipt digest unchanged (980a7bbd…fe65).
