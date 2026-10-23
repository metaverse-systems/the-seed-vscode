// Packaging commands: no workspace folder open, and the installer's prefix check and operation lock.
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { acquireOperationLock, getOperationLock } from '../../operationLock';
import type { OperationType } from '../../operationLock';
import { TheSeedViewProvider } from '../../panels/TheSeedViewProvider';
import { activeToolService } from '../../tool/toolService';
import { useScratchState } from '../helpers/scratchState';
import { testTool } from '../helpers/tool';
import { fakeView, until } from '../helpers/fakeView';

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
