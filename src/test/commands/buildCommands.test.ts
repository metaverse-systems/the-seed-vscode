// Build commands through the command registry, up to the point where a build
// starts: the build mode prompt and its dismissal, the project search and its
// dismissal, the error when the workspace holds no buildable project, and the
// refusals while another operation holds the lock. Each path that does not
// build leaves the operation lock free, so the next build or installation is
// not refused; a successful build and a failure before the first step release
// it too.
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as fs from 'fs';
import * as path from 'path';
import { acquireOperationLock, getOperationLock } from '../../operationLock';
import { useScratchState } from '../helpers/scratchState';
import { requires } from '../harness/platform';
import { testTool } from '../helpers/tool';

const NO_PROJECT_MESSAGE = 'No buildable project found. Open a file in a The Seed project.';

suite('Build Commands', () => {
  const state = useScratchState({ workspaceFolders: 1 });

  setup(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  const plainCommands = ['the-seed.buildNative', 'the-seed.buildWindows', 'the-seed.buildIncremental'];
  const allCommands = [...plainCommands, 'the-seed.buildNativeRecursive', 'the-seed.buildWindowsRecursive'];
  const DEBUG = { label: 'Debug' } as vscode.QuickPickItem;
  const INSTALL_PROMPT = 'Select target platform';

  /** Writes a buildable package.json in a new directory of the workspace folder and returns the directory. */
  function writeProject(name: string): string {
    const dir = path.join(state.workspaceFolders[0], name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name, scripts: { build: 'the-seed build native' } })
    );
    return dir;
  }

  function foundBy(dirs: string[]): sinon.SinonStub {
    return sinon.stub(vscode.workspace, 'findFiles').resolves(dirs.map((dir) => vscode.Uri.file(path.join(dir, 'package.json'))));
  }

  /** Build mode Debug on the first prompt, then whatever `later` answers for any other prompt. */
  function modeThen(later: unknown): sinon.SinonStub {
    const pick = sinon.stub(vscode.window, 'showQuickPick');
    pick.onFirstCall().resolves(DEBUG);
    pick.resolves(later as vscode.QuickPickItem | undefined);
    return pick;
  }

  /** Installing dependencies must get as far as its own target prompt, which the build did not block. */
  async function assertInstallNotBlocked(): Promise<void> {
    const pick = sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);
    const warning = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);

    await vscode.commands.executeCommand('the-seed.installDependencies');

    assert.ok(
      pick.getCalls().some((call) => (call.args[1] as vscode.QuickPickOptions | undefined)?.placeHolder === INSTALL_PROMPT),
      'the install target prompt was shown'
    );
    assert.ok(
      !warning.getCalls().some((call) => String(call.args[0]).includes('Cannot install dependencies')),
      'no refusal naming a build'
    );
    pick.restore();
    warning.restore();
  }

  for (const commandId of allCommands) {
    suite(commandId, () => {
      test('with Debug chosen and no buildable project shows the no-project error each time and leaves the lock free', async () => {
        sinon.stub(vscode.window, 'showQuickPick').resolves(DEBUG);
        sinon.stub(vscode.workspace, 'findFiles').resolves([]);
        const error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
        const warning = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);

        for (let run = 1; run <= 2; run++) {
          await vscode.commands.executeCommand(commandId);

          assert.strictEqual(error.callCount, run, `the error was shown on run ${run}`);
          assert.strictEqual(error.lastCall.args[0], NO_PROJECT_MESSAGE);
          assert.ok(warning.notCalled, 'no "already in progress" warning');
          assert.strictEqual(getOperationLock().active, false, `the lock is not held after run ${run}`);
        }
      });

      test('with two buildable projects and the project choice dismissed shows nothing and leaves the lock free', async () => {
        foundBy([writeProject('one'), writeProject('two')]);
        modeThen(undefined);
        const error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
        const warning = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);

        await vscode.commands.executeCommand(commandId);

        assert.ok(error.notCalled, 'no error');
        assert.ok(warning.notCalled, 'no warning');
        assert.strictEqual(getOperationLock().active, false, 'the lock is not held');
      });

      test('with the build mode prompt dismissed does nothing', async () => {
        sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);
        const findFiles = sinon.stub(vscode.workspace, 'findFiles').resolves([]);
        const error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
        const warning = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);
        const info = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);

        await vscode.commands.executeCommand(commandId);

        assert.ok(findFiles.notCalled, 'no project search');
        assert.ok(error.notCalled && warning.notCalled && info.notCalled, 'no message shown');
        assert.strictEqual(getOperationLock().active, false, 'the lock is not held');
      });

      test('while an install holds the lock warns without a build mode prompt', async () => {
        const held = acquireOperationLock('install');
        assert.ok(held.success, 'the install lock is taken for the case');
        const pick = sinon.stub(vscode.window, 'showQuickPick').resolves(DEBUG);
        const warning = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);

        await vscode.commands.executeCommand(commandId);

        assert.strictEqual(warning.callCount, 1);
        assert.strictEqual(warning.firstCall.args[0], 'Cannot build while an install operation is in progress.');
        assert.ok(pick.notCalled, 'no build mode prompt');
        const lock = getOperationLock();
        assert.strictEqual(lock.type, 'install');
        assert.strictEqual(lock.abortController, held.abortController);
      });

      test('while a packaging run holds the lock warns that packaging is running and leaves the lock alone', async () => {
        const held = acquireOperationLock('package');
        assert.ok(held.success, 'the package lock is taken for the case');
        sinon.stub(vscode.window, 'showQuickPick').resolves(DEBUG);
        const warning = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);

        await vscode.commands.executeCommand(commandId);

        assert.strictEqual(warning.callCount, 1);
        assert.strictEqual(warning.firstCall.args[0], 'Cannot build while a packaging operation is in progress.');
        const lock = getOperationLock();
        assert.strictEqual(lock.type, 'package');
        assert.strictEqual(lock.abortController, held.abortController);
      });

      suite('then installing dependencies', () => {
        requires('posix-toolchain');

        test('after the no-project run reaches the install target prompt', async () => {
          sinon.stub(vscode.window, 'showQuickPick').resolves(DEBUG);
          sinon.stub(vscode.workspace, 'findFiles').resolves([]);
          sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
          await vscode.commands.executeCommand(commandId);
          sinon.restore();

          await assertInstallNotBlocked();
        });

        test('after the dismissed project choice reaches the install target prompt', async () => {
          foundBy([writeProject('one'), writeProject('two')]);
          modeThen(undefined);
          await vscode.commands.executeCommand(commandId);
          sinon.restore();

          await assertInstallNotBlocked();
        });
      });
    });
  }

  for (const commandId of plainCommands) {
    test(`${commandId} builds again with one buildable project after a run with no project`, async () => {
      const buildProject = sinon
        .stub(testTool().Build.prototype, 'buildProject')
        .resolves({ status: 'completed' } as never);
      const pick = sinon.stub(vscode.window, 'showQuickPick').resolves(DEBUG);
      const findFiles = sinon.stub(vscode.workspace, 'findFiles').resolves([]);
      const error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      const info = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
      await vscode.commands.executeCommand(commandId);
      assert.strictEqual(error.callCount, 1, 'the no-project error was shown');
      assert.ok(buildProject.notCalled, 'nothing was built');

      const dir = writeProject('game');
      findFiles.resolves([vscode.Uri.file(path.join(dir, 'package.json'))]);
      await vscode.commands.executeCommand(commandId);

      assert.strictEqual(pick.callCount, 2);
      assert.strictEqual(buildProject.callCount, 1);
      assert.strictEqual(buildProject.firstCall.args[0].projectDir, dir);
      assert.ok(info.getCalls().some((call) => call.args[0] === 'Build succeeded.'), 'success shown');
      assert.strictEqual(getOperationLock().active, false, 'the lock is released afterwards');
    });
  }

  test('the-seed.buildNative with a configuration that fails to load shows the error and leaves the lock free', async () => {
    const dir = writeProject('game');
    foundBy([dir]);
    sinon.stub(vscode.window, 'showQuickPick').resolves(DEBUG);
    sinon.stub(testTool().Config.prototype, 'loadConfig').throws(new Error('config unreadable'));
    const error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);

    await vscode.commands.executeCommand('the-seed.buildNative');

    assert.strictEqual(error.callCount, 1);
    assert.ok(String(error.firstCall.args[0]).includes('config unreadable'), 'the failure is reported');
    assert.strictEqual(getOperationLock().active, false, 'the lock is not held');
  });
});
