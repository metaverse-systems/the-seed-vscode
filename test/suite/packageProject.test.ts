import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { acquireOperationLock, releaseOperationLock } from '../../src/operationLock';

suite('packageProject Command', () => {
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    sandbox = sinon.createSandbox();
    // Ensure lock is released before each test
    releaseOperationLock();
  });

  teardown(() => {
    sandbox.restore();
    releaseOperationLock();
  });

  test('command is registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('the-seed.packageProject'),
      'the-seed.packageProject command should be registered'
    );
  });

  test('shows error when no workspace folder is open', async () => {
    // Stub workspace to have no folders
    sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

    const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');

    await vscode.commands.executeCommand('the-seed.packageProject');

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

  test('operation lock prevents concurrent execution', () => {
    // Acquire lock for build
    const buildLock = acquireOperationLock('build');
    assert.ok(buildLock.success, 'Should acquire build lock');

    // Try to acquire for package — should fail
    const packageLock = acquireOperationLock('package');
    assert.strictEqual(packageLock.success, false, 'Should not acquire package lock while build is held');
    assert.strictEqual(packageLock.heldBy, 'build', 'Should report build as the holder');

    releaseOperationLock();

    // Now package should succeed
    const packageLock2 = acquireOperationLock('package');
    assert.ok(packageLock2.success, 'Should acquire package lock after build is released');

    releaseOperationLock();
  });

  test('operation lock prevents build while packaging', () => {
    const packageLock = acquireOperationLock('package');
    assert.ok(packageLock.success, 'Should acquire package lock');

    const buildLock = acquireOperationLock('build');
    assert.strictEqual(buildLock.success, false, 'Should not acquire build lock while package is held');
    assert.strictEqual(buildLock.heldBy, 'package', 'Should report package as the holder');

    releaseOperationLock();
  });

  test('operation lock prevents install while packaging', () => {
    const packageLock = acquireOperationLock('package');
    assert.ok(packageLock.success, 'Should acquire package lock');

    const installLock = acquireOperationLock('install');
    assert.strictEqual(installLock.success, false, 'Should not acquire install lock while package is held');
    assert.strictEqual(installLock.heldBy, 'package', 'Should report package as the holder');

    releaseOperationLock();
  });

  test('lock release is idempotent', () => {
    // Releasing without holding should not throw
    assert.doesNotThrow(() => releaseOperationLock());
    assert.doesNotThrow(() => releaseOperationLock());
  });
});
