import "pg-boss/dist/types.js";

declare module "pg-boss/dist/types.js" {
  interface ResolvedConstructorOptions extends ConstructorOptions {
    schema: string;
    clock: Clock;
    monitorIntervalSeconds: number;
    cronMonitorIntervalSeconds: number;
    maintenanceIntervalSeconds: number;
    bamIntervalSeconds: number;
    flowIntervalSeconds: number;
    reindexIntervalSeconds: number;
    registerInstance: boolean;
    instanceHeartbeatSeconds: number;
    noSkipLocked?: boolean;
    noMultiMutationCte?: boolean;
    noTablePartitioning?: boolean;
    noDeferrableConstraints?: boolean;
    noAdvisoryLocks?: boolean;
    noCoveringIndexes?: boolean;
    inlineTableIndexes?: boolean;
    noAddColumnBackfill?: boolean;
    noListenNotify?: boolean;
    noIndexProgressView?: boolean;
    noReindex?: boolean;
    noMonitorVacuum?: boolean;
    noTransactionalHeartbeat?: boolean;
  }
}
