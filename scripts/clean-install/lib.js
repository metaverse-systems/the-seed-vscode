// The pure parts of the hosted clean-install check: where its scratch
// directories go, the editor's launch and install arguments, the guards that
// keep it to a fresh home on a hosted runner, and the per-command records it
// writes. run.js, no-wsl.js and the driver use them; src/test/cleanInstall.test.ts
// covers them.
'use strict';

const fs = require('fs');
const path = require('path');

/** The legs of the check, which are also the platforms of its records. */
const LEGS = ['linux', 'windows-wsl', 'windows-no-wsl'];

/** The outcome of a command the scripted pass cannot run without answering a prompt. */
const NOT_EXERCISED_PROMPTS = 'not exercised: prompts (owner pass)';

/**
 * The accepted outcomes: passed; a failure, with its reason, as the scripted pass finds it;
 * a failure fixed and repeated; a refusal that was expected; and an operation not run, with why.
 */
const OUTCOME_FORMS = [
  /^passed$/,
  /^failed \(.+\)$/,
  /^failed → fixed in \S+, repeated: passed$/,
  /^refused as expected \(.+\)$/,
  /^not exercised: \S.*$/,
];

function checkLeg(leg) {
  if (!LEGS.includes(leg)) {
    throw new Error(`unknown leg "${leg}"; expected one of ${LEGS.join(', ')}`);
  }
}

/**
 * The scratch directories of one leg, all under `tempRoot` (the runner's temporary directory):
 * the home the editor and the tool see, the editor's profile and extensions directories, the
 * workspace folder and the directory the driver sessions hand their results over in.
 */
function scratchLayout(tempRoot, leg) {
  checkLeg(leg);
  const root = path.join(path.resolve(tempRoot), `clean-install-${leg}`);
  return {
    root,
    home: path.join(root, 'home'),
    userDataDir: path.join(root, 'user-data'),
    extensionsDir: path.join(root, 'extensions'),
    workspace: path.join(root, 'workspace'),
    state: path.join(root, 'state'),
  };
}

/** Throws when `home` already holds the tool's configuration directory, so the check would not start fresh. */
function assertFreshHome(home) {
  const existing = path.join(home, 'the-seed');
  if (fs.existsSync(existing)) {
    throw new Error(`${existing} already exists; the clean-install check needs a home without it`);
  }
}

/** Throws unless the environment is a hosted runner's, so the editor is never started on a desktop. */
function assertHostedRunner(env) {
  if (env.GITHUB_ACTIONS !== 'true') {
    throw new Error('the clean-install check runs only on a hosted runner (GITHUB_ACTIONS=true): it works in a fresh home and starts an editor');
  }
}

/** The profile arguments every editor start of the check is given. */
function profileArgs(layout) {
  return [`--user-data-dir=${layout.userDataDir}`, `--extensions-dir=${layout.extensionsDir}`];
}

/**
 * The editor's launch arguments: the folder to open, then the fresh profile and extensions
 * directories. On Linux the editor is kept to X11, as it runs under xvfb-run.
 */
function launchArgs(layout, folder, platform) {
  const args = [folder, ...profileArgs(layout)];
  if (platform === 'linux') {
    args.push('--ozone-platform=x11');
  }
  return args;
}

/** The editor command line's arguments that install the package into the fresh extensions directory. */
function installArgs(layout, vsix) {
  return ['--install-extension', vsix, ...profileArgs(layout), '--force'];
}

/** Throws unless `outcome` is one of the record's outcome forms. */
function checkOutcome(outcome) {
  if (typeof outcome !== 'string' || !OUTCOME_FORMS.some((form) => form.test(outcome))) {
    throw new Error(`unknown outcome "${outcome}"`);
  }
}

/**
 * One record per contributed command of `manifest`, in its order. `outcomes` maps command
 * identifiers to outcomes; a command without one gets `fallback` (by default, left to the
 * owner's pass). An unknown outcome, platform or command is refused.
 */
function commandRecords({ manifest, platform, runId = null, editorVersion, toolVersion, outcomes, fallback = NOT_EXERCISED_PROMPTS }) {
  checkLeg(platform);
  checkOutcome(fallback);
  const commands = manifest.contributes.commands;
  const known = new Set(commands.map((entry) => entry.command));
  for (const [id, outcome] of Object.entries(outcomes)) {
    if (!known.has(id)) {
      throw new Error(`an outcome was given for ${id}, which the manifest does not contribute`);
    }
    checkOutcome(outcome);
  }
  return commands.map((entry) => ({
    platform,
    pass: 'scripted',
    runId: runId === undefined ? null : runId,
    editorVersion,
    toolVersion,
    extensionVersion: manifest.version,
    command: entry.title,
    commandId: entry.command,
    outcome: Object.prototype.hasOwnProperty.call(outcomes, entry.command) ? outcomes[entry.command] : fallback,
  }));
}

/** Writes the records as JSON, creating the file's directory. */
function writeRecords(file, records) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(records, null, 2) + '\n');
}

/** The records file of a leg. */
function recordsFile(resultsDir, leg) {
  checkLeg(leg);
  return path.join(resultsDir, `clean-install-${leg}.json`);
}

/** True when a record is a failure the run must report. */
function isFailure(record) {
  return /^failed \(/.test(record.outcome);
}

module.exports = {
  LEGS,
  NOT_EXERCISED_PROMPTS,
  scratchLayout,
  assertFreshHome,
  assertHostedRunner,
  launchArgs,
  installArgs,
  checkOutcome,
  commandRecords,
  writeRecords,
  recordsFile,
  isFailure,
};
