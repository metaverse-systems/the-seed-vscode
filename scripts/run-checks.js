#!/usr/bin/env node
'use strict';

// Single entry point for the extension's checks: compile, typecheck, lint and
// the host suite. Plain CommonJS, Node built-ins only, no shell.

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

const stageRunners = {
  compile: () => run(resolveEntry('typescript', 'bin', 'tsc'), ['-p', './']),
  typecheck: () => run(resolveEntry('typescript', 'bin', 'tsc'), ['--noEmit', '-p', 'tsconfig.webview.json']),
  lint: () => run(resolveEntry('eslint', 'bin', 'eslint.js'), ['--max-warnings', '0', 'src']),
};

function main(argv) {
  // The argument parser lives in the compiled output. On a fresh checkout the
  // compile stage runs first (it is the only stage that can) and the rest of
  // the arguments are parsed afterwards.
  let compiled = null;
  const parserPath = path.join(root, 'out', 'test', 'harness', 'results.js');
  if (!fs.existsSync(parserPath)) {
    if (argv.length > 0 && !argv.includes('compile')) {
      console.log('compile first ("npm run compile")');
      return 1;
    }
    console.log('== compile ==');
    compiled = stageRunners.compile();
    console.log(`compile: ${compiled ? 'passed' : 'FAILED'}`);
    if (!compiled) {
      return 1;
    }
  }

  const { parseArguments } = loadResults();
  const parsed = parseArguments(argv);
  if (!parsed.ok) {
    console.error(parsed.error);
    return 2;
  }

  let compileFailed = false;
  let failed = false;
  for (const stage of parsed.stages) {
    if (stage === 'compile' && compiled !== null) {
      continue;
    }
    console.log(`== ${stage} ==`);
    if (stage === 'host' && compileFailed) {
      console.log('host: not run (compile failed)');
      failed = true;
      continue;
    }
    const ok = stage === 'host' ? runHost(parsed.host) : stageRunners[stage]();
    console.log(`${stage}: ${ok ? 'passed' : 'FAILED'}`);
    if (!ok) {
      failed = true;
      if (stage === 'compile') {
        compileFailed = true;
      }
    }
  }
  return failed ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { main };
