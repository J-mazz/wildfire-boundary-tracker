#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tests = [
  ['host-core-memory-tests', 'build/cpp/host-core-memory-tests/core_memory_tests'],
  ['host-firms-tests', 'build/cpp/host-firms-tests/firms_engine_tests'],
  ['host-firms-timeline-tests', 'build/cpp/host-firms-timeline-tests/firms_timeline_tests'],
  ['host-geosplat-tests', 'build/cpp/host-geosplat-tests/geosplat_tests'],
  [
    'host-native-inference-tests',
    'build/cpp/host-native-inference-tests/native_inference_tests'
  ]
];

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const [target, executable] of tests) {
  run(process.execPath, ['tools/cpp_build.mjs', target]);
  run(path.join(root, executable), []);
}

console.log('C++ module, memory, FIRMS, geosplat, and native inference host tests passed.');
