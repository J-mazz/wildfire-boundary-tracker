#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'build/benchmarks/cpp-current.json');
const benchmarks = [
  {
    target: 'host-firms-benchmark',
    executable: 'build/cpp/host-firms-benchmark/firms_benchmark',
    arguments: []
  },
  {
    target: 'host-firms-timeline-benchmark',
    executable: 'build/cpp/host-firms-timeline-benchmark/firms_timeline_benchmark',
    arguments: []
  },
  {
    target: 'host-geosplat-benchmark',
    executable: 'build/cpp/host-geosplat-benchmark/geosplat_benchmark',
    arguments: []
  }
];

function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout.trim().split('\n');
}

function parsePrefixed(lines, prefix) {
  const line = lines.findLast((candidate) => candidate.startsWith(prefix));
  if (!line) throw new Error(`Expected ${prefix.trim()} output`);
  return JSON.parse(line.slice(prefix.length));
}

const results = [];
for (const benchmark of benchmarks) {
  const buildLines = capture(process.execPath, ['tools/cpp_build.mjs', benchmark.target]);
  const buildMetric = parsePrefixed(buildLines, 'CPP_BUILD_METRIC ');
  const runLines = capture(path.join(root, benchmark.executable), benchmark.arguments);
  const measurement = JSON.parse(runLines.at(-1));
  results.push({ ...measurement, binary_size_bytes: buildMetric.binary_size_bytes });
}

const report = {
  schemaVersion: 1,
  benchmarks: results
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${path.relative(root, outputPath)}`);
