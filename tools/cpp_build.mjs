#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'tools/cpp_build_manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const targetName = process.argv[2];
const target = manifest.targets[targetName];

if (!target) {
  const names = Object.keys(manifest.targets).join(', ');
  console.error(`Usage: node tools/cpp_build.mjs <target>\nTargets: ${names}`);
  process.exit(2);
}

const compiler = target.toolchain === 'emscripten'
  ? (process.env.EMCXX || 'em++')
  : (process.env.CLANGXX || 'clang++');
const hostStandardLibrary = target.toolchain === 'host'
  ? process.env.CXX_HOST_STDLIB
  : undefined;
if (hostStandardLibrary && !['libc++', 'libstdc++'].includes(hostStandardLibrary)) {
  throw new Error('CXX_HOST_STDLIB must be libc++ or libstdc++');
}
const standardLibraryFlags = hostStandardLibrary
  ? [`-stdlib=${hostStandardLibrary}`]
  : [];
const buildDirectory = path.join(root, 'build/cpp', targetName);
const moduleDirectory = path.join(buildDirectory, 'modules');
const objectDirectory = path.join(buildDirectory, 'objects');
const output = path.join(root, target.output);

const quote = (value) => /[\s"'\\]/.test(value) ? JSON.stringify(value) : value;

function resolveExecutable(command) {
  if (command.includes(path.sep)) return path.resolve(command);
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    const candidate = path.join(directory, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return fs.realpathSync(candidate);
    } catch {
      // Continue through PATH.
    }
  }
  throw new Error(`Unable to locate compiler executable ${command}`);
}

function compilerIncludeDirectories() {
  const result = spawnSync(compiler, [
    `-std=${manifest.standard}`,
    '-fmodules',
    ...standardLibraryFlags,
    ...target.compileFlags,
    '-E',
    '-x', 'c++',
    '-',
    '-v'
  ], {
    cwd: root,
    encoding: 'utf8',
    input: '',
    stdio: 'pipe'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`Unable to query include paths from ${compiler}`);
  }

  const directories = [];
  let collecting = false;
  for (const line of result.stderr.split(/\r?\n/)) {
    if (line.includes('#include <...> search starts here:')) {
      collecting = true;
      continue;
    }
    if (line.includes('End of search list.')) break;
    if (collecting) directories.push(line.trim().replace(/ \(framework directory\)$/, ''));
  }
  return directories.filter(Boolean);
}

function standardLibraryModule() {
  const executableDirectory = path.dirname(resolveExecutable(compiler));
  const compilerDirectories = compilerIncludeDirectories();
  const candidates = [{
    source: process.env.CXX_STDLIB_MODULE_SOURCE,
    includeDirectory: process.env.CXX_STDLIB_MODULE_INCLUDE
  }];
  for (const directory of compilerDirectories) {
    const resolvedDirectory = fs.existsSync(directory) ? fs.realpathSync(directory) : directory;
    const config = path.join(directory, '__config');
    const configuredDirectory = fs.existsSync(config)
      ? path.dirname(fs.realpathSync(config))
      : null;
    for (const searchDirectory of new Set(
      [directory, resolvedDirectory, configuredDirectory].filter(Boolean)
    )) {
      candidates.push(
        { source: path.join(searchDirectory, 'bits/std.cc') },
        { source: path.join(searchDirectory, 'std.cppm') },
        { source: path.resolve(searchDirectory, '../../../share/libc++/v1/std.cppm') }
      );
    }
  }
  candidates.push({
    source: path.resolve(
      executableDirectory,
      'system/lib/libcxx/modules/prebuilt/share/libc++/v1/std.cppm'
    ),
    includeDirectory: path.resolve(executableDirectory, 'system/lib/libcxx/modules')
  });
  candidates.push({ source: path.resolve(executableDirectory, '../share/libc++/v1/std.cppm') });
  const selected = candidates.find((candidate) => {
    if (!candidate.source || !fs.existsSync(candidate.source)) return false;
    if (!candidate.source.endsWith('std.cppm')) return true;
    const includeDirectory = candidate.includeDirectory ?? path.dirname(candidate.source);
    return fs.existsSync(path.join(includeDirectory, 'std/algorithm.inc'));
  });
  if (selected) {
    const moduleDirectory = selected.source.endsWith('std.cppm')
      ? (selected.includeDirectory ?? path.dirname(selected.source))
      : null;
    const relativeHeaderDirectory = path.resolve(
      path.dirname(selected.source),
      '../../../include/c++/v1'
    );
    const headerDirectory = compilerDirectories.find((directory) => (
      fs.existsSync(path.join(directory, '__config'))
    )) ?? (
      fs.existsSync(path.join(relativeHeaderDirectory, '__config'))
        ? relativeHeaderDirectory
        : null
    );
    const includeDirectories = [...new Set(
      [moduleDirectory, headerDirectory].filter(Boolean)
    )];
    return {
      source: selected.source,
      includeFlags: includeDirectories.flatMap((directory) => ['-I', directory])
    };
  }
  throw new Error(
    'Unable to locate the standard library module source; set CXX_STDLIB_MODULE_SOURCE'
  );
}

function run(command, args, options = {}) {
  console.log(`+ ${[command, ...args].map(quote).join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (options.capture) {
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
    }
    process.exit(result.status ?? 1);
  }
  return result.stdout?.trim() ?? '';
}

function pkgConfigFlags(packages, flag) {
  if (!packages?.length) return [];
  const outputText = run('pkg-config', [flag, ...packages], { capture: true });
  return outputText.length === 0 ? [] : outputText.split(/\s+/);
}

function orderedModules(names) {
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();

  function visit(name) {
    if (visited.has(name)) return;
    if (visiting.has(name)) throw new Error(`C++ module dependency cycle at ${name}`);
    const definition = manifest.modules[name];
    if (!definition) throw new Error(`Unknown C++ module ${name}`);
    visiting.add(name);
    for (const dependency of definition.imports) visit(dependency);
    visiting.delete(name);
    visited.add(name);
    ordered.push(name);
  }

  for (const name of names) visit(name);
  return ordered;
}

function objectName(source, suffix = '') {
  const relative = source.replaceAll(/[/.]/g, '_');
  return path.join(objectDirectory, `${relative}${suffix}.o`);
}

function compileModule(name, commonFlags, sourceFlags) {
  const definition = manifest.modules[name];
  const pcm = path.join(moduleDirectory, `${name}.pcm`);
  if (definition.kind === 'standard-library') {
    const standardLibrary = standardLibraryModule();
    run(compiler, [
      ...sourceFlags,
      ...standardLibrary.includeFlags,
      '-fno-implicit-module-maps',
      '-Wno-reserved-module-identifier',
      '-x', 'c++-module',
      '--precompile', standardLibrary.source,
      '-o', pcm
    ]);
    return [];
  }
  const interfaceObject = objectName(definition.interface, '.interface');
  run(compiler, [
    ...sourceFlags,
    '-x', 'c++-module',
    '--precompile', definition.interface,
    '-o', pcm
  ]);
  run(compiler, [
    ...commonFlags,
    '-c', pcm,
    '-o', interfaceObject
  ]);

  const objects = [interfaceObject];
  if (definition.implementation) {
    const implementationObject = objectName(definition.implementation, '.implementation');
    run(compiler, [
      ...sourceFlags,
      '-c', definition.implementation,
      '-o', implementationObject
    ]);
    objects.push(implementationObject);
  }
  return objects;
}

function compileSource(source, sourceFlags) {
  const object = objectName(source);
  run(compiler, [...sourceFlags, '-c', source, '-o', object]);
  return object;
}

function prepareDirectories() {
  fs.rmSync(buildDirectory, { recursive: true, force: true });
  if (target.cleanOutputDirectory) {
    fs.rmSync(path.dirname(output), { recursive: true, force: true });
  }
  fs.mkdirSync(moduleDirectory, { recursive: true });
  fs.mkdirSync(objectDirectory, { recursive: true });
  fs.mkdirSync(path.dirname(output), { recursive: true });
}

run(compiler, ['--version']);
prepareDirectories();

const includeFlags = target.includeDirectories.flatMap((directory) => ['-I', directory]);
const packageCompileFlags = pkgConfigFlags(target.pkgConfig, '--cflags');
const packageLinkFlags = pkgConfigFlags(target.pkgConfig, '--libs');
const deadSectionLinkFlag = target.toolchain === 'host' && process.platform === 'darwin'
  ? '-Wl,-dead_strip'
  : '-Wl,--gc-sections';
const commonFlags = [
  `-std=${manifest.standard}`,
  '-fmodules',
  '-ffunction-sections',
  '-fdata-sections',
...standardLibraryFlags,
  ...target.compileFlags,
  `-fprebuilt-module-path=${moduleDirectory}`
];
const sourceFlags = [
  ...commonFlags,
  ...includeFlags,
  ...packageCompileFlags
];

const objects = [];
for (const name of orderedModules(target.modules)) {
  objects.push(...compileModule(name, commonFlags, sourceFlags));
}
for (const source of target.sources) {
  objects.push(compileSource(source, sourceFlags));
}

const rpathFlags = [];
if (target.rpathEnvironment) {
  const base = process.env[target.rpathEnvironment];
  if (!base) throw new Error(`${target.rpathEnvironment} must be set for ${targetName}`);
  rpathFlags.push(`-Wl,-rpath,${path.join(base, 'lib64')}`);
}
run(compiler, [
  `-std=${manifest.standard}`,
  ...standardLibraryFlags,
  ...target.compileFlags,
  ...objects,
  deadSectionLinkFlag,
  ...target.linkFlags,
  ...packageLinkFlags,
  ...rpathFlags,
  '-o', output
]);

const size = fs.statSync(output).size;
console.log(`CPP_BUILD_METRIC ${JSON.stringify({
  target: targetName,
  output: target.output,
  binary_size_bytes: size
})}`);
