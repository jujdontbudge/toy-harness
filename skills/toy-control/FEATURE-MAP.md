# Toy feature map

This bootstrap map describes implementation availability. It does not certify product behavior, live integration or deployment. K4 will validate the complete command/AT inventory and links; all later capabilities remain pending at their source-assigned rungs.

| Feature | Requirements | User/builder route | Owner | Implementation | CLI route | Proving acceptance |
|---|---|---|---|---|---|---|
| Kitchen public boundaries and strict compilation | 0.15, 0.16, 0.17 | Builder static gate | Self-Repair engineering infrastructure | [Graph](../../architecture/modules.json), [TS](../../tsconfig.base.json), [Python](../../pyrightconfig.json), [bootstrap receipts](../../build/evidence/R0.K1/foundations.json) | `probe run AT-hermes-config-101` (adapter due K3/K4) | AT-hermes-config-101: whole assertion pending K4 |
| Canonical contract primitives | 0.15, 2.1 | Public package imports | Contracts | [Schema owner](../../packages/contracts/src/public.ts) | Static/codegen gate (due K2–K4) | AT-hermes-config-101: pending; exact large-number cross-language proof due R0.10 |

Every product feature, new command and executable AT registration will be added with its owning public interface and evidence. The canonical source-index inventory is [acceptance-index.json](../../tests/acceptance-index.json). NOT_RUN and NOT_IMPLEMENTED entries are open work.
