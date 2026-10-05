import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const planningRoot = "/Users/johansardar/Documents/Codex/personal-assistant-harness";
const hash = (text) => createHash("sha256").update(text).digest("hex");
const plan = await readFile(join(planningRoot, "specs/BUILD-PLAN.md"), "utf8");
const testPlan = await readFile(join(planningRoot, "specs/TEST-PLAN.md"), "utf8");
const cliSpec = await readFile(join(planningRoot, "specs/cli.md"), "utf8");
const cards = [];
for (const line of plan.split("\n")) {
  const match = line.match(/^\| (R[0-5]\.(?:K[1-4]a?|\d{2}))\b/);
  if (!match) continue;
  const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
  cards.push({ id: match[1], sourceRow: line, sourceRowHash: hash(line), result: cells[1], dependsOn: cells[2] });
}
const cliCards = cliSpec.split("\n").flatMap((line) => {
  const match = line.match(/^\| (CLI-\d{2}[ab]?) \*\*\[(R[0-5])\]/);
  if (!match) return [];
  const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
  return [{ id: match[1], firstRelease: match[2], sourceRow: line, sourceRowHash: hash(line), result: cells[1], exitEvidence: cells[2] }];
});
const sourceDefinitions = new Map();
const specFiles = (await readdir(join(planningRoot, "specs"))).filter((file) => file.endsWith(".md") && !["BUILD-PLAN.md", "TEST-PLAN.md"].includes(file)).sort();
for (const file of specFiles) {
  const source = await readFile(join(planningRoot, "specs", file), "utf8");
  const lines = source.split("\n");
  for (const [index, assertion] of lines.entries()) {
    const match = assertion.match(/^- \*\*(AT-[A-Za-z-]+-\d+) \[(R[0-5])\]/);
    if (!match) continue;
    const id = match[1];
    if (sourceDefinitions.has(id)) throw new Error(`Duplicate source assertion: ${id}`);
    sourceDefinitions.set(id, { source: `specs/${file}`, sourceLine: index + 1, firstRelease: match[2], sourceAssertion: assertion, sourceAssertionHash: hash(assertion), sourceDigest: hash(source) });
  }
}
const acceptance = [];
const staleReferences = [];
let release = null;
for (const line of testPlan.split("\n")) {
  const releaseMatch = line.match(/^### (R[0-5]) AT index/);
  if (releaseMatch) release = releaseMatch[1];
  const match = line.match(/^\| `(AT-[^`]+)` \| \[([^\]]+)\]\(([^)]+)\), L(\d+) \| (SIM|CLI|MOD|INT) \| (.+) \|$/);
  if (!match || !release) continue;
  const [, id, , file, sourceLine, rung, evidence] = match;
  const definition = sourceDefinitions.get(id);
  if (!definition || definition.source !== `specs/${file}` || definition.firstRelease !== release) throw new Error(`Stale or missing source/rung binding: ${id}`);
  if (definition.sourceLine !== Number(sourceLine)) staleReferences.push({ id, indexedLine: Number(sourceLine), actualLine: definition.sourceLine });
  acceptance.push({ id, ...definition, indexedSourceLine: Number(sourceLine), rung, requiredEvidence: evidence });
}
if (new Set(cards.map((card) => card.id)).size !== cards.length) throw new Error("Duplicate card");
if (new Set(acceptance.map((row) => row.id)).size !== acceptance.length) throw new Error("Duplicate AT");
const indexedIds = new Set(acceptance.map((row) => row.id));
const unindexed = [...sourceDefinitions.keys()].filter((id) => !indexedIds.has(id));
if (unindexed.length) throw new Error(`Unindexed source assertions: ${unindexed.join(", ")}`);
const requiredATs = (card) => {
  const ids = new Set();
  for (const match of card.sourceRow.matchAll(/AT-([A-Za-z-]+)-(\d+)(?:[–-](\d+))?/g)) {
    const [, owner, start, end] = match;
    for (let number = Number(start); number <= Number(end ?? start); number++) ids.add(`AT-${owner}-${number}`);
  }
  const cumulative = [...card.sourceRow.matchAll(/R([0-5])\.ALL/g)];
  if (cumulative.length) {
    const lastRelease = Math.max(...cumulative.map((match) => Number(match[1])));
    for (const row of acceptance) if (Number(row.firstRelease[1]) <= lastRelease) ids.add(row.id);
  }
  if (card.id === "R4.06") for (const row of acceptance) if (row.firstRelease === "R4" && row.source === "specs/sources.md") ids.add(row.id);
  for (const id of ids) if (!indexedIds.has(id)) throw new Error(`Card ${card.id} has dangling AT: ${id}`);
  return [...ids].sort();
};
if (cards.length < 70 || acceptance.length < 1400) throw new Error("Incomplete source index");
await mkdir("build", { recursive: true });
await mkdir("tests", { recursive: true });
await writeFile("build/cards.json", JSON.stringify({ sourceDigest: hash(plan), cliSourceDigest: hash(cliSpec), cards: cards.map((card) => ({ ...card, requiredATs: requiredATs(card) })), cliCards: cliCards.map((card) => ({ ...card, requiredATs: requiredATs(card) })) }, null, 2) + "\n");
await writeFile("tests/acceptance-index.json", JSON.stringify({ sourceDigest: hash(testPlan), acceptance }, null, 2) + "\n");
await writeFile("build/spec-index-drift.json", JSON.stringify({ sourceDigest: hash(testPlan), staleReferences }, null, 2) + "\n");
process.stdout.write(JSON.stringify({ cards: cards.length, cliCards: cliCards.length, acceptance: acceptance.length, sourceAssertions: sourceDefinitions.size, staleLineReferences: staleReferences.length, releases: Object.fromEntries(["R0", "R1", "R2", "R3", "R4", "R5"].map((id) => [id, acceptance.filter((row) => row.firstRelease === id).length])) }) + "\n");
