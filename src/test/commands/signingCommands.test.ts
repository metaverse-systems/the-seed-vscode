// Signing commands that need no native call: the refusals when no file is
// available, the offer made when a scope has no certificate, and the cancelled
// export. Each case runs against a scratch home with one scope, so the scope is
// chosen without a prompt.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { createCertFor } from '../helpers/scratchHome';
import { useScratchState } from '../helpers/scratchState';

const NO_FILE_MESSAGE = 'No file selected. Open a file or use the context menu.';

function listFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        found.push(full);
      }
    }
  };
  walk(root);
  return found.sort();
}

suite('Signing Commands', () => {
  const state = useScratchState({ scopes: { '@only': 'Only Author' } });

  suite('with a certificate and no file', () => {
    setup(async () => {
      await createCertFor('@only');
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    test('signFile with no file selected and no active editor shows the no-file error', async () => {
      const error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.signFile');

      assert.strictEqual(error.callCount, 1);
      assert.strictEqual(error.firstCall.args[0], NO_FILE_MESSAGE);
    });

    test('verifySignature with no file selected and no active editor shows the no-file error', async () => {
      const error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.verifySignature');

      assert.strictEqual(error.callCount, 1);
      assert.strictEqual(error.firstCall.args[0], NO_FILE_MESSAGE);
    });

    test('exportSigningCert with the save dialog dismissed shows the dialog once and writes nothing', async () => {
      const dialog = sinon.stub(vscode.window, 'showSaveDialog').resolves(undefined);
      const info = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
      const error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      const before = listFiles(state.home);

      await vscode.commands.executeCommand('the-seed.exportSigningCert');

      assert.strictEqual(dialog.callCount, 1);
      assert.ok(info.notCalled, 'no information message');
      assert.ok(error.notCalled, 'no error message');
      assert.deepStrictEqual(listFiles(state.home), before);
    });
  });

  suite('without a certificate', () => {
    test('signingCertInfo offers Create and Import, and dismissing runs nothing', async () => {
      const info = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
      const original = vscode.commands.executeCommand;
      const executed: string[] = [];
      sinon.stub(vscode.commands, 'executeCommand').callsFake((id: string, ...args: unknown[]) => {
        executed.push(id);
        return original.call(vscode.commands, id, ...args);
      });

      await vscode.commands.executeCommand('the-seed.signingCertInfo');

      assert.strictEqual(info.callCount, 1);
      assert.deepStrictEqual(info.firstCall.args, ['No signing certificate found.', 'Create', 'Import']);
      assert.ok(!executed.includes('the-seed.createSigningCert'), 'create was not run');
      assert.ok(!executed.includes('the-seed.importSigningCert'), 'import was not run');
    });
  });
});
