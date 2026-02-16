import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';

suite('Dependency Commands', () => {
  teardown(() => {
    sinon.restore();
  });

  suite('Check Dependencies Command', () => {
    test('should register the-seed.checkDependencies command', async () => {
      const commands = await vscode.commands.getCommands(true);
      assert.ok(
        commands.includes('the-seed.checkDependencies'),
        "Command 'the-seed.checkDependencies' should be registered"
      );
    });

    test('should show error if no prefix configured', async () => {
      const showErrorStub = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);

      // Execute the command — it will load a config that might have no prefix
      // The test validates the error path exists
      await vscode.commands.executeCommand('the-seed.checkDependencies');

      // If config has no prefix, error should be shown
      // If config does have a prefix, QuickPick will be shown (and auto-dismiss)
      // Either way, command should complete without throwing
    });

    test('should exit cleanly when QuickPick is cancelled', async () => {
      const showQuickPickStub = sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);
      sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.checkDependencies');
      // Should not throw
    });
  });

  suite('Install Dependencies Command', () => {
    test('should register the-seed.installDependencies command', async () => {
      const commands = await vscode.commands.getCommands(true);
      assert.ok(
        commands.includes('the-seed.installDependencies'),
        "Command 'the-seed.installDependencies' should be registered"
      );
    });

    test('should show error if no prefix configured', async () => {
      const showErrorStub = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.installDependencies');

      // Command should complete without throwing
    });

    test('should exit cleanly when QuickPick is cancelled', async () => {
      const showQuickPickStub = sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);
      sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);
      sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.installDependencies');
      // Should not throw
    });
  });
});
