// Build commands up to the point where they look for a project: the build mode
// prompt, its dismissal, and the error when the workspace holds no buildable
// project. The operation lock the no-project path leaves held is released by
// the scratch state teardown and is not asserted here.
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { getOperationLock } from '../../operationLock';
import { useScratchState } from '../helpers/scratchState';

const NO_PROJECT_MESSAGE = 'No buildable project found. Open a file in a The Seed project.';

suite('Build Commands', () => {
  useScratchState({ workspaceFolders: 1 });

  setup(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  const noProjectCommands = ['the-seed.buildNativeRecursive', 'the-seed.buildWindowsRecursive', 'the-seed.buildNative'];
  for (const commandId of noProjectCommands) {
    test(`${commandId} with Debug chosen and no buildable project shows the no-project error`, async () => {
      const pick = sinon.stub(vscode.window, 'showQuickPick').resolves({ label: 'Debug' } as vscode.QuickPickItem);
      const findFiles = sinon.stub(vscode.workspace, 'findFiles').resolves([]);
      const error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);

      await vscode.commands.executeCommand(commandId);

      assert.strictEqual(pick.callCount, 1);
      assert.strictEqual(findFiles.callCount, 1, 'the workspace was searched for projects');
      assert.strictEqual(error.callCount, 1);
      assert.strictEqual(error.firstCall.args[0], NO_PROJECT_MESSAGE);
    });
  }

  const dismissCommands = ['the-seed.buildNativeRecursive', 'the-seed.buildNative'];
  for (const commandId of dismissCommands) {
    test(`${commandId} with the build mode prompt dismissed does nothing`, async () => {
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
  }
});
