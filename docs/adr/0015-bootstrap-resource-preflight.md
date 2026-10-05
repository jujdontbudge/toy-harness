# ADR 0015: macOS memory admission

Status: implemented and verified through `toy doctor --deep`. Updated 2026-10-05 under Johan's binding correction and CONTRACTS.md row “Memory admission (Johan, 2026-10-05)”. The correction supersedes the original conservative free-page policy in this ADR and all older memory requirements.

Ops reads the fixed macOS `vm_stat` command and multiplies its free, inactive, purgeable and speculative page counts by the reported page size. Available bytes are the sum of those four categories. A fixed `sysctl -n kern.memorystatus_vm_pressure_level` read supplies normal, warning, critical or unknown pressure. Missing or malformed measurements fail admission. Both OS calls have bounded output, fixed arguments, a minimal environment and deadlines; raw output never reaches CLI receipts.

Memory admission requires normal pressure and available bytes at least the job's declared need plus 536,870,912 bytes. Strictly-free bytes are a reported component, never an admission threshold. Swap trend and a second physical-fit predicate do not add admission gates. The 1.5 GB floor belongs only to the future R5 repair worker. The current fake R0 test stack declares 1,073,741,824 bytes; the Luna helper declares 268,435,456 bytes. Builds and other helpers must use their own declared need.

The public `OpsControlRead.doctor` returns the generated version-two measurement with component bytes, job need, margin, threshold, pressure and admitted/blocked result. A memory PASS does not claim installed services, supported inference, actual service identities or sandbox execution. Doctor continues to report missing owners and overall incomplete coverage honestly. `resourcePermitIssued:false` means the diagnostic call issued no runtime capability; it does not revoke memory admission.

Verification uses the compiled packed CLI and fresh real `toy doctor --deep` readback. Private functions are not tested. Evidence is saved in `build/evidence/R0.K3/memory-admission-v2.json`. Older resource receipts are historical and cannot gate current work.
