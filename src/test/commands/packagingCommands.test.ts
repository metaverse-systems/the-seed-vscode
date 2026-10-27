// Packaging commands: no workspace folder open, the installer's prefix check and
// operation lock, choosing the projects and the output directory (and every
// refusal before anything is written), the confirmation before replacing an
// output that holds files, the previous output kept unless a run produces a
// new one, and the tool's output taken through its per-run options rather than
// the shared console.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { acquireOperationLock, getOperationLock } from '../../operationLock';
import type { OperationType } from '../../operationLock';
import { TheSeedViewProvider } from '../../panels/TheSeedViewProvider';
import { activeToolService } from '../../tool/toolService';
import { requires } from '../harness/platform';
import { locateBuildDeps, requireProgram } from '../helpers/buildDeps';
import { useScratchState } from '../helpers/scratchState';
import { testTool, useToolApi } from '../helpers/tool';
import { answerPackagingDialogs, OUTPUT_LABEL, packageWithoutNativeCheck, PROJECTS_LABEL, writePackagingProject } from '../helpers/packagingDialogs';
import { NO_PROJECT_CHOSEN, REPLACE_CONTENTS, replaceWarning } from '../../commands/packageProject';
import { fakeView, until } from '../helpers/fakeView';
import { readTree } from '../helpers/workspaceStub';
import { panelText, recordOperation } from '../helpers/operationRecorder';
import type { Recorder } from '../helpers/operationRecorder';
import type { ToolApi } from '../../tool/toolApi';
import type { InstallerRunOptions, PackageCopyEvent, PackageRunOptions } from '@metaverse-systems/the-seed/types';

suite('Packaging Commands', () => {
  useScratchState({ workspaceFolders: 0 });

  for (const commandId of ['the-seed.generateWindowsInstaller', 'the-seed.packageProject']) {
    test(`${commandId} with no workspace folder shows the workspace folder error`, async () => {
      const error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);

      await vscode.commands.executeCommand(commandId);

      assert.strictEqual(error.callCount, 1);
      const message = error.firstCall.args[0];
      assert.ok(
        typeof message === 'string' && message.includes('workspace folder'),
        `the message mentions the workspace folder, got: ${message}`
      );
      if (commandId === 'the-seed.packageProject') {
        assert.strictEqual(getOperationLock().active, false, 'the lock is not held');
      }
    });
  }
});

type InstallerResult = { ok: true; msiPath: string } | { ok: false; status: 1 | 2; message: string };

const INSTALLER_REFUSALS: Record<Exclude<OperationType, 'installer'>, string> = {
  build: 'Cannot generate the installer while a build operation is in progress.',
  install: 'Cannot generate the installer while an install operation is in progress.',
  package: 'Cannot generate the installer while a packaging operation is in progress.',
};

const NO_PREFIX = 'No prefix configured. Run "The Seed: Configure Project" first.';

/** The other long operations, each started from the palette, and the text each is refused with while an installer is generated. */
const REFUSED_UNDER_INSTALLER: { name: string; commandId: string; text: string }[] = [
  { name: 'a build', commandId: 'the-seed.buildNative', text: 'Cannot build while an installer is being generated.' },
  { name: 'an install', commandId: 'the-seed.installDependencies', text: 'Cannot install dependencies while an installer is being generated.' },
  { name: 'a packaging run', commandId: 'the-seed.packageProject', text: 'Cannot package while an installer is being generated.' },
];

suite('Packaging Commands: installer lock and prefix', function () {
  this.timeout(60000);
  useScratchState({ workspaceFolders: 1 });

  let provider: TheSeedViewProvider | null = null;
  let warning: sinon.SinonStub;
  let error: sinon.SinonStub;
  let pick: sinon.SinonStub;
  let packageRun: sinon.SinonStub;

  setup(() => {
    warning = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);
    error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
    sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    pick = sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);
    packageRun = sinon.stub(testTool().Package.prototype, 'run').resolves({
      success: false,
      message: 'stubbed packaging run',
      outputDir: '',
      projects: [],
      files: [],
      signatures: 0,
      fileCount: 0,
      notPackaged: [],
    } as never);
  });

  teardown(() => {
    (provider as unknown as { dispose?: () => void } | null)?.dispose?.();
    provider = null;
  });

  function stubInstallerRun(): sinon.SinonStub {
    return sinon.stub(testTool().Installer.prototype, 'run');
  }

  /** Starts installer generation from the sidebar's message and waits until the fired command has refused or run. */
  async function generateFromSidebar(run: sinon.SinonStub): Promise<void> {
    provider = new TheSeedViewProvider(vscode.Uri.file('/test/extension'), activeToolService());
    const fake = fakeView(provider);
    await fake.receive({ command: 'generateInstaller', requestId: 'installer-1' });
    await until(() => warning.called || error.called || run.called, 'the fired installer command to refuse or run');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const starts: { via: string; start: (run: sinon.SinonStub) => Promise<void> }[] = [
    { via: 'the palette', start: async () => { await vscode.commands.executeCommand('the-seed.generateWindowsInstaller'); } },
    { via: 'the sidebar', start: generateFromSidebar },
  ];

  for (const holder of ['build', 'install', 'package'] as const) {
    for (const { via, start } of starts) {
      test(`the installer from ${via} while ${holder} holds the lock is refused and does not run`, async () => {
        const held = acquireOperationLock(holder);
        assert.ok(held.success, 'the case holds the lock');
        const run = stubInstallerRun().resolves({ ok: true, msiPath: '/nowhere/game.msi' } as InstallerResult);

        await start(run);

        assert.ok(run.notCalled, 'Installer.run is not called');
        assert.deepStrictEqual(warning.getCalls().map((call) => call.args[0]), [INSTALLER_REFUSALS[holder]]);
        assert.strictEqual(getOperationLock().type, holder, 'the holder is unchanged');
        assert.strictEqual(getOperationLock().abortController, held.abortController, 'the abort controller is unchanged');
      });
    }
  }

  for (const { name, commandId, text } of REFUSED_UNDER_INSTALLER) {
    test(`${name} is refused while an installer is being generated`, async () => {
      let finish: (result: InstallerResult) => void = () => undefined;
      const run = stubInstallerRun().callsFake(() => new Promise<InstallerResult>((resolve) => { finish = resolve; }));
      const generating = vscode.commands.executeCommand('the-seed.generateWindowsInstaller');
      try {
        await until(() => run.called, 'the installer to start');
        assert.strictEqual(getOperationLock().type, 'installer', 'the installer holds the lock while it runs');
        const controller = getOperationLock().abortController;

        await vscode.commands.executeCommand(commandId);

        assert.deepStrictEqual(warning.getCalls().map((call) => call.args[0]), [text]);
        assert.ok(packageRun.notCalled, 'nothing is packaged');
        assert.ok(pick.notCalled, 'nothing is asked');
        assert.strictEqual(getOperationLock().type, 'installer', 'the holder is unchanged');
        assert.strictEqual(getOperationLock().abortController, controller, 'the abort controller is unchanged');
      } finally {
        finish({ ok: true, msiPath: '/nowhere/game.msi' });
        await generating;
      }
      assert.strictEqual(getOperationLock().active, false, 'the lock is free once the installer ends');
    });
  }

  for (const { name, commandId, text } of REFUSED_UNDER_INSTALLER) {
    test(`${name} is refused while the installer lock is held`, async () => {
      const held = acquireOperationLock('installer');
      assert.ok(held.success, 'the case holds the installer lock');

      await vscode.commands.executeCommand(commandId);

      assert.deepStrictEqual(warning.getCalls().map((call) => call.args[0]), [text]);
      assert.ok(packageRun.notCalled, 'nothing is packaged');
      assert.strictEqual(getOperationLock().type, 'installer', 'the holder is unchanged');
      assert.strictEqual(getOperationLock().abortController, held.abortController, 'the abort controller is unchanged');
    });
  }

  test('the installer with no prefix shows the prefix error, does not run and leaves the lock free', async () => {
    sinon.stub(testTool().Config.prototype, 'loadConfig').callsFake(function (this: { config: { prefix: string } }) {
      this.config.prefix = '';
    });
    const run = stubInstallerRun().resolves({ ok: true, msiPath: '/nowhere/game.msi' } as InstallerResult);

    await vscode.commands.executeCommand('the-seed.generateWindowsInstaller');

    assert.deepStrictEqual(error.getCalls().map((call) => call.args[0]), [NO_PREFIX]);
    assert.ok(run.notCalled, 'Installer.run is not called');
    assert.strictEqual(getOperationLock().active, false, 'the lock is free');
  });

  const outcomes: { name: string; outcome: () => Promise<InstallerResult> }[] = [
    { name: 'success', outcome: async () => ({ ok: true, msiPath: '/nowhere/game.msi' }) },
    { name: 'a failure', outcome: async () => ({ ok: false, status: 1, message: 'stubbed installer failure' }) },
    { name: 'a throw', outcome: async () => { throw new Error('stubbed installer throw'); } },
  ];

  for (const { name, outcome } of outcomes) {
    test(`the installer holds the installer lock while it runs and frees it after ${name}`, async () => {
      const holders: (OperationType | null)[] = [];
      const run = stubInstallerRun().callsFake(() => {
        holders.push(getOperationLock().type);
        return outcome();
      });

      await vscode.commands.executeCommand('the-seed.generateWindowsInstaller');

      assert.strictEqual(run.callCount, 1, 'Installer.run is called once');
      assert.deepStrictEqual(holders, ['installer'], 'the installer lock is held during the run');
      assert.strictEqual(getOperationLock().active, false, 'the lock is free afterwards');
    });
  }
});

type PackageRunResult = {
  success: boolean;
  message: string | null;
  outputDir: string;
  projects: string[];
  files: string[];
  signatures: number;
  fileCount: number;
  notPackaged: never[];
};

function packageResult(outputDir: string, success: boolean, message: string | null, files: string[] = []): PackageRunResult {
  return { success, message, outputDir, projects: [], files, signatures: 0, fileCount: files.length, notPackaged: [] };
}

/** A previous packaging output: files and directories with distinct contents and modes. */
const PREVIOUS_OUTPUT: { relative: string; mode: number; text: string | null }[] = [
  { relative: 'game', mode: 0o755, text: '#!/bin/sh\necho previous game\n' },
  { relative: 'lib', mode: 0o750, text: null },
  { relative: path.join('lib', 'libengine.so.1'), mode: 0o644, text: 'previous engine library\n' },
  { relative: path.join('lib', 'libengine.so.1.sig'), mode: 0o600, text: 'previous engine signature\n' },
  { relative: 'README', mode: 0o444, text: 'previous readme\n' },
];

/** Writes PREVIOUS_OUTPUT into `outputDir` and returns its tree. */
function writePreviousOutput(outputDir: string): Map<string, { mode: number; bytes: string | null }> {
  fs.mkdirSync(outputDir, { recursive: true });
  for (const entry of PREVIOUS_OUTPUT) {
    const full = path.join(outputDir, entry.relative);
    if (entry.text === null) {
      fs.mkdirSync(full);
    } else {
      fs.writeFileSync(full, entry.text);
    }
  }
  // Modes are set after every entry is written, so a read-only directory or file does not stop the writes.
  for (const entry of PREVIOUS_OUTPUT) {
    fs.chmodSync(path.join(outputDir, entry.relative), entry.mode);
  }
  return readTree(outputDir);
}

/** The moved-aside directories left beside an output directory. */
function leftAside(outputDir: string): string[] {
  const prefix = `.${path.basename(outputDir)}-previous-`;
  return fs.readdirSync(path.dirname(outputDir)).filter((name) => name.startsWith(prefix));
}

/**
 * Makes creating anything directly in `dir` fail until the returned function is
 * called: the directory is made read-only, and where that does not stop a write
 * (an administrator, or Windows, where a directory's read-only attribute does not
 * apply to its entries) fs.mkdtempSync is made to fail for paths in it instead.
 */
function refuseWritesIn(dir: string): () => void {
  const mode = fs.statSync(dir).mode & 0o7777;
  fs.chmodSync(dir, 0o555);
  let probeWritten = false;
  try {
    fs.rmdirSync(fs.mkdtempSync(path.join(dir, 'probe-')));
    probeWritten = true;
  } catch {
    // The read-only directory refuses the write, as intended
  }
  let stub: sinon.SinonStub | null = null;
  if (probeWritten) {
    const nodeFs = require('fs') as typeof fs;
    const original = nodeFs.mkdtempSync;
    stub = sinon.stub(nodeFs, 'mkdtempSync').callsFake(((prefix: string, options?: unknown) => {
      if (path.dirname(prefix) === dir) {
        throw Object.assign(new Error(`EACCES: permission denied, mkdtemp '${prefix}XXXXXX'`), { code: 'EACCES' });
      }
      return original(prefix, options as never);
    }) as never);
  }
  return (): void => {
    stub?.restore();
    fs.chmodSync(dir, mode);
  };
}

/** What one packaging case records: the calls to Package.run and what was shown. */
interface PackagingCase {
  warning: sinon.SinonStub;
  error: sinon.SinonStub;
  info: sinon.SinonStub;
  packageRun: sinon.SinonStub;
  /** Each Package.run call: the output, the projects, and whether the output existed then. */
  runs: { output: string; projects: string[]; existed: boolean }[];
  /** The answer to the replace confirmation; undefined dismisses it. */
  confirm: string | undefined;
  /** Each confirmation shown: its text, and whether the lock was free and the tree untouched then. */
  confirmations: { text: string; modal: boolean; items: unknown[]; lockFree: boolean }[];
}

/** Stubs the messages and Package.run for a packaging case; the replace confirmation answers `confirm`. */
function usePackagingCase(): PackagingCase {
  const current = {} as PackagingCase;
  setup(async () => {
    await packageWithoutNativeCheck();
    current.runs = [];
    current.confirmations = [];
    current.confirm = undefined;
    current.warning = sinon.stub(vscode.window, 'showWarningMessage').callsFake((async (text: string, ...rest: unknown[]) => {
      const options = rest[0];
      if (typeof options === 'object' && options !== null && (options as vscode.MessageOptions).modal) {
        current.confirmations.push({ text, modal: true, items: rest.slice(1), lockFree: !getOperationLock().active });
        return current.confirm;
      }
      return undefined;
    }) as never);
    current.error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
    current.info = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    current.packageRun = sinon.stub(testTool().Package.prototype, 'run');
  });
  return current;
}

/** Makes Package.run record its call, then do what `act` does with the output directory it was given. */
function runDoes(c: PackagingCase, act: (output: string) => Promise<PackageRunResult>): void {
  c.packageRun.callsFake(async (output: string, projects: string[]) => {
    c.runs.push({ output, projects: [...projects], existed: fs.existsSync(output) });
    return act(output);
  });
}

function shownBy(stub: sinon.SinonStub): unknown[] {
  return stub.getCalls().map((call) => call.args[0]);
}

const REFUSE = async (output: string): Promise<PackageRunResult> => packageResult(output, false, 'stubbed refusal');
const SUCCEED = async (output: string): Promise<PackageRunResult> => {
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'new'), 'the new result');
  return packageResult(output, true, null, ['new']);
};

suite('Packaging Commands: choosing projects and output', function () {
  this.timeout(60000);
  const state = useScratchState({ workspaceFolders: 1 });
  const c = usePackagingCase();

  /** The workspace folder, which is not a project itself. */
  function root(): string {
    return fs.realpathSync(state.workspaceFolders[0]);
  }

  function assertRefusedBeforeWriting(before: Map<string, unknown>, shown: string): void {
    assert.deepStrictEqual(shownBy(c.error), [shown]);
    assert.ok(c.packageRun.notCalled, 'Package.run is not called');
    assert.deepStrictEqual(readTree(root()), before, 'the workspace is unchanged');
    assert.strictEqual(getOperationLock().active, false, 'the lock is free');
  }

  test('a workspace whose root is not a project packages the two projects chosen, in order', async () => {
    const one = writePackagingProject(root(), 'one');
    const two = writePackagingProject(root(), 'two');
    const output = path.join(root(), 'release');
    const dialogs = answerPackagingDialogs({ projects: [two, one], output });
    runDoes(c, SUCCEED);

    await vscode.commands.executeCommand('the-seed.packageProject');

    assert.deepStrictEqual(c.runs, [{ output, projects: [two, one], existed: false }]);
    assert.deepStrictEqual(dialogs.map((dialog) => [dialog.openLabel, dialog.canSelectFolders, dialog.canSelectFiles, dialog.canSelectMany]), [
      [PROJECTS_LABEL, true, false, true],
      [OUTPUT_LABEL, true, false, false],
    ]);
    assert.strictEqual(dialogs[0].defaultUri?.fsPath, vscode.Uri.file(state.workspaceFolders[0]).fsPath, 'the dialogs open in the workspace folder');
    assert.deepStrictEqual(shownBy(c.info), [`Packaged 1 files into ${output}`]);
    assert.deepStrictEqual(c.confirmations, [], 'a new output needs no confirmation');
    assert.strictEqual(getOperationLock().active, false, 'the lock is free');
  });

  test('projects and an output given with the command are used without the dialogs, with the same checks', async () => {
    const one = writePackagingProject(root(), 'one');
    const output = path.join(root(), 'release');
    const dialogs = answerPackagingDialogs({});
    runDoes(c, SUCCEED);

    await vscode.commands.executeCommand('the-seed.packageProject', { projects: [one], output });
    await vscode.commands.executeCommand('the-seed.packageProject', { projects: [one], output: root() });

    assert.deepStrictEqual(dialogs, [], 'no dialog');
    assert.deepStrictEqual(c.runs, [{ output, projects: [one], existed: false }]);
    assert.deepStrictEqual(shownBy(c.error), [`Cannot package into "${root()}": it contains the project "${one}".`]);
    assert.deepStrictEqual(c.confirmations, [], 'nothing to confirm');
  });

  test('a project chosen twice, or by two spellings, is packaged once', async () => {
    const one = writePackagingProject(root(), 'one');
    const link = path.join(root(), 'link-to-one');
    let linked = true;
    try {
      fs.symlinkSync(one, link, 'dir');
    } catch {
      linked = false;
    }
    const output = path.join(root(), 'release');
    answerPackagingDialogs({ projects: [one, path.join(one, '..', 'one'), one + path.sep, ...(linked ? [link] : [])], output });
    runDoes(c, SUCCEED);

    await vscode.commands.executeCommand('the-seed.packageProject');

    assert.deepStrictEqual(c.runs.map((run) => run.projects), [[one]]);
  });

  const dismissals: { name: string; dialogs: () => { projects?: string[]; output?: string } }[] = [
    { name: 'the project dialog', dialogs: () => ({}) },
    { name: 'the output dialog', dialogs: () => ({ projects: [path.join(root(), 'one')] }) },
  ];

  for (const { name, dialogs } of dismissals) {
    test(`dismissing ${name} packages nothing, shows nothing and leaves the lock free`, async () => {
      writePackagingProject(root(), 'one');
      const before = readTree(root());
      answerPackagingDialogs(dialogs());

      await vscode.commands.executeCommand('the-seed.packageProject');

      assert.ok(c.packageRun.notCalled, 'Package.run is not called');
      assert.ok(c.error.notCalled && c.warning.notCalled && c.info.notCalled, 'no message');
      assert.deepStrictEqual(readTree(root()), before, 'the workspace is unchanged');
      assert.strictEqual(getOperationLock().active, false, 'the lock is free');
    });
  }

  test('confirming the project dialog with nothing chosen is refused', async () => {
    const before = readTree(root());
    const dialogs = answerPackagingDialogs({ projects: [], output: path.join(root(), 'release') });

    await vscode.commands.executeCommand('the-seed.packageProject');

    assertRefusedBeforeWriting(before, NO_PROJECT_CHOSEN);
    assert.strictEqual(dialogs.length, 1, 'the output dialog is not shown');
  });

  test('a directory without src/Makefile.am is refused, naming it and the tool\'s reason', async () => {
    const one = writePackagingProject(root(), 'one');
    const plain = path.join(root(), 'plain');
    fs.mkdirSync(plain);
    const before = readTree(root());
    const dialogs = answerPackagingDialogs({ projects: [one, plain], output: path.join(root(), 'release') });

    await vscode.commands.executeCommand('the-seed.packageProject');

    assertRefusedBeforeWriting(before, `"${plain}" is not a buildable project: src/Makefile.am not found in ${plain}`);
    assert.strictEqual(dialogs.length, 1, 'the output dialog is not shown');
  });

  test('a directory whose Makefile.am names no program or library is refused, naming it and the tool\'s reason', async () => {
    const odd = writePackagingProject(root(), 'odd', 'SUBDIRS = .\n');
    const before = readTree(root());
    answerPackagingDialogs({ projects: [odd], output: path.join(root(), 'release') });

    await vscode.commands.executeCommand('the-seed.packageProject');

    assertRefusedBeforeWriting(
      before,
      `"${odd}" is not a buildable project: Could not determine binary type from ${path.join(odd, 'src', 'Makefile.am')}`
    );
  });

  test('an output that is a chosen project is refused', async () => {
    const one = writePackagingProject(root(), 'one');
    const before = readTree(root());
    answerPackagingDialogs({ projects: [one], output: one });

    await vscode.commands.executeCommand('the-seed.packageProject');

    assertRefusedBeforeWriting(before, `Cannot package into "${one}": it is the project "${one}".`);
  });

  test('an output that contains a chosen project is refused', async () => {
    const games = path.join(root(), 'games');
    fs.mkdirSync(games);
    const one = writePackagingProject(games, 'one');
    const before = readTree(root());
    answerPackagingDialogs({ projects: [one], output: games });

    await vscode.commands.executeCommand('the-seed.packageProject');

    assertRefusedBeforeWriting(before, `Cannot package into "${games}": it contains the project "${one}".`);
  });

  test('the workspace folder chosen as the output is refused', async () => {
    const outside = writePackagingProject(fs.realpathSync(state.dir('elsewhere')), 'outside');
    const before = readTree(root());
    answerPackagingDialogs({ projects: [outside], output: root() });

    await vscode.commands.executeCommand('the-seed.packageProject');

    assertRefusedBeforeWriting(before, `Cannot package into "${root()}": it contains the workspace folder "${root()}".`);
  });

  test('an output that contains the second folder of a multi-root workspace is refused', async () => {
    const outer = fs.realpathSync(state.dir('outer'));
    const second = path.join(outer, 'second');
    fs.mkdirSync(second);
    state.setWorkspaceFolders([state.workspaceFolders[0], second]);
    const one = writePackagingProject(root(), 'one');
    const before = readTree(outer);
    answerPackagingDialogs({ projects: [one], output: outer });

    await vscode.commands.executeCommand('the-seed.packageProject');

    assert.deepStrictEqual(shownBy(c.error), [`Cannot package into "${outer}": it contains the workspace folder "${second}".`]);
    assert.ok(c.packageRun.notCalled, 'Package.run is not called');
    assert.deepStrictEqual(readTree(outer), before, 'nothing is touched');
  });

  test('an output that is a file is refused', async () => {
    const one = writePackagingProject(root(), 'one');
    const file = path.join(root(), 'notes.txt');
    fs.writeFileSync(file, 'keep me');
    const before = readTree(root());
    answerPackagingDialogs({ projects: [one], output: file });

    await vscode.commands.executeCommand('the-seed.packageProject');

    assertRefusedBeforeWriting(before, `Cannot package into "${file}": it is a file.`);
  });

  test('an output inside a project is allowed', async () => {
    const one = writePackagingProject(root(), 'one');
    const output = path.join(one, 'dist');
    answerPackagingDialogs({ projects: [one], output });
    runDoes(c, SUCCEED);

    await vscode.commands.executeCommand('the-seed.packageProject');

    assert.deepStrictEqual(c.runs, [{ output, projects: [one], existed: false }]);
    assert.deepStrictEqual(shownBy(c.error), []);
  });

  test('a project outside the workspace is allowed', async () => {
    const outside = writePackagingProject(fs.realpathSync(state.dir('elsewhere')), 'outside');
    const output = path.join(root(), 'release');
    answerPackagingDialogs({ projects: [outside], output });
    runDoes(c, SUCCEED);

    await vscode.commands.executeCommand('the-seed.packageProject');

    assert.deepStrictEqual(c.runs.map((run) => run.projects), [[outside]]);
  });

  test('names with spaces work end to end', async () => {
    const game = writePackagingProject(root(), 'my game');
    const output = path.join(root(), 'release files');
    answerPackagingDialogs({ projects: [game], output });
    runDoes(c, SUCCEED);

    await vscode.commands.executeCommand('the-seed.packageProject');

    assert.deepStrictEqual(c.runs, [{ output, projects: [game], existed: false }]);
    assert.deepStrictEqual(shownBy(c.info), [`Packaged 1 files into ${output}`]);
    assert.deepStrictEqual([...readTree(output).keys()], ['new']);
  });

  test('while another operation holds the lock: refused before any dialog', async () => {
    const held = acquireOperationLock('build');
    assert.ok(held.success, 'the case holds the lock');
    const dialogs = answerPackagingDialogs({});

    await vscode.commands.executeCommand('the-seed.packageProject');

    assert.deepStrictEqual(shownBy(c.warning), ['Cannot package while a build operation is in progress.']);
    assert.deepStrictEqual(dialogs, [], 'no dialog');
    assert.strictEqual(getOperationLock().abortController, held.abortController, 'the holder is unchanged');
  });

  test('with no prefix: refused before any dialog', async () => {
    sinon.stub(testTool().Config.prototype, 'loadConfig').callsFake(function (this: { config: { prefix: string } }) {
      this.config.prefix = '';
    });
    const dialogs = answerPackagingDialogs({});

    await vscode.commands.executeCommand('the-seed.packageProject');

    assert.deepStrictEqual(shownBy(c.error), [NO_PREFIX]);
    assert.deepStrictEqual(dialogs, [], 'no dialog');
    assert.strictEqual(getOperationLock().active, false, 'the lock is free');
  });

  test('with no folder open: refused before any dialog', async () => {
    state.setWorkspaceFolders([]);
    const dialogs = answerPackagingDialogs({});

    await vscode.commands.executeCommand('the-seed.packageProject');

    assert.deepStrictEqual(shownBy(c.error), ['No workspace folder open. Open a project folder first.']);
    assert.deepStrictEqual(dialogs, [], 'no dialog');
  });

  test('a missing native component: the tool\'s message, before any dialog', async () => {
    const missing = new (testTool().NativeComponentMissingError)();
    // Put back the tool the case's setup gave the extension, which finds the native component
    (activeToolService().acquire as unknown as sinon.SinonStub).restore();
    await useToolApi({ ...testTool(), requireNativeComponent: () => { throw missing; } } as ToolApi);
    const before = readTree(root());
    const dialogs = answerPackagingDialogs({});

    await vscode.commands.executeCommand('the-seed.packageProject');

    assert.deepStrictEqual(shownBy(c.error), [`Packaging failed: ${missing.message}`]);
    assert.deepStrictEqual(dialogs, [], 'no dialog');
    assert.ok(c.packageRun.notCalled, 'Package.run is not called');
    assert.deepStrictEqual(readTree(root()), before, 'nothing is touched');
    assert.strictEqual(getOperationLock().active, false, 'the lock is free');
  });
});

suite('Packaging Commands: existing output', function () {
  this.timeout(60000);
  const state = useScratchState({ workspaceFolders: 1 });
  const c = usePackagingCase();

  let project: string;
  let output: string;

  setup(() => {
    project = writePackagingProject(fs.realpathSync(state.workspaceFolders[0]), 'game');
    output = path.join(fs.realpathSync(state.dir('out')), 'release');
    answerPackagingDialogs({ projects: [project], output });
  });

  test('a new empty output needs no confirmation, and a refusal leaves it empty', async () => {
    fs.mkdirSync(output);
    runDoes(c, REFUSE);

    await vscode.commands.executeCommand('the-seed.packageProject');

    assert.deepStrictEqual(c.confirmations, [], 'no confirmation');
    assert.deepStrictEqual(c.runs, [{ output, projects: [project], existed: false }], 'the run proceeds with the output out of the way');
    assert.ok(fs.statSync(output).isDirectory(), 'the empty output is still there');
    assert.deepStrictEqual(fs.readdirSync(output), [], 'and still empty');
    assert.deepStrictEqual(leftAside(output), [], 'no aside is left');
    assert.deepStrictEqual(shownBy(c.error), ['Packaging failed: stubbed refusal']);
  });

  test('an empty output with a succeeding run gets the new result', async () => {
    fs.mkdirSync(output);
    runDoes(c, SUCCEED);

    await vscode.commands.executeCommand('the-seed.packageProject');

    assert.deepStrictEqual(c.confirmations, [], 'no confirmation');
    assert.deepStrictEqual([...readTree(output).keys()], ['new']);
  });

  test('an output that holds files asks first, before the lock is taken and before anything is written', async () => {
    const before = writePreviousOutput(output);

    await vscode.commands.executeCommand('the-seed.packageProject');

    assert.deepStrictEqual(c.confirmations, [
      { text: replaceWarning(output), modal: true, items: [REPLACE_CONTENTS], lockFree: true },
    ]);
    assert.strictEqual(
      replaceWarning(output),
      `"${output}" already holds files. Packaging will replace everything in it with the new result; if packaging fails, the current contents are put back.`
    );
    assert.ok(c.packageRun.notCalled, 'dismissed: Package.run is not called');
    assert.deepStrictEqual(readTree(output), before, 'the output is unchanged');
    assert.deepStrictEqual(leftAside(output), [], 'nothing was moved aside');
    assert.ok(c.error.notCalled && c.info.notCalled, 'no further message');
    assert.strictEqual(getOperationLock().active, false, 'the lock is free');
  });

  test('declining with Cancel packages nothing', async () => {
    const before = writePreviousOutput(output);
    c.confirm = 'Cancel';

    await vscode.commands.executeCommand('the-seed.packageProject');

    assert.ok(c.packageRun.notCalled, 'Package.run is not called');
    assert.deepStrictEqual(readTree(output), before, 'the output is unchanged');
  });

  const unsuccessful: { name: string; act: (output: string) => Promise<PackageRunResult>; shown: string }[] = [
    { name: 'refuses', act: REFUSE, shown: 'Packaging failed: stubbed refusal' },
    {
      name: 'fails after writing part of the output',
      act: async (out) => {
        fs.mkdirSync(out, { recursive: true });
        fs.writeFileSync(path.join(out, 'partial'), 'half a copy');
        return packageResult(out, false, 'stubbed copy failure');
      },
      shown: 'Packaging failed: stubbed copy failure',
    },
    {
      name: 'throws after writing part of the output',
      act: async (out) => {
        fs.mkdirSync(out, { recursive: true });
        fs.writeFileSync(path.join(out, 'partial'), 'half a copy');
        throw new Error('stubbed packaging throw');
      },
      shown: 'Packaging failed: stubbed packaging throw',
    },
  ];

  for (const { name, act, shown } of unsuccessful) {
    test(`confirmed, then a run that ${name}: the previous output is kept file for file`, async () => {
      const before = writePreviousOutput(output);
      c.confirm = REPLACE_CONTENTS;
      runDoes(c, act);

      await vscode.commands.executeCommand('the-seed.packageProject');

      assert.deepStrictEqual(c.runs, [{ output, projects: [project], existed: false }], 'the previous output is out of the way when the tool runs');
      assert.deepStrictEqual(readTree(output), before, 'the output holds the previous files, contents and modes');
      assert.deepStrictEqual(leftAside(output), [], 'no aside is left');
      assert.deepStrictEqual(shownBy(c.error), [shown]);
      assert.strictEqual(getOperationLock().active, false, 'the lock is free');
    });
  }

  test('confirmed, then a successful run: only the new result is left', async () => {
    writePreviousOutput(output);
    c.confirm = REPLACE_CONTENTS;
    runDoes(c, SUCCEED);

    await vscode.commands.executeCommand('the-seed.packageProject');

    assert.deepStrictEqual([...readTree(output).keys()], ['new'], 'the output holds only the new result');
    assert.strictEqual(fs.readFileSync(path.join(output, 'new'), 'utf-8'), 'the new result');
    assert.deepStrictEqual(leftAside(output), [], 'no aside is left');
    assert.deepStrictEqual(shownBy(c.error), []);
    assert.deepStrictEqual(shownBy(c.info), [`Packaged 1 files into ${output}`]);
    assert.strictEqual(getOperationLock().active, false, 'the lock is free');
  });

  test('an output that does not exist is not left behind by a refusal or a failed run', async () => {
    runDoes(c, REFUSE);
    await vscode.commands.executeCommand('the-seed.packageProject');
    assert.strictEqual(fs.existsSync(output), false, 'no output after a refusal');

    runDoes(c, unsuccessful[1].act);
    await vscode.commands.executeCommand('the-seed.packageProject');
    assert.strictEqual(fs.existsSync(output), false, 'no output after a partial failure');
    assert.deepStrictEqual(fs.readdirSync(path.dirname(output)), [], 'nothing else is left beside it');
  });

  test('when the previous output cannot be moved aside the run is refused and nothing changes', async () => {
    const before = writePreviousOutput(output);
    c.confirm = REPLACE_CONTENTS;
    runDoes(c, REFUSE);
    const allowWrites = refuseWritesIn(path.dirname(output));
    try {
      await vscode.commands.executeCommand('the-seed.packageProject');
    } finally {
      allowWrites();
    }

    const shown = shownBy(c.error);
    assert.strictEqual(shown.length, 1, `one error is shown, got: ${JSON.stringify(shown)}`);
    const prefix = 'Packaging failed: could not move the previous output aside: ';
    assert.ok(
      typeof shown[0] === 'string' && shown[0].startsWith(prefix) && shown[0].length > prefix.length,
      `the error names the move and its reason, got: ${shown[0]}`
    );
    assert.ok(c.packageRun.notCalled, 'Package.run is not called');
    assert.deepStrictEqual(readTree(output), before, 'the output is unchanged');
    assert.deepStrictEqual(fs.readdirSync(path.dirname(output)), ['release'], 'nothing else is beside it');
    assert.strictEqual(getOperationLock().active, false, 'the lock is free');
  });
});

const CONSOLE_METHODS = ['log', 'warn', 'error'] as const;
type ConsoleMethod = typeof CONSOLE_METHODS[number];

/**
 * Puts the case's own accessors on console.log, console.warn and console.error:
 * reads give the current method, and every assignment is recorded (and applied,
 * so code that replaces the console behaves as it would elsewhere). Assignments
 * to the editor host's own console accessors are ignored without trace, so
 * comparing those alone could not show a replacement.
 */
class ConsoleWatch {
  /** Every assignment to a watched method, in order. */
  readonly assignments: ConsoleMethod[] = [];
  /** The descriptors the watch put in place. */
  readonly descriptors = new Map<ConsoleMethod, PropertyDescriptor>();
  private readonly originals = new Map<ConsoleMethod, PropertyDescriptor | undefined>();

  constructor() {
    for (const method of CONSOLE_METHODS) {
      const original = Object.getOwnPropertyDescriptor(console, method);
      this.originals.set(method, original);
      let current: (...args: unknown[]) => void = console[method].bind(console);
      const descriptor: PropertyDescriptor = {
        configurable: true,
        enumerable: original?.enumerable ?? true,
        get: () => current,
        set: (value: (...args: unknown[]) => void) => {
          this.assignments.push(method);
          current = value;
        },
      };
      Object.defineProperty(console, method, descriptor);
      this.descriptors.set(method, descriptor);
    }
  }

  /** Asserts that each method still has the watch's descriptor, field for field. */
  assertUnchanged(when: string): void {
    for (const method of CONSOLE_METHODS) {
      const now = Object.getOwnPropertyDescriptor(console, method);
      const expected = this.descriptors.get(method)!;
      assert.ok(now !== undefined, `console.${method} has a descriptor ${when}`);
      assert.strictEqual(now.get, expected.get, `console.${method}'s getter ${when}`);
      assert.strictEqual(now.set, expected.set, `console.${method}'s setter ${when}`);
      assert.strictEqual(now.configurable, expected.configurable, `console.${method}'s configurable ${when}`);
      assert.strictEqual(now.enumerable, expected.enumerable, `console.${method}'s enumerable ${when}`);
      assert.ok(!('value' in now), `console.${method} is still an accessor ${when}`);
    }
  }

  /** Puts the console's own descriptors back. */
  restore(): void {
    for (const method of CONSOLE_METHODS) {
      const original = this.originals.get(method);
      if (original) {
        Object.defineProperty(console, method, original);
      } else {
        delete (console as unknown as Record<string, unknown>)[method];
      }
    }
  }
}

const OUTSIDE_LINE = 'a line another extension writes with console.log';

/** The packageStatus or installerStatus payloads posted to the sidebar, without their times. */
function statusPosts(recording: { sidebar: unknown[] }, type: string): Record<string, unknown>[] {
  return (recording.sidebar as { type: string; payload: Record<string, unknown> }[])
    .filter((posted) => posted.type === type)
    .map((posted) => {
      const { timestamp: _timestamp, ...rest } = posted.payload;
      return rest;
    });
}

// Packaging and the installer report through the tool's per-run options: the
// console every extension shares is never replaced, a line written to it
// elsewhere stays out of the panel, and calls after the run has ended reach
// nothing.
suite('Packaging Commands: shared console', function () {
  this.timeout(60000);

  const state = useScratchState({ workspaceFolders: 1 });
  let watch: ConsoleWatch | null = null;
  let recorder: Recorder;
  let output: string;

  setup(async () => {
    await packageWithoutNativeCheck();
    const root = fs.realpathSync(state.workspaceFolders[0]);
    output = path.join(root, 'release');
    answerPackagingDialogs({ projects: [writePackagingProject(root, 'game')], output });
    recorder = recordOperation();
    watch = new ConsoleWatch();
    watch.assertUnchanged('before the run');
  });

  teardown(() => {
    watch?.restore();
    watch = null;
  });

  function copyEvent(name: string, index: number, total: number): PackageCopyEvent {
    return { name, source: `/nowhere/${name}`, index, total };
  }

  /** Reports the way the tool does: an outside console line, one line per level and, for packaging, two copies. */
  function report(options: PackageRunOptions | undefined): void {
    watch!.assertUnchanged('during the run');
    console.log(OUTSIDE_LINE);
    options?.log?.('Copying game...', 'info');
    options?.onCopy?.(copyEvent('game', 1, 2));
    options?.log?.('Copying game.sig...', 'info');
    options?.onCopy?.(copyEvent('game.sig', 2, 2));
    options?.log?.('stubbed warning', 'warn');
    options?.log?.('stubbed error', 'error');
  }

  test('packaging reports through its options and leaves the console alone', async () => {
    const run = sinon.stub(testTool().Package.prototype, 'run').callsFake(async (output: string, _dirs: string[], options?: PackageRunOptions) => {
      report(options);
      return packageResult(output, true, null, ['game', 'game.sig']) as never;
    });

    await vscode.commands.executeCommand('the-seed.packageProject');

    assert.strictEqual(run.callCount, 1, 'Package.run is called once');
    assert.deepStrictEqual(watch!.assignments, [], 'no console method is assigned');
    watch!.assertUnchanged('after the run');
    const panel = panelText(recorder);
    assert.ok(!panel.includes(OUTSIDE_LINE), 'the outside console line is not in the panel');
    assert.ok(panel.includes('\nCopying game...\nCopying game.sig...\n[WARNING] stubbed warning\n[ERROR] stubbed error\n'), `the tool's lines are in the panel with their levels, got: ${panel}`);
    assert.deepStrictEqual(statusPosts(recorder, 'packageStatus'), [
      { state: 'running', outputDir: output },
      { state: 'running', currentFile: 'Copying game...', filesCopied: 1, totalFiles: 2 },
      { state: 'running', currentFile: 'Copying game.sig...', filesCopied: 2, totalFiles: 2 },
      { state: 'completed', filesCopied: 2, totalFiles: 2, outputDir: output },
    ]);
    assert.ok(panel.includes(`\n── Packaged 2 files into ${output} ──\n`), 'the panel names the full output path');
    assert.ok(
      recorder.notifications.some((entry) => entry.kind === 'info' && entry.text === `Packaged 2 files into ${output}`),
      'the notification names the full output path'
    );
  });

  test('the installer reports through its options and leaves the console alone', async () => {
    const run = sinon.stub(testTool().Installer.prototype, 'run').callsFake(async (_dir: string, options?: InstallerRunOptions) => {
      report(options);
      return { ok: true, msiPath: '/nowhere/game.msi' } as never;
    });

    await vscode.commands.executeCommand('the-seed.generateWindowsInstaller');

    assert.strictEqual(run.callCount, 1, 'Installer.run is called once');
    assert.deepStrictEqual(watch!.assignments, [], 'no console method is assigned');
    watch!.assertUnchanged('after the run');
    const panel = panelText(recorder);
    assert.ok(!panel.includes(OUTSIDE_LINE), 'the outside console line is not in the panel');
    assert.ok(panel.includes('\nCopying game...\nCopying game.sig...\n[WARNING] stubbed warning\n[ERROR] stubbed error\n'), `the tool's lines are in the panel with their levels, got: ${panel}`);
    assert.deepStrictEqual(statusPosts(recorder, 'installerStatus'), [
      { state: 'running', currentStep: 'Initializing...' },
      { state: 'running', currentStep: 'Copying game...' },
      { state: 'running', currentStep: 'Copying game.sig...' },
      { state: 'running', currentStep: 'stubbed warning' },
      { state: 'running', currentStep: 'stubbed error' },
      { state: 'completed', currentStep: 'Done' },
    ]);
    assert.deepStrictEqual(statusPosts(recorder, 'packageStatus'), [], 'the installer\'s packaging posts no packaging status');
  });

  const lateRuns: { name: string; commandId: string; stub: (keep: (options: PackageRunOptions | undefined) => void) => sinon.SinonStub }[] = [
    {
      name: 'packaging',
      commandId: 'the-seed.packageProject',
      stub: (keep) => sinon.stub(testTool().Package.prototype, 'run').callsFake(async (output: string, _dirs: string[], options?: PackageRunOptions) => {
        keep(options);
        return packageResult(output, false, 'stubbed refusal') as never;
      }),
    },
    {
      name: 'the installer',
      commandId: 'the-seed.generateWindowsInstaller',
      stub: (keep) => sinon.stub(testTool().Installer.prototype, 'run').callsFake(async (_dir: string, options?: InstallerRunOptions) => {
        keep(options);
        return { ok: false, status: 1, message: 'stubbed installer failure' } as never;
      }),
    },
  ];

  for (const { name, commandId, stub } of lateRuns) {
    test(`calls ${name}'s options receive after the run has ended reach nothing`, async () => {
      let kept: PackageRunOptions | undefined;
      const run = stub((options) => { kept = options; });

      await vscode.commands.executeCommand(commandId);

      assert.strictEqual(run.callCount, 1, 'the tool is run once');
      assert.ok(kept?.log, 'the run is given a log');
      recorder.take();
      kept.log('late info line', 'info');
      kept.log('late error line', 'error');
      kept.onCopy?.(copyEvent('late', 1, 1));
      await new Promise((resolve) => setTimeout(resolve, 100));
      const late = recorder.take();
      assert.deepStrictEqual(late.panel, [], 'nothing more reaches the panel');
      assert.deepStrictEqual(late.sidebar, [], 'nothing more reaches the sidebar');
      assert.deepStrictEqual(watch!.assignments, [], 'no console method is assigned');
    });
  }
});

const REAL_SCOPE = '@acme';
const REAL_ENV_KEYS = ['PKG_CONFIG_PATH', 'PKG_CONFIG_LIBDIR', 'MAKEFLAGS', 'MFLAGS'];

type Scaffold = (kind: 'program', channel: vscode.OutputChannel, tool: ToolApi) => Promise<void>;

// A real packaging run on a scratch project scaffolded from the tool's template and
// built for Linux through the palette, with the libraries THE_SEED_TEST_DEPS names,
// as the real build cases do.
suite('Packaging Commands: previous output, real run', function () {
  this.timeout(240000);
  requires('posix-toolchain');
  requires('native-component');
  const state = useScratchState({ scopes: { [REAL_SCOPE]: 'Ada Lovelace' }, workspaceFolders: 1 });

  let savedEnv: Record<string, string | undefined>;
  let info: sinon.SinonStub;
  let error: sinon.SinonStub;
  let warning: sinon.SinonStub;

  setup(async () => {
    savedEnv = {};
    for (const key of REAL_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.PKG_CONFIG_PATH = locateBuildDeps().nativePkgConfig.join(path.delimiter);
    requireProgram('g++', 'install build-essential');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');

    sinon.stub(vscode.window, 'showQuickPick').callsFake(((items: readonly vscode.QuickPickItem[] | string[]) => {
      const labels = (items as readonly (vscode.QuickPickItem | string)[]).map((item) => (typeof item === 'string' ? item : item.label));
      return Promise.resolve(labels.includes('Debug') ? { label: 'Debug' } : REAL_SCOPE);
    }) as never);
    sinon.stub(vscode.window, 'showInputBox').resolves('packprog');
    info = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    // The second run replaces the first one's output, which the user confirms
    warning = sinon.stub(vscode.window, 'showWarningMessage').resolves(REPLACE_CONTENTS as never);
    error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    for (const key of REAL_ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  function shown(stub: sinon.SinonStub): unknown[] {
    return stub.getCalls().map((call) => call.args[0]);
  }

  test('packaging a built project twice gives the same files', async () => {
    const mod = require('../../commands/scaffoldTemplate') as { scaffoldTemplate: Scaffold };
    await mod.scaffoldTemplate('program', vscode.window.createOutputChannel('packaging-real-run-test'), testTool());
    const project = path.join(state.workspaceFolders[0], 'packprog');
    assert.ok(fs.existsSync(path.join(project, 'package.json')), 'the project is created in the workspace folder');
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(project, 'package.json')));
    await vscode.window.showTextDocument(document);

    await vscode.commands.executeCommand('the-seed.buildNative');
    assert.deepStrictEqual(shown(error), [], 'the build shows no error');
    assert.ok(info.calledWith('Build succeeded.'), `the build succeeds; information shown: ${JSON.stringify(shown(info))}`);

    state.setWorkspaceFolders([project]);
    const output = path.join(fs.realpathSync(project), 'dist');
    answerPackagingDialogs({ projects: [project], output });

    info.resetHistory();
    await vscode.commands.executeCommand('the-seed.packageProject');
    assert.deepStrictEqual(shown(error), [], 'the first packaging run shows no error');
    const first = readTree(output);
    assert.ok(first.size > 0, 'the first run writes files');
    assert.deepStrictEqual(shown(info), [`Packaged ${first.size} files into ${output}`]);

    info.resetHistory();
    await vscode.commands.executeCommand('the-seed.packageProject');
    assert.deepStrictEqual(shown(error), [], 'the second packaging run shows no error');
    assert.deepStrictEqual(shown(warning), [replaceWarning(output)], 'only the replace confirmation is shown');
    assert.deepStrictEqual(shown(info), [`Packaged ${first.size} files into ${output}`]);
    assert.deepStrictEqual(readTree(output), first, 'the second dist/ has the same files as the first');
    assert.deepStrictEqual(leftAside(output), [], 'no .dist-previous-* remains');
    assert.strictEqual(getOperationLock().active, false, 'the lock is free');
  });
});
