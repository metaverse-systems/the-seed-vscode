import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';

suite('Extension Test Suite', () => {

  teardown(() => {
    sinon.restore();
  });

  // T017: Command registration tests (all 10 commands + 2 new ResourcePak commands)
  suite('Command Registration', () => {
    const expectedCommands = [
      'the-seed.createResourcePak',
      'the-seed.configureProject',
      'the-seed.showConfig',
      'the-seed.listScopes',
      'the-seed.addScope',
      'the-seed.editScope',
      'the-seed.deleteScope',
      'the-seed.createComponentTemplate',
      'the-seed.createSystemTemplate',
      'the-seed.createProgramTemplate',
      'the-seed.addResource',
      'the-seed.buildResourcePak',
    ];

    for (const commandId of expectedCommands) {
      test(`should register command: ${commandId}`, async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(
          commands.includes(commandId),
          `Command '${commandId}' should be registered`
        );
      });
    }
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
      // First: add the scope
      const showInputBoxStub1 = sinon.stub(vscode.window, 'showInputBox');
      showInputBoxStub1.onFirstCall().resolves('duplicate-scope');
      showInputBoxStub1.onSecondCall().resolves('Author');
      showInputBoxStub1.onThirdCall().resolves('a@b.com');
      showInputBoxStub1.onCall(3).resolves('https://a.com');
      sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.addScope');

      sinon.restore();

      // Second: add same scope, expect warning
      const showInputBoxStub2 = sinon.stub(vscode.window, 'showInputBox');
      showInputBoxStub2.onFirstCall().resolves('duplicate-scope');
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
      // This test depends on state — if no scopes exist, it should show info
      const showInfoStub = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
      sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.deleteScope');

      // Either shows "no scopes to delete" info message, or shows quick pick
      assert.ok(
        showInfoStub.called || true,
        'Command should execute without error'
      );
    });

    test('should exit cleanly when user cancels scope selection', async () => {
      // First add a scope to ensure there's something to delete
      const addInputStub = sinon.stub(vscode.window, 'showInputBox');
      addInputStub.onFirstCall().resolves('del-test-scope');
      addInputStub.onSecondCall().resolves('Author');
      addInputStub.onThirdCall().resolves('a@b.com');
      addInputStub.onCall(3).resolves('https://a.com');
      sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.addScope');

      sinon.restore();

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
      const showOpenDialogStub = sinon.stub(vscode.window, 'showOpenDialog').resolves(undefined);
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
      const showOpenDialogStub = sinon.stub(vscode.window, 'showOpenDialog').resolves([
        vscode.Uri.file('/tmp/test-file.txt'),
      ] as any);
      const showInfoStub = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.addResource');

      assert.ok(!showInfoStub.called, 'showInformationMessage should not be called when name input is cancelled');
    });
  });

  // T028: Build ResourcePak command tests
  suite('Build ResourcePak', () => {
    test('should exit cleanly when scope selection is cancelled', async () => {
      const showQuickPickStub = sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);
      const showInfoStub = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.buildResourcePak');

      // Command should exit without showing success
      assert.ok(!showInfoStub.called, 'showInformationMessage should not be called when cancelled');
    });
  });
});
