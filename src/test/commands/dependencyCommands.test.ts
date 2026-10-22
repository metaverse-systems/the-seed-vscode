import * as assert from 'assert';
import * as fs from 'fs';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { getOperationLock, acquireOperationLock } from '../../operationLock';
import { requires } from '../harness/platform';
import { useScratchState } from '../helpers/scratchState';

suite('Dependency Commands', () => {
  requires('posix-toolchain');
  const state = useScratchState();

  let savedPkgConfigPath: string | undefined;
  let savedPkgConfigLibdir: string | undefined;

  setup(() => {
    savedPkgConfigPath = process.env.PKG_CONFIG_PATH;
    savedPkgConfigLibdir = process.env.PKG_CONFIG_LIBDIR;
    delete process.env.PKG_CONFIG_PATH;
    process.env.PKG_CONFIG_LIBDIR = state.dir('pkgconfig');
  });

  teardown(() => {
    restore('PKG_CONFIG_PATH', savedPkgConfigPath);
    restore('PKG_CONFIG_LIBDIR', savedPkgConfigLibdir);
  });

  function restore(name: string, value: string | undefined): void {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }

  function stubMessages(): { info: sinon.SinonStub; warning: sinon.SinonStub; error: sinon.SinonStub } {
    return {
      info: sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined),
      warning: sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined),
      error: sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined),
    };
  }

  suite('Check Dependencies Command', () => {
    test('with an empty prefix and no system libraries visible, reports both libraries missing', async () => {
      const messages = stubMessages();
      sinon.stub(vscode.window, 'showQuickPick').resolves({ label: 'native' });

      await vscode.commands.executeCommand('the-seed.checkDependencies');

      assert.strictEqual(messages.info.callCount, 1, 'exactly one information message');
      assert.strictEqual(messages.info.firstCall.args[0], 'Dependencies (native): libecs-cpp ✗ | libthe-seed ✗');
      assert.ok(!messages.error.called, 'no error message');
    });

    test('should exit cleanly when QuickPick is cancelled', async () => {
      const messages = stubMessages();
      sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.checkDependencies');

      assert.ok(!messages.info.called && !messages.warning.called && !messages.error.called, 'no message is shown');
      assert.deepStrictEqual(fs.readdirSync(state.prefix as string), [], 'nothing is written under the prefix');
    });
  });

  suite('Install Dependencies Command', () => {
    test('while a build holds the operation lock, refuses with a warning and installs nothing', async () => {
      const messages = stubMessages();
      sinon.stub(vscode.window, 'showQuickPick').resolves({ label: 'native' });
      assert.ok(acquireOperationLock('build').success, 'the build lock is acquired for the case');

      await vscode.commands.executeCommand('the-seed.installDependencies');

      assert.strictEqual(messages.warning.callCount, 1, 'exactly one warning');
      assert.ok(/build/i.test(String(messages.warning.firstCall.args[0])), 'the warning names the running build');
      assert.ok(!messages.error.called, 'no error message');
      assert.deepStrictEqual(fs.readdirSync(state.prefix as string), [], 'nothing is installed under the prefix');
      assert.strictEqual(getOperationLock()?.type, 'build', 'the lock is still held by the build');
    });

    test('should exit cleanly when QuickPick is cancelled', async () => {
      const messages = stubMessages();
      sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.installDependencies');

      assert.ok(!messages.info.called && !messages.warning.called && !messages.error.called, 'no message is shown');
      assert.deepStrictEqual(fs.readdirSync(state.prefix as string), [], 'nothing is written under the prefix');
    });
  });
});
