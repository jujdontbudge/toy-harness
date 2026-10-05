import { readFile, readdir } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const sourceRoots = ["packages", "cli", "plugins/toy", "behavior", "scripts", "tests"];
const selected = process.argv.slice(2).map((path) => resolve(root, path));
const walk = async (path) => {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const children = await Promise.all(entries.map(async (entry) => {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) return ["dist", "node_modules", ".venv", ".git", "build"].includes(entry.name) ? [] : await walk(child);
    return [".ts", ".tsx", ".mts", ".cts"].includes(extname(entry.name)) ? [child] : [];
  }));
  return children.flat();
};
const files = selected.length > 0
  ? selected
  : (await Promise.all(sourceRoots.map((path) => walk(resolve(root, path)))).then((items) => items.flat()));
const ownerPath = resolve(root, "packages/contracts/src/public.ts");
const generatedPath = resolve(root, "packages/contracts/generated/types.ts");
const ownerSource = await readFile(ownerPath, "utf8");
const ownerFile = ts.createSourceFile(ownerPath, ownerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let inventory;
for (const statement of ownerFile.statements) {
  if (!ts.isVariableStatement(statement)) continue;
  for (const declaration of statement.declarationList.declarations) {
    if (ts.isIdentifier(declaration.name) && declaration.name.text === "schemaInventory" && declaration.initializer && ts.isObjectLiteralExpression(declaration.initializer)) {
      inventory = declaration.initializer;
    }
  }
}
if (!inventory) throw new Error("packages/contracts/src/public.ts must export schemaInventory");
const compilerOptions = {
  strict: true,
  noUncheckedIndexedAccess: true,
  target: ts.ScriptTarget.ES2024,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  types: ["node"],
  skipLibCheck: false
};
const program = ts.createProgram({ rootNames: [...files, ownerPath, generatedPath], options: compilerOptions });
const checker = program.getTypeChecker();
const programOwner = program.getSourceFile(ownerPath);
const ownerSymbol = programOwner ? checker.getSymbolAtLocation(programOwner) : undefined;
const inventorySymbol = ownerSymbol ? checker.getExportsOfModule(ownerSymbol).find((symbol) => symbol.getName() === "schemaInventory") : undefined;
if (!programOwner || !inventorySymbol) throw new Error("The public contracts module must export a statically named schemaInventory");
const schemaNames = checker.getPropertiesOfType(checker.getTypeOfSymbolAtLocation(inventorySymbol, programOwner)).map((symbol) => symbol.getName());
if (schemaNames.length === 0 || new Set(schemaNames).size !== schemaNames.length) throw new Error("schemaInventory must have unique statically named schema properties");
const generatedSource = program.getSourceFile(generatedPath);
if (!generatedSource) throw new Error("Generated contract TypeScript is missing; run npm run contracts:generate");
const generatedAliases = new Map();
for (const statement of generatedSource.statements) {
  if (ts.isTypeAliasDeclaration(statement)) generatedAliases.set(statement.name.text, checker.getTypeFromTypeNode(statement.type));
}
const shapeKey = (type, depth = 0, seen = new Set()) => {
  if (depth > 24) return "recursive";
  if (type.flags & ts.TypeFlags.StringLiteral) return `string-literal:${JSON.stringify(type.value)}`;
  if (type.flags & ts.TypeFlags.NumberLiteral) return `number-literal:${type.value}`;
  if (type.flags & ts.TypeFlags.BooleanLiteral) return `boolean-literal:${type.intrinsicName}`;
  if (type.flags & ts.TypeFlags.String) return "primitive:string";
  if (type.flags & ts.TypeFlags.Number) return "primitive:number";
  if (type.flags & ts.TypeFlags.Boolean) return "primitive:boolean";
  if (type.flags & ts.TypeFlags.Null) return "primitive:null";
  if (type.flags & ts.TypeFlags.Undefined) return "primitive:undefined";
  if (type.flags & ts.TypeFlags.Any) return "primitive:any";
  if (type.flags & ts.TypeFlags.Unknown) return "primitive:unknown";
  if (type.flags & ts.TypeFlags.Never) return "primitive:never";
  if (type.isUnion()) return `union:${type.types.map((member) => shapeKey(member, depth + 1, seen)).sort().join("|")}`;
  if (type.isIntersection()) return `intersection:${type.types.map((member) => shapeKey(member, depth + 1, seen)).sort().join("&")}`;
  if (checker.isArrayType(type)) {
    const element = checker.getTypeArguments(type)[0];
    return `array:${element ? shapeKey(element, depth + 1, seen) : "unknown"}`;
  }
  const identity = type.getSymbol()?.getName();
  if (identity && seen.has(type)) return `recursive:${identity}`;
  const nextSeen = new Set(seen);
  if (identity) nextSeen.add(type);
  const properties = checker.getPropertiesOfType(type).map((property) => {
    const location = property.valueDeclaration ?? property.declarations?.[0] ?? ownerFile;
    const propertyType = checker.getTypeOfSymbolAtLocation(property, location);
    const optional = (property.flags & ts.SymbolFlags.Optional) !== 0;
    return `${property.getName()}${optional ? "?" : ""}:${shapeKey(propertyType, depth + 1, nextSeen)}`;
  }).sort();
  return properties.length > 0 ? `object:{${properties.join(",")}}` : `object:${identity ?? "anonymous"}`;
};
const contractShapes = new Map();
for (const name of schemaNames) {
  const type = generatedAliases.get(name);
  if (!type) throw new Error(`Generated contract TypeScript is missing schema type ${name}`);
  const shape = shapeKey(type);
  if (!shape.startsWith("primitive:")) {
    const owners = contractShapes.get(shape) ?? [];
    owners.push(name);
    contractShapes.set(shape, owners);
  }
}
const exported = (node) => node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
const objectLike = (node) => {
  if (ts.isTypeLiteralNode(node)) return true;
  if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) return node.types.some(objectLike);
  return false;
};
const failures = [];

for (const path of files) {
  const relativePath = relative(root, path).replaceAll("\\", "/");
  if (relativePath.startsWith("packages/contracts/src/") || relativePath.startsWith("packages/contracts/generated/")) continue;
  const source = await readFile(path, "utf8");
  const file = program.getSourceFile(path) ?? ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const visit = (node) => {
    const declaration = ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node);
    if (declaration) {
      const name = node.name.text;
      if (schemaNames.includes(name)) failures.push(`${relativePath}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}: copied contract declaration ${name}`);
      if (ts.isInterfaceDeclaration(node) && exported(node)) failures.push(`${relativePath}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}: exported wire DTOs must come from @toy/contracts`);
      if (ts.isTypeAliasDeclaration(node) && exported(node) && objectLike(node.type)) failures.push(`${relativePath}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}: exported wire DTOs must come from @toy/contracts`);
      const type = ts.isInterfaceDeclaration(node) ? checker.getTypeAtLocation(node) : checker.getTypeFromTypeNode(node.type);
      const shape = shapeKey(type);
      const owners = contractShapes.get(shape);
      if (owners) failures.push(`${relativePath}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}: structural copy of generated contract ${owners.join(", ")}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${files.length} TypeScript source files passed schema-inventory ownership policy for ${schemaNames.length} contracts\n`);
}
