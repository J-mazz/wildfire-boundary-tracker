#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { transformSync } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const maximumComplexity = 10;
const landingRoot = path.join(root, 'src/ts/landing');

function sourceFiles(directory, extension) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target, extension);
    return entry.name.endsWith(extension) ? [target] : [];
  });
}

function childNodes(node) {
  return Object.values(node).flatMap((value) => {
    if (Array.isArray(value)) return value.filter((entry) => entry?.type);
    return value?.type ? [value] : [];
  });
}

function isFunction(node) {
  return [
    'FunctionDeclaration',
    'FunctionExpression',
    'ArrowFunctionExpression'
  ].includes(node.type);
}

function nodeName(node, parent) {
  if (node.id?.name) return node.id.name;
  if (parent?.type === 'VariableDeclarator') return parent.id.name;
  if (parent?.type === 'Property' || parent?.type === 'MethodDefinition') {
    return parent.key.name ?? parent.key.value;
  }
  return `<anonymous:${node.loc.start.line}>`;
}

function decisionValue(node) {
  if ([
    'IfStatement',
    'ForStatement',
    'ForInStatement',
    'ForOfStatement',
    'WhileStatement',
    'DoWhileStatement',
    'CatchClause',
    'ConditionalExpression'
  ].includes(node.type)) return 1;
  if (node.type === 'SwitchCase' && node.test !== null) return 1;
  if (node.type === 'LogicalExpression') return 1;
  return 0;
}

function complexity(functionNode) {
  let decisions = 0;
  function visit(node) {
    if (node !== functionNode && isFunction(node)) return;
    decisions += decisionValue(node);
    for (const child of childNodes(node)) visit(child);
  }
  visit(functionNode.body);
  return 1 + decisions;
}

function javaScriptMeasurements(file, loader) {
  const source = fs.readFileSync(file, 'utf8');
  const transformed = transformSync(source, { loader, target: 'es2022', format: 'esm' });
  const tree = parse(transformed.code, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: true
  });
  const measurements = [];
  function visit(node, parent = null) {
    if (isFunction(node)) {
      measurements.push({
        file: path.relative(root, file),
        function: nodeName(node, parent),
        cyclomaticComplexity: complexity(node)
      });
    }
    for (const child of childNodes(node)) visit(child, node);
  }
  visit(tree);
  return measurements;
}

function typeScriptMeasurements() {
  const landing = sourceFiles(landingRoot, '.ts').flatMap(
    (file) => javaScriptMeasurements(file, 'ts')
  );
  const checker = javaScriptMeasurements(
    path.join(root, 'tools/check_source_complexity.mjs'),
    'js'
  );
  return [...landing, ...checker];
}

function pythonMeasurements() {
  const files = sourceFiles(path.join(root, 'tools'), '.py');
  const result = spawnSync(
    process.env.PYTHON ?? 'python3',
    [path.join(root, 'tools/check_python_complexity.py'), ...files],
    { cwd: root, encoding: 'utf8' }
  );
  if (result.error) throw result.error;
  if (result.status !== 0 && result.stdout.length === 0) {
    throw new Error(result.stderr || 'Python complexity measurement failed');
  }
  return JSON.parse(result.stdout);
}

const tsMeasurements = typeScriptMeasurements();
const python = pythonMeasurements();
const failures = tsMeasurements.filter(
  (measurement) => measurement.cyclomaticComplexity > maximumComplexity
);
const maximumObserved = Math.max(
  0,
  python.maximumObserved,
  ...tsMeasurements.map((measurement) => measurement.cyclomaticComplexity)
);
const report = {
  schemaVersion: 1,
  maximumComplexity,
  functionsMeasured: tsMeasurements.length + python.functionsMeasured,
  maximumObserved,
  failures: [...failures, ...python.failures]
};
console.log(JSON.stringify(report, null, 2));
if (report.failures.length !== 0) process.exit(1);
