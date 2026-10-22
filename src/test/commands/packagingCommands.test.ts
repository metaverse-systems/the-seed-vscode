// Packaging commands with no workspace folder open.
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { getOperationLock } from '../../operationLock';
import { useScratchState } from '../helpers/scratchState';

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
