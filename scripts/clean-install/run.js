// One leg of the hosted clean-install check (Linux, or Ubuntu in WSL): installs
// the package built by the run into a fresh editor 1.143.0 profile with a fresh
// home, drives it in two sessions with the driver extension, runs the readme's
// native-component step between them, and writes one record per command to
// test-results/clean-install-<leg>.json.
//
// It starts an editor, so it refuses to run anywhere but a hosted runner, and on
// Linux it expects to be started under xvfb-run -a.
//
//   node scripts/clean-install/run.js --leg linux --vsix <package> [--results <dir>]
'use strict';

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('./lib');

const REPOSITORY = path.resolve(__dirname, '..', '..');
const DRIVER = path.join(__dirname, 'driver');
const EDITOR_VERSION = process.env.VSCODE_VERSION || '1.143.0';
const EXTENSION_ID = 'metaverse-systems.the-seed-vscode';

function parseArgs(argv) {
  const options = { results: path.join(REPOSITORY, 'test-results') };
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    const value = argv[i + 1];
    if ((name === '--leg' || name === '--vsix' || name === '--results') && value !== undefined) {
      options[name.slice(2)] = value;
      i++;
    } else {
      throw new Error(`unknown argument ${name}`);
    }
  }
  if (!options.leg || !options.vsix) {
    throw new Error('usage: run.js --leg <linux|windows-wsl> --vsix <package> [--results <dir>]');
  }
  if (options.leg === 'windows-no-wsl') {
    throw new Error('the windows-no-wsl leg runs no editor; it uses no-wsl.js');
  }
  return options;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

/** The global tool's package directory, as the readme installs it. */
function globalToolRoot() {
  const found = cp.spawnSync('npm', ['root', '-g'], { encoding: 'utf-8' });
  if (found.status !== 0) {
    throw new Error(`npm root -g failed: ${found.stderr}`);
  }
  const root = path.join(found.stdout.trim(), '@metaverse-systems', 'the-seed');
  if (!fs.existsSync(path.join(root, 'package.json'))) {
    throw new Error(`the tool is not installed globally: ${root}`);
  }
  return root;
}

/** The manifest of the package as the editor installed it. */
function installedManifest(extensionsDir) {
  const prefix = `${EXTENSION_ID}-`;
  const dirs = fs.readdirSync(extensionsDir).filter((name) => name.startsWith(prefix));
  if (dirs.length !== 1) {
    throw new Error(`expected one installed ${EXTENSION_ID} in ${extensionsDir}, found ${dirs.length}`);
  }
  return readJson(path.join(extensionsDir, dirs[0], 'package.json'));
}

function readSession(state, session) {
  const file = path.join(state, `session-${session}.json`);
  return fs.existsSync(file) ? readJson(file) : { outcomes: {}, checks: [{ check: `driver session ${session}`, outcome: 'failed (it wrote no results)' }] };
}

/** The outcomes of both sessions; a command run in both keeps the first failure. */
function mergeOutcomes(first, second) {
  const merged = { ...first };
  for (const [id, outcome] of Object.entries(second)) {
    if (!(id in merged) || !/^failed \(/.test(merged[id])) {
      merged[id] = outcome;
    }
  }
  return merged;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  lib.assertHostedRunner(process.env);
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    throw new Error('no display: start this under xvfb-run -a');
  }

  const layout = lib.scratchLayout(process.env.RUNNER_TEMP || os.tmpdir(), options.leg);
  fs.rmSync(layout.root, { recursive: true, force: true });
  for (const dir of [layout.home, layout.userDataDir, layout.extensionsDir, layout.workspace, layout.state]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  lib.assertFreshHome(layout.home);

  const toolRoot = globalToolRoot();
  const toolVersion = readJson(path.join(toolRoot, 'package.json')).version;
  const expectedVersion = readJson(path.join(REPOSITORY, 'package.json')).version;
  const vsix = path.resolve(options.vsix);
  console.log(`Leg ${options.leg}: editor ${EDITOR_VERSION}, tool ${toolVersion} at ${toolRoot}, package ${vsix}`);

  const { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } = require('@vscode/test-electron');
  const editor = await downloadAndUnzipVSCode(EDITOR_VERSION);
  const [cli] = resolveCliArgsFromVSCodeExecutablePath(editor, { reuseMachineInstall: true });

  const home = {
    HOME: layout.home,
    USERPROFILE: layout.home,
    XDG_CONFIG_HOME: path.join(layout.home, '.config'),
  };
  // The editor's launcher asks a question when it runs inside WSL; there is no one to answer it.
  const freshEnv = { ...process.env, ...home, DONT_PROMPT_WSL_INSTALL: '1' };

  const installed = cp.spawnSync(cli, lib.installArgs(layout, vsix), { env: freshEnv, stdio: 'inherit' });
  if (installed.status !== 0) {
    throw new Error(`installing ${vsix} failed with exit status ${installed.status}`);
  }
  const manifest = installedManifest(layout.extensionsDir);

  const driverEnv = {
    ...home,
    CLEAN_INSTALL_LEG: options.leg,
    CLEAN_INSTALL_STATE: layout.state,
    CLEAN_INSTALL_EXTENSIONS_DIR: layout.extensionsDir,
    CLEAN_INSTALL_EXTENSION_VERSION: expectedVersion,
    CLEAN_INSTALL_TOOL_ROOT: toolRoot,
    CLEAN_INSTALL_PREFIX: path.join(layout.root, 'prefix'),
    CLEAN_INSTALL_FIXTURE: path.join(REPOSITORY, 'src', 'test', 'fixtures', 'tiny.exe'),
  };

  const session = async (number, folder) => {
    console.log(`Driver session ${number}, folder ${folder}`);
    try {
      await runTests({
        vscodeExecutablePath: editor,
        extensionDevelopmentPath: DRIVER,
        extensionTestsPath: path.join(DRIVER, 'suite.js'),
        launchArgs: lib.launchArgs(layout, folder, process.platform),
        extensionTestsEnv: { ...driverEnv, CLEAN_INSTALL_SESSION: String(number) },
      });
      return true;
    } catch (error) {
      console.log(`::error::driver session ${number} failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };

  const firstPassed = await session(1, layout.workspace);
  const first = readSession(layout.state, 1);

  // The readme's step after the libraries are installed: build the tool's native component.
  console.log(`npm run build-addon in ${toolRoot}`);
  const addon = cp.spawnSync('npm', ['run', 'build-addon'], { cwd: toolRoot, env: freshEnv, stdio: 'inherit' });
  const addonCheck = {
    check: 'the readme\'s native-component step (npm run build-addon)',
    outcome: addon.status === 0 ? 'passed' : `failed (exit status ${addon.status})`,
  };

  const projectDir = first.projectDir && fs.existsSync(first.projectDir) ? first.projectDir : layout.workspace;
  const secondPassed = await session(2, projectDir);
  const second = readSession(layout.state, 2);

  const records = lib.commandRecords({
    manifest,
    platform: options.leg,
    runId: process.env.GITHUB_RUN_ID || null,
    editorVersion: EDITOR_VERSION,
    toolVersion,
    outcomes: mergeOutcomes(first.outcomes, second.outcomes),
  });
  const checks = [...first.checks, addonCheck, ...second.checks];
  lib.writeRecords(lib.recordsFile(options.results, options.leg), records);
  lib.writeRecords(path.join(options.results, `clean-install-${options.leg}-checks.json`), checks);

  for (const record of records) {
    console.log(`${record.command}: ${record.outcome}`);
  }
  for (const entry of checks) {
    console.log(`(check) ${entry.check}: ${entry.outcome}`);
  }
  const failures = [...records.filter(lib.isFailure).map((record) => record.command), ...checks.filter(lib.isFailure).map((entry) => entry.check)];
  for (const failure of failures) {
    console.log(`::error::clean-install ${options.leg}: ${failure} failed`);
  }
  if (failures.length > 0 || !firstPassed || !secondPassed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.log(`::error::${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
