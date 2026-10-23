#!/usr/bin/env node
'use strict';

// Single entry point for the extension's build and checks: clean, compile,
// typecheck, lint, bundle and the host suite, plus the package and watch
// stages. Plain CommonJS, Node built-ins only, no shell.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const resultsFile = path.join(root, 'test-results', 'host.json');

function resolveEntry(...segments) {
  return path.join(root, 'node_modules', ...segments);
}

function loadResults() {
  return require(path.join(root, 'out', 'test', 'harness', 'results.js'));
}

function run(entry, args, env) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: env ? { ...process.env, ...env } : process.env,
  });
  return result.status === 0;
}

function hostCanStart() {
  return fs.existsSync(path.join(root, 'out', 'test', 'harness', 'globalSetup.js'));
}

function collectTestSources(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectTestSources(full));
    } else if (entry.name.endsWith('.ts')) {
      found.push({ file: path.relative(root, full), text: fs.readFileSync(full, 'utf8') });
    }
  }
  return found;
}

// Prints the known-gap findings; returns false when any entry is malformed.
function validateKnownGaps(results, knownGaps) {
  const sources = collectTestSources(path.join(root, 'src', 'test'));
  const review = path.join(root, '..', 'docs', 'reviews', 'the-seed-vscode-1.md');
  const roadmap = path.join(root, '..', 'docs', 'roadmaps', 'the-seed-vscode-1.md');
  const parentDocs = fs.existsSync(review) && fs.existsSync(roadmap)
    ? { review: fs.readFileSync(review, 'utf8'), roadmap: fs.readFileSync(roadmap, 'utf8') }
    : undefined;
  const outcome = results.validateKnownGaps(knownGaps, sources, parentDocs);
  for (const line of outcome.notices) {
    console.log(line);
  }
  for (const line of outcome.violations) {
    console.log(line);
  }
  return outcome.violations.length === 0;
}

// What the guard compares: the real configuration file's checksum and the
// names and modification times directly inside the real configuration directory.
function recordRealHome() {
  const directory = path.join(os.homedir(), 'the-seed');
  const configFile = path.join(directory, 'config.json');
  const guard = { configHash: 'absent', entries: {} };
  if (fs.existsSync(configFile)) {
    guard.configHash = crypto.createHash('sha256').update(fs.readFileSync(configFile)).digest('hex');
  }
  if (fs.existsSync(directory)) {
    for (const name of fs.readdirSync(directory)) {
      guard.entries[name] = fs.lstatSync(path.join(directory, name)).mtimeMs;
    }
  }
  return guard;
}

function listScratchEntries() {
  return fs.readdirSync(os.tmpdir())
    .filter((name) => name.startsWith('the-seed-ext-'))
    .map((name) => path.join(os.tmpdir(), name));
}

function runHostOnce(hostOptions) {
  const results = loadResults();

  const knownGaps = require(path.join(root, 'out', 'test', 'harness', 'knownGaps.js')).KNOWN_GAPS;
  if (!validateKnownGaps(results, knownGaps)) {
    return false;
  }
  const realHomeBefore = recordRealHome();
  const leftoversBefore = listScratchEntries();

  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'the-seed-vscode-tests-'));
  try {
    const home = path.join(scratchRoot, 'home');
    fs.mkdirSync(path.join(home, '.config'), { recursive: true });

    fs.rmSync(resultsFile, { force: true });

    const env = {
      ...process.env,
      THE_SEED_TEST_HOME: home,
      THE_SEED_TEST_RESULTS: resultsFile,
    };
    // The installation of the tool the test editor is pointed at.
    env.THE_SEED_TEST_TOOL = process.env.THE_SEED_TEST_TOOL
      || path.join(root, 'node_modules', '@metaverse-systems', 'the-seed');
    delete env.THE_SEED_TEST_ONLY;
    delete env.THE_SEED_TEST_ORDER;
    if (hostOptions.only) {
      env.THE_SEED_TEST_ONLY = hostOptions.only;
    }
    if (hostOptions.reverse) {
      env.THE_SEED_TEST_ORDER = 'reverse';
    }

    const entry = resolveEntry('@vscode/test-cli', 'out', 'bin.mjs');
    let command = process.execPath;
    let args = [entry];
    let childEnv = env;
    if (process.platform === 'linux' && process.env.THE_SEED_TEST_VISIBLE !== '1') {
      // Always use a virtual display, even when a desktop session exists:
      // clients can reach a Wayland socket without WAYLAND_DISPLAY set.
      const probe = spawnSync('xvfb-run', ['--help'], { stdio: 'ignore' });
      if (!probe.error) {
        args = ['-a', process.execPath, entry];
        command = 'xvfb-run';
        childEnv = { ...env, ELECTRON_OZONE_PLATFORM_HINT: 'x11' };
        delete childEnv.WAYLAND_DISPLAY;
        delete childEnv.DISPLAY;
      } else if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
        console.log('no display: install xvfb (xvfb-run) or set DISPLAY');
        return false;
      } else {
        console.log('NOTICE: xvfb-run is not installed; the editor will be visible on your display');
      }
    }
    spawnSync(command, args, { cwd: root, stdio: 'inherit', env: childEnv });

    let ok = true;
    if (!fs.existsSync(resultsFile)) {
      console.log('RESULTS MISSING: the host suite did not finish (see the output above)');
      return false;
    }
    const recorded = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
    const outcome = results.classifyResults(recorded, knownGaps);
    for (const line of outcome.failures) {
      console.log(line);
    }
    const scratchConfig = path.join(home, 'the-seed');
    const extra = [
      ...results.compareLeftovers(leftoversBefore, listScratchEntries(), fs.existsSync(scratchConfig) ? scratchConfig : null),
      ...results.compareRealHome(realHomeBefore, recordRealHome()),
    ];
    for (const line of extra) {
      console.log(line);
    }
    ok = outcome.passed && extra.length === 0;
    for (const line of outcome.notices) {
      console.log(line);
    }
    console.log(results.totalsLine(recorded));
    return ok;
  } finally {
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  }
}

function runHost(hostOptions) {
  if (!hostCanStart()) {
    console.log('host: compile first ("npm run compile")');
    return false;
  }
  if (!fs.existsSync(bundlePath)) {
    console.log('host: bundle first ("npm run bundle")');
    return false;
  }
  for (let attempt = 1; attempt <= hostOptions.repeat; attempt++) {
    if (hostOptions.repeat > 1) {
      console.log(`-- host run ${attempt} of ${hostOptions.repeat} --`);
    }
    if (!runHostOnce(hostOptions)) {
      return false;
    }
  }
  return true;
}

// Removes the build outputs. Never touches node_modules/, .vscode-test/,
// test-results/ or packages in the root.
function clean() {
  for (const name of ['out', 'dist']) {
    fs.rmSync(path.join(root, name), { recursive: true, force: true });
  }
  return true;
}

const bundlePath = path.join(root, 'dist', 'extension.js');

// Host source modules, as bundle keys: every .ts under src/ outside src/test/
// and src/webview/, without declaration files; relative to src/, forward
// slashes, no extension, sorted.
function listHostModules() {
  const sourceRoot = path.join(root, 'src');
  const keys = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(sourceRoot, full).split(path.sep).join('/');
      if (relative === 'test' || relative === 'webview') {
        continue;
      }
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        keys.push(relative.slice(0, -'.ts'.length));
      }
    }
  };
  walk(sourceRoot);
  return keys.sort();
}

// The esbuild options shared by the bundle and watch stages. The entry
// re-exports activate and deactivate and maps every host module to its
// namespace (bundledModules), which the tests use to run against the bundle.
function hostBundleOptions() {
  const keys = listHostModules();
  const lines = ["export { activate, deactivate } from './extension';"];
  keys.forEach((key, index) => {
    lines.push(`import * as m${index} from './${key}';`);
  });
  lines.push('export const bundledModules = {');
  keys.forEach((key, index) => {
    lines.push(`  '${key}': m${index},`);
  });
  lines.push('};');
  return {
    stdin: { contents: lines.join('\n') + '\n', resolveDir: path.join(root, 'src'), loader: 'ts', sourcefile: 'bundle-entry.ts' },
    absWorkingDir: root,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: bundlePath,
    sourcemap: false,
    minify: false,
    metafile: true,
    logLevel: 'warning',
    external: ['vscode', '@metaverse-systems/the-seed', '@metaverse-systems/the-seed/*'],
  };
}

function loadEsbuild() {
  return require(resolveEntry('esbuild'));
}

// Builds dist/extension.js and checks what went into it, then builds the
// sidebar into dist/webview.
function bundle() {
  const checksPath = path.join(root, 'out', 'test', 'harness', 'packageContents.js');
  if (!fs.existsSync(checksPath)) {
    console.log('bundle: compile first ("npm run compile")');
    return false;
  }
  const { bundleInputFailures, ALLOWED_BUNDLE_LIBRARIES } = require(checksPath);
  let result;
  try {
    result = loadEsbuild().buildSync(hostBundleOptions());
  } catch {
    // esbuild has already printed the errors.
    return false;
  }
  const inputs = Object.keys(result.metafile.inputs);
  const failures = bundleInputFailures(inputs, fs.readFileSync(bundlePath, 'utf8'), ALLOWED_BUNDLE_LIBRARIES);
  for (const line of failures) {
    console.log(line);
  }
  if (result.warnings.length > 0) {
    console.log(`bundle: esbuild reported ${result.warnings.length} warning(s)`);
  }
  if (failures.length > 0 || result.warnings.length > 0) {
    return false;
  }
  console.log(`Bundle: dist/extension.js (${inputs.length} inputs, ${Math.round(fs.statSync(bundlePath).size / 1024)} KB)`);
  return run(resolveEntry('vite', 'bin', 'vite.js'), ['build', '--config', 'vite.config.webview.mts']);
}

// Development only: rebuilds dist/extension.js, with a linked source map, on
// every source change until stopped. The sidebar is built once with
// "npm run build:webview".
async function watch() {
  const esbuild = loadEsbuild();
  const reporter = {
    name: 'watch-reporter',
    setup(build) {
      build.onStart(() => {
        console.log('[watch] build started');
      });
      build.onEnd((result) => {
        console.log(`[watch] build finished (${result.errors.length} errors)`);
      });
    },
  };
  const context = await esbuild.context({ ...hostBundleOptions(), sourcemap: 'linked', plugins: [reporter] });
  await context.watch();
  await new Promise((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  await context.dispose();
  return true;
}

function notAvailable(stage) {
  return () => {
    console.log(`${stage}: not available yet`);
    return false;
  };
}

const stageRunners = {
  clean,
  compile: () => run(resolveEntry('typescript', 'bin', 'tsc'), ['-p', './']),
  typecheck: () => run(resolveEntry('typescript', 'bin', 'tsc'), ['--noEmit', '-p', 'tsconfig.webview.json']),
  lint: () => run(resolveEntry('eslint', 'bin', 'eslint.js'), ['--max-warnings', '0', 'src']),
  bundle,
  package: notAvailable('package'),
  watch,
};

// The stages that may start from a fresh checkout: they bootstrap the
// compiled argument parser. Naming no stage at all does too.
const BOOTSTRAP_STAGES = ['compile', 'package', 'watch'];

async function main(argv) {
  // The argument parser lives in the compiled output. On a fresh checkout
  // clean and compile run first, when no stage or a stage that can start from
  // nothing is named, and the arguments are parsed afterwards; the named clean
  // and compile stages are then skipped, since they have just run.
  let bootstrapped = false;
  const parserPath = path.join(root, 'out', 'test', 'harness', 'results.js');
  if (!fs.existsSync(parserPath)) {
    const separator = argv.indexOf('--');
    const named = separator === -1 ? argv : argv.slice(0, separator);
    if (named.length > 0 && !named.some((stage) => BOOTSTRAP_STAGES.includes(stage))) {
      console.log('compile first ("npm run compile")');
      return 1;
    }
    for (const stage of ['clean', 'compile']) {
      console.log(`== ${stage} ==`);
      const ok = await stageRunners[stage]();
      console.log(`${stage}: ${ok ? 'passed' : 'FAILED'}`);
      if (!ok) {
        return 1;
      }
    }
    bootstrapped = true;
  }

  const { parseArguments } = loadResults();
  const parsed = parseArguments(argv);
  if (!parsed.ok) {
    console.error(parsed.error);
    return 2;
  }

  let compileFailed = false;
  let bundleFailed = false;
  let failed = false;
  for (const stage of parsed.stages) {
    if (bootstrapped && (stage === 'clean' || stage === 'compile')) {
      continue;
    }
    console.log(`== ${stage} ==`);
    if (stage === 'host' && compileFailed) {
      console.log('host: not run (compile failed)');
      failed = true;
      continue;
    }
    if (stage === 'host' && bundleFailed) {
      console.log('host: not run (bundle failed)');
      failed = true;
      continue;
    }
    const ok = stage === 'host' ? runHost(parsed.host) : await stageRunners[stage]();
    console.log(`${stage}: ${ok ? 'passed' : 'FAILED'}`);
    if (!ok) {
      failed = true;
      if (stage === 'compile') {
        compileFailed = true;
      }
      if (stage === 'bundle') {
        bundleFailed = true;
      }
    }
  }
  return failed ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

module.exports = { main };
