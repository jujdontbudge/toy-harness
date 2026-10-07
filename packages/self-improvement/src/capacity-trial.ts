import type { CapacityTrialJournalApi, CheckViewV1, OpsControlContextV1, Result } from "@toy/contracts";
import { DurableCadenceOwner } from "./durable-cadence.js";

export const CapacityTrialJournal = {
  withTest<Data>(context: OpsControlContextV1, run: (owner: CapacityTrialJournalApi) => Result<Data> | Promise<Result<Data>>, diagnostic?: (check: CheckViewV1) => void): Promise<Result<Data>> {
    return DurableCadenceOwner.withTest(context, owner => run(owner), diagnostic);
  }
};
