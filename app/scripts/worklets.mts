// addModule loads a worklet by URL, so each ships as one plain JS file; WXT's public/ copies it uncompiled.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from '@typescript/typescript6';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const WORKLETS = {
  'audio/meter-worklet.js': 'worklets/meter-worklet.mts',
  'audio/overlap-worklet.js': 'worklets/overlap-worklet.mts',
} as const;
export type WorkletPath = keyof typeof WORKLETS;

interface Module {
  file: string;
  body: string;
  imports: string[];
}

function fail(file: string, problem: string): never {
  throw new Error(`${path.relative(APP, file)}: ${problem}`);
}

// no renaming imports: every file ends up in one shared scope
function importedFile(file: string, decl: ts.ImportDeclaration): string {
  const spec = (decl.moduleSpecifier as ts.StringLiteral).text;
  if (!spec.startsWith('./')) fail(file, `imports only files in its own directory or below (${spec})`);
  const clause = decl.importClause;
  const named = clause?.namedBindings;
  const plain = clause && !clause.name && named && ts.isNamedImports(named);
  if (!plain || named.elements.some((e) => e.propertyName)) fail(file, `imports names without renaming (${spec})`);

  return path.resolve(path.dirname(file), spec);
}

const modifier = (st: ts.Statement, kind: ts.SyntaxKind): ts.Modifier | undefined =>
  ts.canHaveModifiers(st) ? ts.getModifiers(st)?.find((m) => m.kind === kind) : undefined;

function readModule(file: string): Module {
  const text = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const imports: string[] = [];
  const cuts: [number, number][] = [];

  for (const st of source.statements) {
    if (ts.isImportDeclaration(st)) {
      imports.push(importedFile(file, st));
      cuts.push([st.getStart(), st.getEnd()]);
    } else if (ts.isExportDeclaration(st) || ts.isExportAssignment(st)) {
      fail(file, 'exports declarations only (no export lists or defaults)');
    } else {
      const keyword = modifier(st, ts.SyntaxKind.ExportKeyword);
      if (keyword) cuts.push([keyword.getStart(), keyword.getEnd()]);
    }
  }

  let body = text;
  for (const [from, to] of cuts.reverse()) body = body.slice(0, from) + body.slice(to).trimStart();

  return { file, body, imports };
}

function modulesInOrder(entry: string): Module[] {
  const done = new Map<string, Module>();
  const open = new Set<string>();

  const visit = (file: string): void => {
    if (done.has(file)) return;
    if (open.has(file)) fail(file, 'is part of an import cycle');
    open.add(file);
    const mod = readModule(file);
    for (const dep of mod.imports) visit(dep);
    open.delete(file);
    done.set(file, mod);
  };

  visit(entry);

  return [...done.values()];
}

function runtimeNames(mod: Module): string[] {
  const source = ts.createSourceFile(mod.file, mod.body, ts.ScriptTarget.ES2022, true);
  const names: string[] = [];

  for (const st of source.statements) {
    if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) names.push(st.name.text);
    if (!ts.isVariableStatement(st) || modifier(st, ts.SyntaxKind.DeclareKeyword)) continue;
    for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) names.push(d.name.text);
  }

  return names;
}

function bundledSource(entry: string): string {
  const modules = modulesInOrder(entry);
  const declaredIn = new Map<string, string>();

  for (const mod of modules) {
    for (const name of runtimeNames(mod)) {
      const other = declaredIn.get(name);
      if (other) fail(mod.file, `declares ${name}, as ${path.relative(APP, other)} does`);
      declaredIn.set(name, mod.file);
    }
  }

  return modules.map((m) => m.body).join('\n');
}

export function workletJs(out: WorkletPath): string {
  const src = bundledSource(path.join(APP, WORKLETS[out]));
  const js = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.Preserve },
  }).outputText;

  // the tests run it as a classic script in node:vm
  return js.replace(/^export \{\};\n/m, '');
}
