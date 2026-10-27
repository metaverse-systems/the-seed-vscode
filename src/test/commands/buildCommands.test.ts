// Build commands through the command registry, up to the point where a build
// starts: the build mode prompt and its dismissal, the project search and its
// dismissal, the error when the workspace holds no buildable project, and the
// refusals while another operation holds the lock. Each path that does not
// build leaves the operation lock free, so the next build or installation is
// not refused; a successful build and a failure before the first step release
// it too.
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as fs from 'fs';
import * as path from 'path';
import { acquireOperationLock, getOperationLock } from '../../operationLock';
import { useScratchState } from '../helpers/scratchState';
import { requires } from '../harness/platform';
import { testTool, useToolApi } from '../helpers/tool';
import { fakeBuildSettings } from '../helpers/fakeSettings';
import { panelText, recordOperation } from '../helpers/operationRecorder';
import { until } from '../helpers/fakeView';
import { processorCount } from '../../build/buildLimits';
import type { ToolApi } from '../../tool/toolApi';

const NO_PROJECT_MESSAGE = 'No buildable project found. Open a file in a The Seed project.';

suite('Build Commands', () => {
  const state = useScratchState({ workspaceFolders: 1 });

  setup(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  const plainCommands = ['the-seed.buildNative', 'the-seed.buildWindows', 'the-seed.buildIncremental'];
  const allCommands = [...plainCommands, 'the-seed.buildNativeRecursive', 'the-seed.buildWindowsRecursive'];
  const DEBUG = { label: 'Debug' } as vscode.QuickPickItem;
  const INSTALL_PROMPT = 'Select target platform';

  /** Writes a buildable package.json in a new directory of the workspace folder and returns the directory. */
  function writeProject(name: string): string {
    const dir = path.join(state.workspaceFolders[0], name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name, scripts: { build: 'the-seed build native' } })
    );
    return dir;
  }

  function foundBy(dirs: string[]): sinon.SinonStub {
    return sinon.stub(vscode.workspace, 'findFiles').resolves(dirs.map((dir) => vscode.Uri.file(path.join(dir, 'package.json'))));
  }

  /** Build mode Debug on the first prompt, then whatever `later` answers for any other prompt. */
  function modeThen(later: unknown): sinon.SinonStub {
    const pick = sinon.stub(vscode.window, 'showQuickPick');
    pick.onFirstCall().resolves(DEBUG);
    pick.resolves(later as vscode.QuickPickItem | undefined);
    return pick;
  }

  /** Installing dependencies must get as far as its own target prompt, which the build did not block. */
  async function assertInstallNotBlocked(): Promise<void> {
    const pick = sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);
    const warning = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);

    await vscode.commands.executeCommand('the-seed.installDependencies');

    assert.ok(
      pick.getCalls().some((call) => (call.args[1] as vscode.QuickPickOptions | undefined)?.placeHolder === INSTALL_PROMPT),
      'the install target prompt was shown'
    );
    assert.ok(
      !warning.getCalls().some((call) => String(call.args[0]).includes('Cannot install dependencies')),
      'no refusal naming a build'
    );
    pick.restore();
    warning.restore();
  }

  for (const commandId of allCommands) {
    suite(commandId, () => {
      test('with Debug chosen and no buildable project shows the no-project error each time and leaves the lock free', async () => {
        sinon.stub(vscode.window, 'showQuickPick').resolves(DEBUG);
        sinon.stub(vscode.workspace, 'findFiles').resolves([]);
        const error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
        const warning = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);

        for (let run = 1; run <= 2; run++) {
          await vscode.commands.executeCommand(commandId);

          assert.strictEqual(error.callCount, run, `the error was shown on run ${run}`);
          assert.strictEqual(error.lastCall.args[0], NO_PROJECT_MESSAGE);
          assert.ok(warning.notCalled, 'no "already in progress" warning');
          assert.strictEqual(getOperationLock().active, false, `the lock is not held after run ${run}`);
        }
      });

      test('with two buildable projects and the project choice dismissed shows nothing and leaves the lock free', async () => {
        foundBy([writeProject('one'), writeProject('two')]);
        modeThen(undefined);
        const error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
        const warning = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);

        await vscode.commands.executeCommand(commandId);

        assert.ok(error.notCalled, 'no error');
        assert.ok(warning.notCalled, 'no warning');
        assert.strictEqual(getOperationLock().active, false, 'the lock is not held');
      });

      test('with the build mode prompt dismissed does nothing', async () => {
        sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);
        const findFiles = sinon.stub(vscode.workspace, 'findFiles').resolves([]);
        const error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
        const warning = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);
        const info = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);

        await vscode.commands.executeCommand(commandId);

        assert.ok(findFiles.notCalled, 'no project search');
        assert.ok(error.notCalled && warning.notCalled && info.notCalled, 'no message shown');
        assert.strictEqual(getOperationLock().active, false, 'the lock is not held');
      });

      test('while an install holds the lock warns without a build mode prompt', async () => {
        const held = acquireOperationLock('install');
        assert.ok(held.success, 'the install lock is taken for the case');
        const pick = sinon.stub(vscode.window, 'showQuickPick').resolves(DEBUG);
        const warning = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);

        await vscode.commands.executeCommand(commandId);

        assert.strictEqual(warning.callCount, 1);
        assert.strictEqual(warning.firstCall.args[0], 'Cannot build while an install operation is in progress.');
        assert.ok(pick.notCalled, 'no build mode prompt');
        const lock = getOperationLock();
        assert.strictEqual(lock.type, 'install');
        assert.strictEqual(lock.abortController, held.abortController);
      });

      test('while a packaging run holds the lock warns that packaging is running and leaves the lock alone', async () => {
        const held = acquireOperationLock('package');
        assert.ok(held.success, 'the package lock is taken for the case');
        sinon.stub(vscode.window, 'showQuickPick').resolves(DEBUG);
        const warning = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);

        await vscode.commands.executeCommand(commandId);

        assert.strictEqual(warning.callCount, 1);
        assert.strictEqual(warning.firstCall.args[0], 'Cannot build while a packaging operation is in progress.');
        const lock = getOperationLock();
        assert.strictEqual(lock.type, 'package');
        assert.strictEqual(lock.abortController, held.abortController);
      });

      suite('then installing dependencies', () => {
        requires('posix-toolchain');

        test('after the no-project run reaches the install target prompt', async () => {
          sinon.stub(vscode.window, 'showQuickPick').resolves(DEBUG);
          sinon.stub(vscode.workspace, 'findFiles').resolves([]);
          sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
          await vscode.commands.executeCommand(commandId);
          sinon.restore();

          await assertInstallNotBlocked();
        });

        test('after the dismissed project choice reaches the install target prompt', async () => {
          foundBy([writeProject('one'), writeProject('two')]);
          modeThen(undefined);
          await vscode.commands.executeCommand(commandId);
          sinon.restore();

          await assertInstallNotBlocked();
        });
      });
    });
  }

  for (const commandId of plainCommands) {
    test(`${commandId} builds again with one buildable project after a run with no project`, async () => {
      const buildProject = sinon
        .stub(testTool().Build.prototype, 'buildProject')
        .resolves({ status: 'completed' } as never);
      const pick = sinon.stub(vscode.window, 'showQuickPick').resolves(DEBUG);
      const findFiles = sinon.stub(vscode.workspace, 'findFiles').resolves([]);
      const error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      const info = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
      await vscode.commands.executeCommand(commandId);
      assert.strictEqual(error.callCount, 1, 'the no-project error was shown');
      assert.ok(buildProject.notCalled, 'nothing was built');

      const dir = writeProject('game');
      findFiles.resolves([vscode.Uri.file(path.join(dir, 'package.json'))]);
      await vscode.commands.executeCommand(commandId);

      assert.strictEqual(pick.callCount, 2);
      assert.strictEqual(buildProject.callCount, 1);
      assert.strictEqual(buildProject.firstCall.args[0].projectDir, dir);
      assert.ok(info.getCalls().some((call) => call.args[0] === 'Build succeeded.'), 'success shown');
      assert.strictEqual(getOperationLock().active, false, 'the lock is released afterwards');
    });
  }

  test('the-seed.buildNative with a configuration that fails to load shows the error and leaves the lock free', async () => {
    const dir = writeProject('game');
    foundBy([dir]);
    sinon.stub(vscode.window, 'showQuickPick').resolves(DEBUG);
    sinon.stub(testTool().Config.prototype, 'loadConfig').throws(new Error('config unreadable'));
    const error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);

    await vscode.commands.executeCommand('the-seed.buildNative');

    assert.strictEqual(error.callCount, 1);
    assert.ok(String(error.firstCall.args[0]).includes('config unreadable'), 'the failure is reported');
    assert.strictEqual(getOperationLock().active, false, 'the lock is not held');
  });
  const recursiveCommands = ['the-seed.buildNativeRecursive', 'the-seed.buildWindowsRecursive'];

  /** Makes the extension use the loaded tool with buildRecursive stubbed, until sinon is restored. */
  async function stubRecursive(): Promise<sinon.SinonStub<Parameters<ToolApi['buildRecursive']>, ReturnType<ToolApi['buildRecursive']>>> {
    const buildRecursive = sinon.stub<Parameters<ToolApi['buildRecursive']>, ReturnType<ToolApi['buildRecursive']>>();
    await useToolApi({ ...testTool(), buildRecursive } as ToolApi);
    return buildRecursive;
  }
  const HEADER_END = `${'═'.repeat(60)}\n\n`;

  /** Answers the build-mode choice (choosing the limits item when `inputs` is given), the limit boxes and the save choice. */
  function answerLimits(inputs?: string[], use = 'Use for this build only'): void {
    let limitsChosen = inputs === undefined;
    sinon.stub(vscode.window, 'showQuickPick').callsFake((async (items: unknown, options?: vscode.QuickPickOptions) => {
      const list = (await items) as (vscode.QuickPickItem | string)[];
      if (options?.placeHolder === 'Select build mode') {
        const modes = list as vscode.QuickPickItem[];
        if (!limitsChosen) {
          limitsChosen = true;
          return modes.find((item) => item.label.startsWith('Build limits: '));
        }
        return modes.find((item) => item.label === 'Debug');
      }
      return use;
    }) as never);
    const boxes = [...(inputs ?? [])];
    sinon.stub(vscode.window, 'showInputBox').callsFake(async () => boxes.shift());
  }

  /** The panel lines from the start header up to the first step or project line. */
  function linesAfterHeader(panel: string): string[] {
    const start = panel.indexOf(HEADER_END);
    assert.ok(start >= 0, `the start header is in the panel, got: ${panel}`);
    return panel.slice(start + HEADER_END.length).split('\n');
  }

  for (const commandId of plainCommands) {
    test(`${commandId} passes the job limit entered for this build and states it after the header`, async () => {
      fakeBuildSettings();
      const recorder = recordOperation();
      const buildProject = sinon
        .stub(testTool().Build.prototype, 'buildProject')
        .callsFake(async (options) => {
          options.onStepStart?.({ label: 'Compile', command: 'make', args: [] } as never, 0, 1);
          return { status: 'completed' } as never;
        });
      foundBy([writeProject('game')]);
      answerLimits(['3']);

      await vscode.commands.executeCommand(commandId);

      assert.strictEqual(buildProject.callCount, 1);
      assert.strictEqual(buildProject.firstCall.args[0].jobs, 3);
      const lines = linesAfterHeader(panelText(recorder));
      assert.strictEqual(lines[0], 'Build limits: 3 compile jobs (this build)');
      assert.ok(lines.slice(1).some((line) => line.startsWith('── Step 1/1: Compile')), 'the step comes after the limits line');
    });

    test(`${commandId} with no limits passes no job limit (SC-001)`, async () => {
      fakeBuildSettings();
      const recorder = recordOperation();
      const buildProject = sinon.stub(testTool().Build.prototype, 'buildProject').resolves({ status: 'completed' } as never);
      foundBy([writeProject('game')]);
      answerLimits();

      await vscode.commands.executeCommand(commandId);

      assert.strictEqual(buildProject.callCount, 1);
      assert.ok(!('jobs' in buildProject.firstCall.args[0]), 'no jobs key');
      assert.strictEqual(linesAfterHeader(panelText(recorder))[0], `Build limits: ${processorCount()} compile ${processorCount() === 1 ? 'job' : 'jobs'} (processor count)`);
    });
  }

  for (const commandId of recursiveCommands) {
    test(`${commandId} passes both limits unreduced and states the reduction`, async () => {
      fakeBuildSettings();
      const recorder = recordOperation();
      const buildRecursive = (await stubRecursive()).callsFake(async (options) => {
        options.callbacks?.onProjectStart?.({ name: '@test/game' } as never, 0, 1);
        return { success: true, completed: [], remaining: [], failed: null, failureOutput: null, cancelled: false } as never;
      });
      foundBy([writeProject('game')]);
      answerLimits(['16', '2']);

      await vscode.commands.executeCommand(commandId);

      assert.strictEqual(buildRecursive.callCount, 1);
      assert.strictEqual(buildRecursive.firstCall.args[0].parallel, 16);
      assert.strictEqual(buildRecursive.firstCall.args[0].jobs, 2);
      const lines = linesAfterHeader(panelText(recorder));
      assert.strictEqual(lines[0], 'Build limits: up to 2 projects at once (requested 16, reduced to the job limit), 2 compile jobs (this build)');
      assert.ok(lines.slice(1).some((line) => line.includes('[1/1] @test/game')), 'the project comes after the limits line');
    });

    test(`${commandId} with no limits passes neither key (SC-001)`, async () => {
      fakeBuildSettings();
      const recorder = recordOperation();
      const buildRecursive = (await stubRecursive()).resolves(
        { success: true, completed: [], remaining: [], failed: null, failureOutput: null, cancelled: false } as never
      );
      foundBy([writeProject('game')]);
      answerLimits();

      await vscode.commands.executeCommand(commandId);

      const options = buildRecursive.firstCall.args[0];
      assert.ok(!('parallel' in options) && !('jobs' in options), 'neither key is passed');
      assert.ok(
        linesAfterHeader(panelText(recorder))[0].startsWith('Build limits: 1 project at a time (default), '),
        'the default is stated'
      );
    });

    test(`${commandId} with an invalid saved value warns once, states it before the limits and builds with the standard behaviour`, async () => {
      fakeBuildSettings({ workspace: { parallel: 2, jobs: 'six' } });
      const recorder = recordOperation();
      const buildRecursive = (await stubRecursive()).resolves(
        { success: true, completed: [], remaining: [], failed: null, failureOutput: null, cancelled: false } as never
      );
      foundBy([writeProject('game')]);
      answerLimits();

      await vscode.commands.executeCommand(commandId);

      const message = 'The setting "the-seed.build.jobs" is "six"; expected a positive whole number. Using the processor count for this build.';
      assert.deepStrictEqual(recorder.notifications.filter((entry) => entry.kind === 'warning'), [{ kind: 'warning', text: message }]);
      const lines = linesAfterHeader(panelText(recorder));
      assert.strictEqual(lines[0], message);
      assert.ok(lines[1].startsWith('Build limits: '), `the limits line follows, got: ${lines[1]}`);
      assert.ok(lines[1].endsWith(' (processor count)'), `the job limit is the processor count, got: ${lines[1]}`);
      const options = buildRecursive.firstCall.args[0];
      assert.strictEqual(options.parallel, 2);
      assert.ok(!('jobs' in options), 'the invalid value is not passed');
    });
  }

  test('a settings change during a build does not change what that build passed or stated', async () => {
    const settings = fakeBuildSettings({ workspace: { parallel: 2, jobs: 4 } });
    const recorder = recordOperation();
    let finish: () => void = () => undefined;
    const buildRecursive = (await stubRecursive()).callsFake(() => new Promise((resolve) => {
      finish = () => resolve({ success: true, completed: [], remaining: [], failed: null, failureOutput: null, cancelled: false } as never);
    }));
    foundBy([writeProject('game')]);
    answerLimits();

    const building = vscode.commands.executeCommand('the-seed.buildNativeRecursive');
    await until(() => buildRecursive.called, 'the build to start');
    settings.workspace.parallel = 8;
    settings.workspace.jobs = 'six';
    finish();
    await building;

    const options = buildRecursive.firstCall.args[0];
    assert.strictEqual(options.parallel, 2);
    assert.strictEqual(options.jobs, 4);
    const lines = linesAfterHeader(panelText(recorder));
    assert.ok(lines[0].startsWith('Build limits: up to 2 projects at once') || lines[0].startsWith('Build limits: 1 project at a time'), lines[0]);
    assert.ok(lines[0].endsWith('4 compile jobs (workspace default)'), lines[0]);
    assert.deepStrictEqual(recorder.notifications.filter((entry) => entry.kind === 'warning'), [], 'no warning');
  });
});
