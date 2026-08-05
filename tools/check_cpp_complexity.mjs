#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const maximumComplexity = 10;
const roots = ['src/cpp/modules', 'src/native/modules', 'tests/cpp', 'benchmarks/cpp'];
const characterizedDomainFiles = [
  'src/cpp/firms_engine.cpp',
  'src/cpp/geosplat.cppm',
  'src/cpp/geosplat.cpp',
  'src/native/ncnn_vulkan_batch.cpp'
];
const baseline = JSON.parse(fs.readFileSync(
  path.join(root, 'benchmarks/cpp_complexity_baseline.json'),
  'utf8'
));

function cppFiles(directory) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:cpp|cppm|hpp)$/.test(entry.name))
    .map((entry) => path.join(directory, entry.name));
}

function withoutCommentsAndLiterals(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

function closingBrace(source, opening) {
  let depth = 1;
  for (let index = opening + 1; index < source.length; ++index) {
    if (source[index] === '{') ++depth;
    if (source[index] === '}' && --depth === 0) return index;
  }
  return -1;
}

function functions(source) {
  const cleaned = withoutCommentsAndLiterals(source);
  const pattern = /(?:^|\n)\s*[\w:<>,*&\s~]+\s+([~\w:]+)\s*\([^;{}]*\)\s*(?:const\s*)?(?:noexcept\s*)?(?:override\s*)?(?::[^{]+)?\{/g;
  const found = [];
  for (const match of cleaned.matchAll(pattern)) {
    const opening = match.index + match[0].lastIndexOf('{');
    const closing = closingBrace(cleaned, opening);
    if (closing < 0) throw new Error(`Unbalanced function body for ${match[1]}`);
    found.push({ name: match[1], body: cleaned.slice(opening + 1, closing) });
  }
  return found;
}

function complexity(body) {
  const decisions = body.match(/\bif\b|\bfor\b|\bwhile\b|\bcase\b|\bcatch\b|&&|\|\||\?(?!:)/g);
  return 1 + (decisions?.length ?? 0);
}

const measurements = [];
for (const file of [...roots.flatMap(cppFiles), ...characterizedDomainFiles]) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  for (const functionDefinition of functions(source)) {
    measurements.push({
      file,
      function: functionDefinition.name,
      cyclomaticComplexity: complexity(functionDefinition.body)
    });
  }
}

const limitFor = (measurement) => baseline.exceptions[
  `${measurement.file}:${measurement.function}`
] ?? maximumComplexity;
const failures = measurements.filter((measurement) => (
  measurement.cyclomaticComplexity > limitFor(measurement)
));
console.log(JSON.stringify({
  schemaVersion: 1,
  maximumComplexity,
  functionsMeasured: measurements.length,
  maximumObserved: Math.max(...measurements.map((measurement) => measurement.cyclomaticComplexity)),
  failures
}, null, 2));
if (failures.length !== 0) process.exit(1);
