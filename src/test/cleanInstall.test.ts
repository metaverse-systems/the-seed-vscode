// The pure parts of the hosted clean-install check (scripts/clean-install/lib.js):
// the editor's launch and install arguments, the guards that keep it on a fresh
// home on a hosted runner, and the writer of its per-command records. The hosted
// job itself is the end-to-end check; these cases cover the logic it relies on.
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface Layout {
  root: string;
  home: string;
  userDataDir: string;
  extensionsDir: string;
  workspace: string;
  state: string;
}

interface CommandRecord {
  platform: string;
  pass: string;
  runId: string | null;
  editorVersion: string;
  toolVersion: string;
  extensionVersion: string;
  command: string;
  commandId: string;
  outcome: string;
}

interface Manifest {
  version: string;
  contributes: { commands: { command: string; title: string }[] };
}

interface RecordOptions {
  manifest: Manifest;
  platform: string;
  runId?: string | null;
  editorVersion: string;
  toolVersion: string;
  outcomes: Record<string, string>;
  fallback?: string;
}

interface CleanInstallLib {
  LEGS: string[];
  NOT_EXERCISED_PROMPTS: string;
  scratchLayout(tempRoot: string, leg: string): Layout;
  assertFreshHome(home: string): void;
  assertHostedRunner(env: Record<string, string | undefined>): void;
  launchArgs(layout: Layout, folder: string, platform: string): string[];
  installArgs(layout: Layout, vsix: string): string[];
  checkOutcome(outcome: string): void;
  commandRecords(options: RecordOptions): CommandRecord[];
  writeRecords(file: string, records: CommandRecord[]): void;
  recordsFile(resultsDir: string, leg: string): string;
}

const ROOT = path.resolve(__dirname, '..', '..');
const lib = require(path.join(ROOT, 'scripts', 'clean-install', 'lib.js')) as CleanInstallLib;
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')) as Manifest;

function baseOptions(outcomes: Record<string, string> = {}): RecordOptions {
  return {
    manifest: MANIFEST,
    platform: 'linux',
    runId: '42',
    editorVersion: '1.143.0',
    toolVersion: '2.0.0',
    outcomes,
  };
}

suite('Clean-install check: launch arguments', () => {
  let temp: string;

  setup(() => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'the-seed-ext-clean-install-'));
  });

  teardown(() => {
    fs.rmSync(temp, { recursive: true, force: true });
  });

  test('the scratch directories are distinct and all under the temporary directory', () => {
    const layout = lib.scratchLayout(temp, 'linux');
    const dirs = [layout.home, layout.userDataDir, layout.extensionsDir, layout.workspace, layout.state];
    assert.strictEqual(new Set(dirs).size, dirs.length);
    for (const dir of dirs) {
      assert.ok(dir.startsWith(layout.root + path.sep), `${dir} is not under ${layout.root}`);
    }
    assert.ok(layout.root.startsWith(temp + path.sep), `${layout.root} is not under ${temp}`);
  });

  test('two legs get different scratch directories', () => {
    assert.notStrictEqual(lib.scratchLayout(temp, 'linux').root, lib.scratchLayout(temp, 'windows-wsl').root);
  });

  test('an unknown leg is refused', () => {
    assert.throws(() => lib.scratchLayout(temp, 'macos'), /unknown leg "macos"/);
  });

  test('the launch arguments open the folder with the fresh profile and extensions directories', () => {
    const layout = lib.scratchLayout(temp, 'linux');
    const args = lib.launchArgs(layout, layout.workspace, 'linux');
    assert.strictEqual(args[0], layout.workspace);
    assert.ok(args.includes(`--user-data-dir=${layout.userDataDir}`), args.join(' '));
    assert.ok(args.includes(`--extensions-dir=${layout.extensionsDir}`), args.join(' '));
    assert.strictEqual(args.filter((arg) => arg.startsWith('--user-data-dir')).length, 1);
    assert.strictEqual(args.filter((arg) => arg.startsWith('--extensions-dir')).length, 1);
    assert.ok(!args.includes('--disable-extensions'), 'the installed extension must be able to load');
  });

  test('the editor is kept to X11 on Linux, where it runs under xvfb-run', () => {
    const layout = lib.scratchLayout(temp, 'linux');
    assert.ok(lib.launchArgs(layout, layout.workspace, 'linux').includes('--ozone-platform=x11'));
    assert.ok(!lib.launchArgs(layout, layout.workspace, 'win32').includes('--ozone-platform=x11'));
  });

  test('the package is installed into the fresh extensions directory', () => {
    const layout = lib.scratchLayout(temp, 'linux');
    const args = lib.installArgs(layout, '/runner/the-seed-vscode-0.3.0.vsix');
    assert.deepStrictEqual(args.slice(0, 2), ['--install-extension', '/runner/the-seed-vscode-0.3.0.vsix']);
    assert.ok(args.includes(`--extensions-dir=${layout.extensionsDir}`), args.join(' '));
    assert.ok(args.includes(`--user-data-dir=${layout.userDataDir}`), args.join(' '));
  });
});

suite('Clean-install check: guards', () => {
  let temp: string;

  setup(() => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'the-seed-ext-clean-install-'));
  });

  teardown(() => {
    fs.rmSync(temp, { recursive: true, force: true });
  });

  test('a home that already holds the-seed is refused', () => {
    fs.mkdirSync(path.join(temp, 'the-seed'));
    assert.throws(() => lib.assertFreshHome(temp), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(path.join(temp, 'the-seed')), error.message);
      assert.match(error.message, /already exists/);
      return true;
    });
  });

  test('a home with no the-seed directory is accepted', () => {
    fs.mkdirSync(path.join(temp, 'other'));
    assert.doesNotThrow(() => lib.assertFreshHome(temp));
  });

  test('a run outside a hosted runner is refused', () => {
    assert.throws(() => lib.assertHostedRunner({}), /hosted runner/);
    assert.throws(() => lib.assertHostedRunner({ GITHUB_ACTIONS: 'false' }), /hosted runner/);
    assert.doesNotThrow(() => lib.assertHostedRunner({ GITHUB_ACTIONS: 'true' }));
  });
});

suite('Clean-install check: record writer', () => {
  const commands = MANIFEST.contributes.commands;

  test('one record per contributed command, in the manifest\'s order, with the record fields', () => {
    const records = lib.commandRecords(baseOptions({ 'the-seed.checkTool': 'passed' }));
    assert.strictEqual(records.length, commands.length);
    assert.strictEqual(records.length, 28);
    assert.deepStrictEqual(records.map((record) => record.commandId), commands.map((command) => command.command));
    assert.deepStrictEqual(records.map((record) => record.command), commands.map((command) => command.title));
    assert.deepStrictEqual(Object.keys(records[0]).sort(), [
      'command', 'commandId', 'editorVersion', 'extensionVersion', 'outcome', 'pass', 'platform', 'runId', 'toolVersion',
    ]);
    const check = records.find((record) => record.commandId === 'the-seed.checkTool');
    assert.deepStrictEqual(check, {
      platform: 'linux',
      pass: 'scripted',
      runId: '42',
      editorVersion: '1.143.0',
      toolVersion: '2.0.0',
      extensionVersion: MANIFEST.version,
      command: 'The Seed: Check Tool',
      commandId: 'the-seed.checkTool',
      outcome: 'passed',
    });
  });

  test('a command with no outcome is recorded as left to the owner\'s pass', () => {
    const records = lib.commandRecords(baseOptions());
    assert.ok(records.every((record) => record.outcome === lib.NOT_EXERCISED_PROMPTS));
    assert.strictEqual(lib.NOT_EXERCISED_PROMPTS, 'not exercised: prompts (owner pass)');
  });

  test('a leg may give its own outcome for the commands it does not run', () => {
    const records = lib.commandRecords({ ...baseOptions(), platform: 'windows-no-wsl', fallback: 'not exercised: needs WSL' });
    assert.ok(records.every((record) => record.outcome === 'not exercised: needs WSL'));
  });

  test('every outcome form is accepted', () => {
    for (const outcome of [
      'passed',
      'failed (the build reported no program)',
      'failed → fixed in abc1234, repeated: passed',
      'refused as expected (Build the native component first)',
      'not exercised: wixl absent',
    ]) {
      assert.doesNotThrow(() => lib.checkOutcome(outcome), outcome);
    }
  });

  test('an unknown outcome is refused', () => {
    for (const outcome of ['ok', 'PASSED', 'failed', 'refused as expected', 'not exercised:', '']) {
      assert.throws(() => lib.checkOutcome(outcome), /unknown outcome/, outcome);
      assert.throws(() => lib.commandRecords(baseOptions({ 'the-seed.checkTool': outcome })), /unknown outcome/, outcome);
    }
  });

  test('an outcome for a command the manifest does not contribute is refused', () => {
    assert.throws(() => lib.commandRecords(baseOptions({ 'the-seed.noSuchCommand': 'passed' })), /the-seed\.noSuchCommand/);
  });

  test('an unknown platform is refused', () => {
    assert.throws(() => lib.commandRecords({ ...baseOptions(), platform: 'macos' }), /unknown leg "macos"/);
    assert.deepStrictEqual(lib.LEGS, ['linux', 'windows-wsl', 'windows-no-wsl']);
  });

  test('the records are written to the leg\'s file as JSON', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'the-seed-ext-clean-install-'));
    try {
      const file = lib.recordsFile(path.join(temp, 'test-results'), 'windows-wsl');
      assert.strictEqual(file, path.join(temp, 'test-results', 'clean-install-windows-wsl.json'));
      const records = lib.commandRecords({ ...baseOptions(), platform: 'windows-wsl' });
      lib.writeRecords(file, records);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf-8')), records);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });
});
