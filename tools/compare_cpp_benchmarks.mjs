#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const [baselineArgument, candidateArgument, ...options] = process.argv.slice(2);
if (!baselineArgument || !candidateArgument) {
  console.error('Usage: node tools/compare_cpp_benchmarks.mjs BASELINE CANDIDATE [--enforce]');
  process.exit(2);
}

const readJson = (file) => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
const baseline = readJson(baselineArgument);
const candidate = readJson(candidateArgument);
const enforce = options.includes('--enforce');
let failures = 0;

function metricPassed(reference, measured, ratchet) {
  if (ratchet.direction === 'higher') {
    return measured >= reference * (1.0 - ratchet.toleranceRatio);
  }
  if (ratchet.direction === 'lower') {
    return measured <= reference * (1.0 + ratchet.toleranceRatio);
  }
  throw new Error(`Unknown ratchet direction: ${ratchet.direction}`);
}

for (const reference of baseline.benchmarks) {
  const measured = candidate.benchmarks.find(
    (entry) => entry.benchmark === reference.benchmark
  );
  if (!measured) {
    console.error(`FAIL ${reference.benchmark}: candidate result missing`);
    ++failures;
    continue;
  }
  for (const [metric, ratchet] of Object.entries(reference.ratchets)) {
    const passed = metricPassed(reference[metric], measured[metric], ratchet);
    const status = passed ? 'PASS' : (ratchet.gate ? 'FAIL' : 'WARN');
    console.log(
      `${status} ${reference.benchmark}.${metric}: `
      + `baseline=${reference[metric]} candidate=${measured[metric]} `
      + `direction=${ratchet.direction} tolerance=${ratchet.toleranceRatio}`
    );
    if (!passed && ratchet.gate) ++failures;
  }
}

if (enforce && failures !== 0) process.exit(1);
if (failures !== 0) {
  console.log(`${failures} gated regression(s) reported; rerun with --enforce to fail.`);
}
