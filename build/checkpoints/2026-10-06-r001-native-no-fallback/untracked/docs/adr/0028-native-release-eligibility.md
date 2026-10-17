# ADR 0028: No-spend native release eligibility policy

Status: provisional Ops owner policy and registered CLI fixture source for R0.08. The R0.02 prerequisite remains pending, so this proposal does not complete R0.08 or any assigned acceptance test.

R0.08 records the signing, licence, OS and hardware inventory without buying or changing anything. The policy is a pure Ops owner function over the generated inventory contract. It does not inspect an Apple account, Keychain, device, OS, licence store or network, and it does not perform installation, signing, provisioning or purchase actions.

The proposed public interface is:

```text
NativeReleaseEligibilityPolicy.evaluate(
  input: NativeReleaseEligibilityInputV1
): NativeReleaseEligibilityDecisionV1
```

The canonical generated contracts are `NativeReleaseEligibilityInputV1`, `NativeReleaseEligibilityDecisionV1`, `NativeReleasePrerequisiteIdV1`, and `NativeReleaseCapabilityDispositionV1`, with `nativeReleaseEligibilityInputSchema` and `nativeReleaseEligibilityDecisionSchema`. The input represents separate assessments for OS/hardware, Apple Developer membership, distribution signing, app and extension entitlements, Family Controls entitlements and permission, Cold Turkey Pro ownership, and the Porcupine licence and model. Each assessment carries its own evidence state, check time and canonical evidence links. A `verified` label without evidence links, or a check time later than the inventory's `observedAt`, is treated as unverified. The policy does not accept a generic readiness boolean as a substitute for those separate facts.

The decision reports a disposition for `nativeApp`, `shareExtension`, `pushNotifications`, `alarmKit`, `familyControls`, `appBlocking`, and `wakeWord`, plus the selected zero-spend delivery branch. Unknown, absent or unverified Apple membership, signing, OS/hardware, required entitlements, or Cold Turkey Pro defer the native app, share, push, alarm and Family Controls capabilities. Family Controls additionally requires its separately assessed permission. Membership alone does not establish signing or entitlement eligibility. The shared Cold Turkey Pro prerequisite is the conservative R3 release gate from AT-ops-81: absence of either Apple membership or Pro keeps R3 on web/PWA plus Discord with native capabilities deferred. Missing or unverified Cold Turkey Pro also keeps R4 app blocking gated. Missing or unverified Porcupine licence/model evidence defers wake-word setup. Verified prerequisite inventory may make a component eligible for testing; this decision is not a signing, release, device-permission or production-readiness proof. `liveActivationAdmitted` remains false.

The default branch is web PWA plus Discord. `purchaseAssumed` and `weeklyFreeProvisioningCounted` remain false. Selecting that branch does not claim fresh runtime evidence for either channel. The policy cannot create inventory evidence from source/history readiness, older release records or this decision's own output; actual eligibility evidence remains separate and must be collected by its owning inventory flow.

The conservative licence coupling follows the assigned assertion in planning `specs/ops.md` AT-ops-81 and its R0 inventory instruction at line 2054. The narrower descriptions in `specs/client-apps.md` and `specs/activity-focus.md` separate Apple prerequisites for R3 from Cold Turkey Pro for R4 app blocking. The local implementation satisfies the explicit assigned Ops assertion; it does not rewrite those planning sources or establish that the unrelated licences are technically required by Apple. Clarifying that future native release scope belongs to the planning owner before R3 activation.

The assigned CLI fixture may prove the unknown/absent and no-spend policy branch at the R0.08 CLI rung. It cannot complete AT-activity-focus-64, AT-client-apps-49 or AT-ops-81 without the real account, device and prerequisite evidence those cases require. No native compilation is part of this work; native implementation remains deferred to R3.

`NativeReleaseEligibilityProbe.run` is reached through the existing `toy probe run/show` commands with the fixed `native-release-eligibility` case and only AT-ops-81, AT-client-apps-49 or AT-activity-focus-64. It requires an owned ready fake-clock/fake-model R0 world. Fixed external prerequisite projections exercise unknown and absent inventory, membership without other proofs, empty and future evidence, separate Family Controls permission and complete synthetic testing evidence. Receipts label their fixture origin and retain whole-AT completion as false. No live inventory or activation follows from a fixture decision.
