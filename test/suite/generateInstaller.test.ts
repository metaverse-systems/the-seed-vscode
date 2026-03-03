import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';

suite('generateInstaller Command', () => {
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    sandbox = sinon.createSandbox();
  });

  teardown(() => {
    sandbox.restore();
  });

  test('command is registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('the-seed.generateWindowsInstaller'),
      'the-seed.generateWindowsInstaller command should be registered'
    );
  });

  test('shows error when no workspace folder is open', async () => {
    // Stub workspace to have no folders
    sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

    const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');

    await vscode.commands.executeCommand('the-seed.generateWindowsInstaller');

    // Give the command time to execute
    await new Promise((resolve) => setTimeout(resolve, 500));

    assert.ok(
      showErrorStub.calledOnce,
      'Should show error notification when no workspace folder is open'
    );
    const errorMsg = showErrorStub.firstCall.args[0];
    assert.ok(
      typeof errorMsg === 'string' && errorMsg.includes('workspace folder'),
      `Error message should mention workspace folder, got: ${errorMsg}`
    );
  });
});
