import * as assert from 'assert';
import * as fs from 'fs';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as path from 'path';
import { getOperationLock, acquireOperationLock } from '../../operationLock';
import type { OperationType } from '../../operationLock';
import { activeViewProvider } from '../../panels/TheSeedViewProvider';
import { requires } from '../harness/platform';
import { useScratchState } from '../helpers/scratchState';
import { FAILING_STDERR, FAILING_STDOUT, useFakeGit } from '../helpers/fakeGit';
import { fakeView, until } from '../helpers/fakeView';
import { panelText, recordOperation } from '../helpers/operationRecorder';
import type { Recorder } from '../helpers/operationRecorder';

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

  suite('Install Dependencies Command: target, outcome, cancel and lock', function () {
    this.timeout(60000);
    const git = useFakeGit();
    let recorder: Recorder;
    let pick: sinon.SinonStub;

    setup(() => {
      recorder = recordOperation();
      pick = sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);
    });

    type Posted = { type: string; payload?: Record<string, unknown> };
    const posted = (): Posted[] => recorder.sidebar as Posted[];
    const progressOf = (state: string): Posted[] =>
      posted().filter((message) => message.type === 'installDependenciesProgress' && message.payload?.state === state);
    const shown = (kind: string): string[] =>
      recorder.notifications.filter((entry) => entry.kind === kind).map((entry) => (entry as { text: string }).text);
    const count = (text: string, part: string): number => text.split(part).length - 1;

    test("with the target 'windows' as its argument, asks nothing and installs for windows", async () => {
      git.failing();

      await vscode.commands.executeCommand('the-seed.installDependencies', 'windows');

      assert.ok(pick.notCalled, 'no quick pick is shown');
      assert.deepStrictEqual(
        recorder.notifications.filter((entry) => entry.kind === 'progress'),
        [{ kind: 'progress', title: 'Installing dependencies (windows)', cancellable: true }],
      );
      assert.ok(/Install dependencies \(windows\) started at /.test(panelText(recorder)), 'the panel header names windows');
      const running = progressOf('running');
      assert.ok(running.length > 0, 'a running state is posted');
      assert.strictEqual(running[0].payload?.target, 'windows');
      assert.strictEqual(getOperationLock().active, false, 'the lock is free afterwards');
    });

    test('a configured prefix that does not exist yet is created, and the steps run inside it', async () => {
      git.failing();
      fs.rmSync(state.prefix as string, { recursive: true, force: true });

      await vscode.commands.executeCommand('the-seed.installDependencies', 'native');

      assert.ok(fs.existsSync(state.prefix as string), 'the prefix was created');
      assert.ok(!/ENOENT/.test(panelText(recorder)), 'no step failed to start for want of its directory');
      assert.ok(/Step 1\//.test(panelText(recorder)), 'the first step ran');
    });

    test('a windows install after a native one updates and cleans the sources the native one left, and installs', async () => {
      git.succeeding();

      await vscode.commands.executeCommand('the-seed.installDependencies', 'native');
      assert.deepStrictEqual(progressOf('completed').map((message) => message.payload?.target), ['native'], 'the native install completes');
      for (const library of ['libecs-cpp', 'libthe-seed']) {
        assert.ok(fs.existsSync(path.join(state.prefix as string, library)), `the native install left ${library} in the prefix`);
      }
      const nativeSteps = progressOf('running').length;

      await vscode.commands.executeCommand('the-seed.installDependencies', 'windows');

      const windowsSteps = progressOf('running').slice(nativeSteps).map((message) => String(message.payload?.currentStep));
      for (const library of ['libecs-cpp', 'libthe-seed']) {
        assert.ok(!windowsSteps.includes(`clone ${library}`), `${library} is not cloned again`);
        const update = windowsSteps.indexOf(`update ${library}`);
        const distclean = windowsSteps.indexOf(`${library} distclean`);
        const configure = windowsSteps.indexOf(`${library} configure`);
        assert.ok(update >= 0, `${library} is updated`);
        assert.ok(update < distclean && distclean < configure, `${library} is cleaned after its update and before it is configured`);
      }
      const panel = panelText(recorder);
      assert.ok(panel.includes('==> update libecs-cpp: git -C libecs-cpp pull --ff-only'), "the panel holds the tool's line for the update");
      assert.ok(/libecs-cpp distclean exited with status \d+; ignored\./.test(panel), 'the failing distclean of a tree without that target is ignored');
      assert.deepStrictEqual(progressOf('completed').map((message) => message.payload?.target), ['native', 'windows'], 'the windows install completes');
      assert.deepStrictEqual(shown('error'), [], 'no error is shown');
      assert.strictEqual(getOperationLock().active, false, 'the lock is free afterwards');
    });

    test("with the target 'mac', shows the unknown target error and runs nothing", async () => {
      git.failing();

      await vscode.commands.executeCommand('the-seed.installDependencies', 'mac');

      assert.deepStrictEqual(recorder.notifications, [{ kind: 'error', text: 'Unknown dependency target: mac.' }]);
      assert.ok(pick.notCalled, 'no quick pick is shown');
      assert.deepStrictEqual(recorder.panel, [], 'nothing is written to the panel');
      assert.deepStrictEqual(recorder.sidebar, [], 'nothing is posted to the sidebar');
      assert.deepStrictEqual(fs.readdirSync(state.prefix as string), [], 'nothing is written under the prefix');
      assert.strictEqual(getOperationLock().active, false, 'the lock is free');
    });

    test('a failing step is named in the error, its output is in the panel and the posted failure carries the same text', async () => {
      git.failing();
      const text = 'Dependency installation failed at clone libecs-cpp. Check output for details.';

      await vscode.commands.executeCommand('the-seed.installDependencies', 'native');

      assert.deepStrictEqual(shown('error'), [text]);
      const panel = panelText(recorder);
      assert.ok(panel.includes(FAILING_STDOUT), "the panel holds the step's stdout");
      assert.ok(panel.includes(FAILING_STDERR), "the panel holds the step's stderr");
      const reason = /── Installation failed at clone libecs-cpp: git clone \S+ libecs-cpp exited with status 1 ──/g;
      assert.strictEqual((panel.match(reason) ?? []).length, 1, "the panel line names the step's command and its exit status once");
      const failed = progressOf('failed');
      assert.strictEqual(failed.length, 1, 'one failure is posted');
      assert.strictEqual(failed[0].payload?.errorMessage, text);
      assert.strictEqual(failed[0].payload?.target, 'native');
      assert.strictEqual(getOperationLock().active, false, 'the lock is free afterwards');
    });

    const cancels: { from: string; cancel: (fake: ReturnType<typeof fakeView>) => Promise<void>; other: (fake: ReturnType<typeof fakeView>) => Promise<void> }[] = [
      {
        from: 'the notification',
        cancel: async () => { recorder.cancelProgress(); },
        other: async (fake) => { await fake.receive({ command: 'cancelInstallDependencies', requestId: 'cancel-after' }); },
      },
      {
        from: 'the sidebar',
        cancel: async (fake) => { await fake.receive({ command: 'cancelInstallDependencies', requestId: 'cancel-1' }); },
        other: async () => { recorder.cancelProgress(); },
      },
    ];

    for (const { from, cancel, other } of cancels) {
      test(`cancelling from ${from} during a step ends the run cancelled once and frees the lock`, async () => {
        git.slow(30);
        const provider = activeViewProvider();
        assert.ok(provider, "the extension's view provider exists");
        const fake = fakeView(provider);

        const running = vscode.commands.executeCommand('the-seed.installDependencies', 'native');
        await until(() => progressOf('running').some((message) => message.payload?.currentStep === 'clone libecs-cpp'), 'the clone step to start');
        await cancel(fake);
        await running;

        const panel = panelText(recorder);
        assert.strictEqual(count(panel, '── Installation cancelled ──'), 1, 'one cancellation line in the panel');
        assert.deepStrictEqual(shown('warning'), ['Dependency installation cancelled.']);
        assert.deepStrictEqual(shown('error'), [], 'no error is shown');
        assert.strictEqual(progressOf('cancelled').length, 1, 'one cancelled state is posted');
        assert.strictEqual(getOperationLock().active, false, 'the lock is free afterwards');

        const before = JSON.stringify({ panel: recorder.panel, notifications: recorder.notifications, sidebar: recorder.sidebar });
        await other(fake);
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.strictEqual(JSON.stringify({ panel: recorder.panel, notifications: recorder.notifications, sidebar: recorder.sidebar }), before, 'the other control changes nothing afterwards');
        assert.strictEqual(getOperationLock().active, false, 'the lock is still free');
      });
    }

    const REFUSALS: Record<Exclude<OperationType, 'install'>, string> = {
      build: 'Cannot install dependencies while a build operation is in progress.',
      package: 'Cannot install dependencies while a packaging operation is in progress.',
      installer: 'Cannot install dependencies while an installer is being generated.',
    };

    for (const [holder, text] of Object.entries(REFUSALS) as [OperationType, string][]) {
      test(`a start while ${holder} holds the lock is refused with that holder's text`, async () => {
        git.failing();
        const held = acquireOperationLock(holder);
        assert.ok(held.success, 'the case holds the lock');

        await vscode.commands.executeCommand('the-seed.installDependencies', 'native');

        assert.deepStrictEqual(recorder.notifications, [{ kind: 'warning', text }]);
        assert.deepStrictEqual(recorder.sidebar, [], 'nothing is posted to the sidebar');
        assert.deepStrictEqual(fs.readdirSync(state.prefix as string), [], 'nothing is written under the prefix');
        assert.strictEqual(getOperationLock().type, holder, 'the holder is unchanged');
        assert.strictEqual(getOperationLock().abortController, held.abortController, 'the abort controller is unchanged');
      });
    }

    test('a second start while an installation runs is refused as already in progress', async () => {
      git.slow(30);
      const running = vscode.commands.executeCommand('the-seed.installDependencies', 'native');
      await until(() => progressOf('running').length > 0, 'the first installation to start');
      const controller = getOperationLock().abortController;

      await vscode.commands.executeCommand('the-seed.installDependencies', 'native');

      assert.deepStrictEqual(shown('warning'), ['A dependency installation is already in progress.']);
      assert.strictEqual(getOperationLock().type, 'install', 'the first installation still holds the lock');
      assert.strictEqual(getOperationLock().abortController, controller, 'the holder is the first installation');
      assert.strictEqual(posted().filter((message) => message.type === 'installDependenciesStarted').length, 1, 'only the first start is posted');
      recorder.cancelProgress();
      await running;
      assert.strictEqual(getOperationLock().active, false, 'the lock is free afterwards');
    });
  });
});
