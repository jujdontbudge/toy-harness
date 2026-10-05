const { readFileSync } = require("node:fs");
const graph = JSON.parse(readFileSync("architecture/modules.json", "utf8"));
const publicEntry = "(?:src/public\\.ts|dist/public\\.d\\.ts)$";
const publicModules = (ids) => ids.map((id) => `${id}/${publicEntry}`).join("|") || "(?!)";
const forbidden = [
  { name: "no-unresolved", severity: "error", from: {}, to: { couldNotResolve: true } },
  { name: "no-cycles", severity: "error", from: {}, to: { circular: true } },
  { name: "protected-controls", severity: "error", from: { path: "^(packages|cli|plugins|tests)/" }, to: { path: "^control/" } },
  { name: "contracts-no-owners", severity: "error", from: { path: "^packages/contracts/" }, to: { path: "^(packages/(?!contracts/)|cli/|control/)" } },
  { name: "cli-public-only", severity: "error", from: { path: "^cli/" }, to: { path: `^packages/(?!${publicModules(graph.cliDependencies)})` } },
  { name: "tests-public-only", severity: "error", from: { path: "^tests/" }, to: { path: `^packages/(?!${publicModules(graph.modules.map((item) => item.id))})` } },
  ...graph.modules.filter((item) => item.id !== "contracts").flatMap((item) => [
    { name: `${item.id}-public-boundaries`, severity: "error", from: { path: `^packages/${item.id}/` }, to: { path: "^packages/", pathNot: `^packages/(?:${item.id}/|${publicModules(item.dependencies)})` } }
  ])
];
module.exports = {
  forbidden,
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    doNotFollow: { path: "node_modules" },
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["types", "import", "node", "default"] }
  }
};
