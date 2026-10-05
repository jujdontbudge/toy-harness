const { readFileSync } = require("node:fs");
const graph = JSON.parse(readFileSync("architecture/modules.json", "utf8"));
const forbidden = [
  { name: "no-unresolved", severity: "error", from: {}, to: { couldNotResolve: true } },
  { name: "no-cycles", severity: "error", from: {}, to: { circular: true } },
  { name: "protected-controls", severity: "error", from: { path: "^(packages|cli|plugins|tests)/" }, to: { path: "^control/" } },
  { name: "contracts-no-owners", severity: "error", from: { path: "^packages/contracts/" }, to: { path: "^(packages/(?!contracts/)|cli/|control/)" } },
  { name: "cli-public-only", severity: "error", from: { path: "^cli/" }, to: { path: "^packages/(?!contracts/|(?:ops|self-improvement)/src/public\\.ts$)" } },
  ...graph.modules.filter((item) => item.id !== "contracts").flatMap((item) => [
    { name: `${item.id}-public-boundaries`, severity: "error", from: { path: `^packages/${item.id}/` }, to: { path: "^packages/", pathNot: `^packages/(?:${item.id}/|contracts/|(?:${item.dependencies.filter((id) => id !== "contracts").join("|") || "(?!)"})/src/public\\.ts$)` } }
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
