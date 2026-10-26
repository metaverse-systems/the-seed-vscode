// Packaging commands: no workspace folder open, the installer's prefix check and
// operation lock, the previous packaging output kept unless a run produces a
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
import { testTool } from '../helpers/tool';
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

/** Writes PREVIOUS_OUTPUT into <projectDir>/dist and returns its tree. */
function writePreviousOutput(projectDir: string): Map<string, { mode: number; bytes: string | null }> {
  const outputDir = path.join(projectDir, 'dist');
  fs.mkdirSync(outputDir);
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

/** The moved-aside directories left in a project. */
function leftAside(projectDir: string): string[] {
  return fs.readdirSync(projectDir).filter((name) => name.startsWith('.dist-previous-'));
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

suite('Packaging Commands: previous output', function () {
  this.timeout(60000);
  const state = useScratchState({ workspaceFolders: 1 });

  let warning: sinon.SinonStub;
  let error: sinon.SinonStub;
  let info: sinon.SinonStub;
  let packageRun: sinon.SinonStub;
  /** Whether the output directory existed each time Package.run was called (the tool refuses one that does). */
  let existedAtRun: boolean[];
  /** The output directory each Package.run call was given. */
  let outputDirs: string[];

  setup(() => {
    warning = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);
    error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
    info = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    existedAtRun = [];
    outputDirs = [];
    packageRun = sinon.stub(testTool().Package.prototype, 'run');
  });

  function projectDir(): string {
    return state.workspaceFolders[0];
  }

  function outputDir(): string {
    return path.join(projectDir(), 'dist');
  }

  /** Makes Package.run record its call, then do what `act` does with the output directory it was given. */
  function runDoes(act: (output: string) => Promise<PackageRunResult>): void {
    packageRun.callsFake(async (output: string) => {
      outputDirs.push(output);
      existedAtRun.push(fs.existsSync(output));
      return act(output);
    });
  }

  function errors(): unknown[] {
    return error.getCalls().map((call) => call.args[0]);
  }

  const unsuccessful: { name: string; act: (output: string) => Promise<PackageRunResult>; shown: string }[] = [
    {
      name: 'refuses',
      act: async (output) => packageResult(output, false, 'stubbed refusal'),
      shown: 'Packaging failed: stubbed refusal',
    },
    {
      name: 'fails after writing part of the output',
      act: async (output) => {
        fs.mkdirSync(output, { recursive: true });
        fs.writeFileSync(path.join(output, 'partial'), 'half a copy');
        return packageResult(output, false, 'stubbed copy failure');
      },
      shown: 'Packaging failed: stubbed copy failure',
    },
    {
      name: 'throws after writing part of the output',
      act: async (output) => {
        fs.mkdirSync(output, { recursive: true });
        fs.writeFileSync(path.join(output, 'partial'), 'half a copy');
        throw new Error('stubbed packaging throw');
      },
      shown: 'Packaging failed: stubbed packaging throw',
    },
  ];

  for (const { name, act, shown } of unsuccessful) {
    test(`a run that ${name} keeps the previous output file for file`, async () => {
      const before = writePreviousOutput(projectDir());
      runDoes(act);

      await vscode.commands.executeCommand('the-seed.packageProject');

      assert.strictEqual(packageRun.callCount, 1, 'Package.run is called once');
      assert.deepStrictEqual(outputDirs, [outputDir()], 'the tool is given <project>/dist');
      assert.deepStrictEqual(existedAtRun, [false], 'the previous output is out of the way when the tool runs');
      assert.ok(fs.existsSync(outputDir()), 'dist/ exists afterwards');
      assert.deepStrictEqual(readTree(outputDir()), before, 'dist/ holds the previous output, contents and modes');
      assert.deepStrictEqual(leftAside(projectDir()), [], 'no .dist-previous-* remains');
      assert.deepStrictEqual(errors(), [shown]);
      assert.ok(warning.notCalled, 'no warning is shown');
      assert.strictEqual(getOperationLock().active, false, 'the lock is free');
    });
  }

  test('a successful run leaves only the new result', async () => {
    writePreviousOutput(projectDir());
    runDoes(async (output) => {
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(path.join(output, 'new'), 'the new result');
      return packageResult(output, true, null, ['new']);
    });

    await vscode.commands.executeCommand('the-seed.packageProject');

    assert.deepStrictEqual(existedAtRun, [false], 'the previous output is out of the way when the tool runs');
    assert.deepStrictEqual([...readTree(outputDir()).keys()], ['new'], 'dist/ holds only the new result');
    assert.strictEqual(fs.readFileSync(path.join(outputDir(), 'new'), 'utf-8'), 'the new result');
    assert.deepStrictEqual(leftAside(projectDir()), [], 'no .dist-previous-* remains');
    assert.deepStrictEqual(errors(), [], 'no error is shown');
    assert.deepStrictEqual(info.getCalls().map((call) => call.args[0]), ['Packaged 1 files into dist/']);
    assert.strictEqual(getOperationLock().active, false, 'the lock is free');
  });

  test('a refusal with no previous output leaves no dist/ and nothing else in the project', async () => {
    runDoes(async (output) => packageResult(output, false, 'stubbed refusal'));

    await vscode.commands.executeCommand('the-seed.packageProject');

    assert.strictEqual(packageRun.callCount, 1, 'Package.run is called once');
    assert.deepStrictEqual(fs.readdirSync(projectDir()), [], 'the project holds nothing');
    assert.deepStrictEqual(errors(), ['Packaging failed: stubbed refusal']);
    assert.strictEqual(getOperationLock().active, false, 'the lock is free');
  });

  test('when the previous output cannot be moved aside the run is refused and nothing changes', async () => {
    const before = writePreviousOutput(projectDir());
    runDoes(async (output) => packageResult(output, false, 'stubbed refusal'));
    const allowWrites = refuseWritesIn(projectDir());
    try {
      await vscode.commands.executeCommand('the-seed.packageProject');
    } finally {
      allowWrites();
    }

    const shown = errors();
    assert.strictEqual(shown.length, 1, `one error is shown, got: ${JSON.stringify(shown)}`);
    const prefix = 'Packaging failed: could not move the previous output aside: ';
    assert.ok(
      typeof shown[0] === 'string' && shown[0].startsWith(prefix) && shown[0].length > prefix.length,
      `the error names the move and its reason, got: ${shown[0]}`
    );
    assert.ok(packageRun.notCalled, 'Package.run is not called');
    assert.deepStrictEqual(readTree(outputDir()), before, 'dist/ is unchanged');
    assert.deepStrictEqual(fs.readdirSync(projectDir()), ['dist'], 'nothing else is in the project');
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
  useScratchState({ workspaceFolders: 1 });

  let watch: ConsoleWatch | null = null;
  let recorder: Recorder;

  setup(() => {
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
      { state: 'running' },
      { state: 'running', currentFile: 'Copying game...', filesCopied: 1, totalFiles: 2 },
      { state: 'running', currentFile: 'Copying game.sig...', filesCopied: 2, totalFiles: 2 },
      { state: 'completed', filesCopied: 2, totalFiles: 2 },
    ]);
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
    warning = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);
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
    const output = path.join(project, 'dist');

    info.resetHistory();
    await vscode.commands.executeCommand('the-seed.packageProject');
    assert.deepStrictEqual(shown(error), [], 'the first packaging run shows no error');
    const first = readTree(output);
    assert.ok(first.size > 0, 'the first run writes files');
    assert.deepStrictEqual(shown(info), [`Packaged ${first.size} files into dist/`]);

    info.resetHistory();
    await vscode.commands.executeCommand('the-seed.packageProject');
    assert.deepStrictEqual(shown(error), [], 'the second packaging run shows no error');
    assert.deepStrictEqual(shown(warning), [], 'no warning is shown');
    assert.deepStrictEqual(shown(info), [`Packaged ${first.size} files into dist/`]);
    assert.deepStrictEqual(readTree(output), first, 'the second dist/ has the same files as the first');
    assert.deepStrictEqual(leftAside(project), [], 'no .dist-previous-* remains');
    assert.strictEqual(getOperationLock().active, false, 'the lock is free');
  });
});
