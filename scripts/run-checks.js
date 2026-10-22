#!/usr/bin/env node
'use strict';

// Single entry point for the extension's checks: compile, typecheck, lint and
// the host suite. Plain CommonJS, Node built-ins only, no shell.

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
  // Marker: switch this check to out/test/harness/globalSetup.js once the
  // global setup module exists.
  return fs.existsSync(path.join(root, 'out', 'test', 'harness', 'results.js'));
}

function runHostOnce(hostOptions) {
  const results = loadResults();

  // Hook: known-gap validation runs here, before the editor starts.
  // Hook: real-home guard and leftover scratch directories are recorded here.

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
    if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
      const probe = spawnSync('xvfb-run', ['--help'], { stdio: 'ignore' });
      if (probe.error) {
        console.log('no display: install xvfb (xvfb-run) or set DISPLAY');
        return false;
      }
      args = ['-a', process.execPath, entry];
      command = 'xvfb-run';
    }
    spawnSync(command, args, { cwd: root, stdio: 'inherit', env });

    let ok = true;
    if (!fs.existsSync(resultsFile)) {
      console.log('RESULTS MISSING: the host suite did not finish (see the output above)');
      return false;
    }
    const recorded = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
    const outcome = results.classifyResults(recorded);
    for (const line of outcome.failures) {
      console.log(line);
    }
    // Hook: leftover scratch entries and real-home comparison add failures here.
    ok = outcome.passed;
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
