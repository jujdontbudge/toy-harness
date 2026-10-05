import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const planningRoot = "/Users/johansardar/Documents/Codex/personal-assistant-harness";
const hash = (text) => createHash("sha256").update(text).digest("hex");
const plan = await readFile(join(planningRoot, "specs/BUILD-PLAN.md"), "utf8");
const testPlan = await readFile(join(planningRoot, "specs/TEST-PLAN.md"), "utf8");
const cards = [];
for (const line of plan.split("\n")) {
  const match = line.match(/^\| (R[0-5]\.(?:K[1-4]a?|\d{2}))\b/);
  if (!match) continue;
  const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
  cards.push({ id: match[1], sourceRow: line, sourceRowHash: hash(line), result: cells[1], dependsOn: cells[2] });
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
  const source = await readFile(join(planningRoot, "specs", file), "utf8");
  const lines = source.split("\n");
  const definition = new RegExp(`^- \\*\\*${id.replaceAll("-", "\\-")}(?: |\\[|\\*)`);
  const indices = lines.flatMap((text, index) => definition.test(text) ? [index] : []);
  if (indices.length !== 1) throw new Error(`Missing or duplicate assertion: ${id}`);
  const index = indices[0];
  const assertion = lines[index];
  if (index + 1 !== Number(sourceLine)) staleReferences.push({ id, indexedLine: Number(sourceLine), actualLine: index + 1 });
  acceptance.push({ id, firstRelease: release, source: `specs/${file}`, sourceLine: index + 1, indexedSourceLine: Number(sourceLine), sourceAssertion: assertion, sourceAssertionHash: hash(assertion), sourceDigest: hash(source), rung, requiredEvidence: evidence, implementation: "NOT_IMPLEMENTED", verdict: "NOT_RUN" });
}
if (new Set(cards.map((card) => card.id)).size !== cards.length) throw new Error("Duplicate card");
if (new Set(acceptance.map((row) => row.id)).size !== acceptance.length) throw new Error("Duplicate AT");
if (cards.length < 70 || acceptance.length < 1400) throw new Error("Incomplete source index");
await mkdir("build", { recursive: true });
await mkdir("tests", { recursive: true });
await writeFile("build/cards.json", JSON.stringify({ sourceDigest: hash(plan), cards }, null, 2) + "\n");
await writeFile("tests/acceptance-index.json", JSON.stringify({ sourceDigest: hash(testPlan), acceptance }, null, 2) + "\n");
await writeFile("build/spec-index-drift.json", JSON.stringify({ sourceDigest: hash(testPlan), staleReferences }, null, 2) + "\n");
process.stdout.write(JSON.stringify({ cards: cards.length, acceptance: acceptance.length, staleLineReferences: staleReferences.length, releases: Object.fromEntries(["R0", "R1", "R2", "R3", "R4", "R5"].map((id) => [id, acceptance.filter((row) => row.firstRelease === id).length])) }) + "\n");
