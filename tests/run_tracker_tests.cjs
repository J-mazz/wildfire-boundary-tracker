const { spawnSync } = require('node:child_process');
const path = require('node:path');
const process = require('node:process');

const root = path.resolve(__dirname, '..');
const suites = [
  'tests/run_deployment_contract_tests.cjs',
  'tests/run_worker_wasm_abi_tests.cjs',
  'tests/run_ts_contract_tests.cjs'
];

for (const suite of suites) {
  const result = spawnSync(process.execPath, [suite], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
