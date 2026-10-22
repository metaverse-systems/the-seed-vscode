import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as sinon from 'sinon';
import { useScratchState } from './helpers/scratchState';
import { writeScopes } from './helpers/scratchHome';

suite('Extension Test Suite', () => {
  const state = useScratchState();

  teardown(() => {
    sinon.restore();
  });

  // T018: Configure Project tests
  suite('Configure Project', () => {
    test('should show input box and save configuration on success', async () => {
      const showInputBoxStub = sinon.stub(vscode.window, 'showInputBox').resolves('/test/prefix');
      const showInfoStub = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.configureProject');

      assert.ok(showInputBoxStub.calledOnce, 'showInputBox should be called once');
      assert.ok(showInfoStub.called, 'showInformationMessage should be called');
    });

    test('should exit cleanly on cancel', async () => {
      const showInputBoxStub = sinon.stub(vscode.window, 'showInputBox').resolves(undefined);
      const showInfoStub = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.configureProject');

      assert.ok(showInputBoxStub.calledOnce, 'showInputBox should be called once');
      assert.ok(!showInfoStub.called, 'showInformationMessage should not be called on cancel');
    });
  });

  // T019: Add Scope tests
  suite('Add Scope', () => {
    test('should prompt for scope details and save on success', async () => {
      const showInputBoxStub = sinon.stub(vscode.window, 'showInputBox');
      showInputBoxStub.onFirstCall().resolves('test-scope');
      showInputBoxStub.onSecondCall().resolves('Test Author');
      showInputBoxStub.onThirdCall().resolves('test@example.com');
      showInputBoxStub.onCall(3).resolves('https://example.com');

      const showInfoStub = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.addScope');

      assert.ok(showInputBoxStub.callCount >= 4, 'showInputBox should be called for all 4 fields');
      assert.ok(showInfoStub.called, 'showInformationMessage should be called on success');
    });

    test('should exit cleanly on cancel at first prompt', async () => {
      const showInputBoxStub = sinon.stub(vscode.window, 'showInputBox').resolves(undefined);
      const showInfoStub = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.addScope');

      assert.ok(showInputBoxStub.calledOnce, 'showInputBox should be called once before cancel');
      assert.ok(!showInfoStub.called, 'showInformationMessage should not be called on cancel');
    });

    test('should warn on duplicate scope and allow overwrite', async () => {
      writeScopes({ '@duplicate-scope': 'Author' });

      // Second: add same scope, expect warning
      const showInputBoxStub2 = sinon.stub(vscode.window, 'showInputBox');
      showInputBoxStub2.onFirstCall().resolves('@duplicate-scope');
      showInputBoxStub2.onSecondCall().resolves('Author 2');
      showInputBoxStub2.onThirdCall().resolves('b@b.com');
      showInputBoxStub2.onCall(3).resolves('https://b.com');

      const showWarningStub = sinon.stub(vscode.window, 'showWarningMessage').resolves('Yes' as any);
      sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.addScope');

      assert.ok(showWarningStub.calledOnce, 'showWarningMessage should be called for duplicate');
    });
  });

  // T020: Delete Scope tests
  suite('Delete Scope', () => {
    test('should show info when no scopes to delete', async () => {
      const showInfoStub = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
      const showQuickPickStub = sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.deleteScope');

      assert.strictEqual(showInfoStub.callCount, 1);
      assert.strictEqual(showInfoStub.firstCall.args[0], 'No scopes to delete.');
      assert.ok(showQuickPickStub.notCalled, 'no scope is offered');
    });

    test('should exit cleanly when user cancels scope selection', async () => {
      writeScopes({ '@del-test-scope': 'Author' });

      // Now try to delete but cancel at QuickPick
      const showQuickPickStub = sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);
      const showWarningStub = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.deleteScope');

      assert.ok(!showWarningStub.called, 'showWarningMessage should not be called after cancel');
    });
  });

  // T023: Add Resource command tests
  suite('Add Resource', () => {
    test('should exit cleanly when file picker is cancelled', async () => {
      // Stub askQuestions to provide scope + pakName
      const showQuickPickStub = sinon.stub(vscode.window, 'showQuickPick').resolves('test-scope' as any);
      const showInputBoxStub = sinon.stub(vscode.window, 'showInputBox').resolves('test-pak');
      sinon.stub(vscode.window, 'showOpenDialog').resolves(undefined);
      const showInfoStub = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.addResource');

      // Should not show success since file picker was cancelled
      assert.ok(!showInfoStub.called, 'showInformationMessage should not be called when file picker is cancelled');
    });

    test('should exit cleanly when resource name input is cancelled', async () => {
      const showQuickPickStub = sinon.stub(vscode.window, 'showQuickPick').resolves('test-scope' as any);
      const showInputBoxStub = sinon.stub(vscode.window, 'showInputBox');
      showInputBoxStub.onFirstCall().resolves('test-pak');
      showInputBoxStub.onSecondCall().resolves(undefined); // Cancel name input
      sinon.stub(vscode.window, 'showOpenDialog').resolves([
        vscode.Uri.file(path.join(state.dir('resource'), 'test-file.txt')),
      ] as any);
      const showInfoStub = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.addResource');

      assert.ok(!showInfoStub.called, 'showInformationMessage should not be called when name input is cancelled');
    });
  });

  // T028: Build ResourcePak command tests
  suite('Build ResourcePak', () => {
    test('should exit cleanly when the folder choice is cancelled', async () => {
      sinon.stub(vscode.window, 'showOpenDialog').resolves(undefined);
      const showInfoStub = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.buildResourcePak');

      // Command should exit without showing success
      assert.ok(!showInfoStub.called, 'showInformationMessage should not be called when cancelled');
    });
  });
});
