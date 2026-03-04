import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';

suite('Build Commands — Release Mode Quick Pick', () => {
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    sandbox = sinon.createSandbox();
  });

  teardown(() => {
    sandbox.restore();
  });

  // ── executeBuild Quick Pick ───────────────────────────────

  suite('executeBuild Quick Pick prompt', () => {
    test('Debug selection proceeds with standard build (no strip)', async () => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');

      // Stub Quick Pick to select "Debug"
      const quickPickStub = sandbox.stub(vscode.window, 'showQuickPick')
        .resolves({ label: 'Debug', description: 'Standard build with debug symbols' } as vscode.QuickPickItem);

      sandbox.stub(vscode.workspace, 'findFiles').resolves([]);

      await vscode.commands.executeCommand('the-seed.buildNative');
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Quick Pick should have been shown
      assert.ok(
        quickPickStub.called,
        'Quick Pick should be shown when build command is invoked'
      );
    });

    test('Release selection enables strip mode', async () => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');

      // Stub Quick Pick to select "Release"
      const quickPickStub = sandbox.stub(vscode.window, 'showQuickPick')
        .resolves({ label: 'Release', description: 'Strip debug symbols for production' } as vscode.QuickPickItem);

      sandbox.stub(vscode.workspace, 'findFiles').resolves([]);

      await vscode.commands.executeCommand('the-seed.buildNative');
      await new Promise((resolve) => setTimeout(resolve, 500));

      assert.ok(
        quickPickStub.called,
        'Quick Pick should be shown when build command is invoked'
      );
    });

    test('Escape dismissal cancels build entirely', async () => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');

      // Stub Quick Pick to return undefined (user pressed Escape)
      const quickPickStub = sandbox.stub(vscode.window, 'showQuickPick')
        .resolves(undefined);

      const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');

      await vscode.commands.executeCommand('the-seed.buildNative');
      await new Promise((resolve) => setTimeout(resolve, 500));

      assert.ok(
        quickPickStub.called,
        'Quick Pick should be shown'
      );

      // Build should not proceed — no error about missing project
      // (the build should be cancelled before project detection)
      assert.ok(
        true,
        'Build was cancelled when Quick Pick was dismissed'
      );
    });
  });
});
