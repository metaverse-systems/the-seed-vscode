// Starting a build: the refusal texts, the project choice (no folder, one
// project, a pick, a dismissed pick), the refusal when another operation
// holds the lock, and the build limits: the item in the build-mode choice, the
// limit boxes, the save choice, and the workspace defaults. The cases with package.json files write real files in a
// scratch workspace folder and stub the workspace search, because the real
// search does not see stubbed workspace folders.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { acquireOperationLock, getOperationLock } from '../../operationLock';
import { buildRefusal, chooseBuildProject, startBuild } from '../../build/buildStart';
import type { BuildStart } from '../../build/buildStart';
import { fakeBuildSettings } from '../helpers/fakeSettings';
import { useScratchState } from '../helpers/scratchState';

const BUILDABLE = JSON.stringify({ name: 'game', scripts: { build: 'the-seed build native' } });
const NOT_BUILDABLE = JSON.stringify({ name: 'plain', scripts: { build: 'tsc' } });

suite('Build start', () => {
  const state = useScratchState({ workspaceFolders: 1 });

  setup(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  /** Writes a package.json in a new directory of the workspace folder and returns its directory. */
  function project(name: string, content: string): string {
    const dir = path.join(state.workspaceFolders[0], name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), content);
    return dir;
  }

  function foundBy(dirs: string[]): sinon.SinonStub {
    return sinon.stub(vscode.workspace, 'findFiles').resolves(dirs.map((dir) => vscode.Uri.file(path.join(dir, 'package.json'))));
  }

  test('buildRefusal names the operation holding the lock', () => {
    assert.strictEqual(buildRefusal('build'), 'A build is already in progress.');
    assert.strictEqual(buildRefusal('install'), 'Cannot build while an install operation is in progress.');
    assert.strictEqual(buildRefusal('package'), 'Cannot build while a packaging operation is in progress.');
  });

  test('chooseBuildProject with no workspace folder gives none and searches nothing', async () => {
    state.setWorkspaceFolders([]);
    const findFiles = sinon.stub(vscode.workspace, 'findFiles').resolves([]);

    const choice = await chooseBuildProject('Select a project to build');

    assert.deepStrictEqual(choice, { kind: 'none' });
    assert.ok(findFiles.notCalled, 'no search');
  });

  test('chooseBuildProject with one buildable and one other project finds the buildable one without a pick', async () => {
    const buildable = project('game', BUILDABLE);
    const other = project('plain', NOT_BUILDABLE);
    foundBy([other, buildable]);
    const pick = sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);

    const choice = await chooseBuildProject('Select a project to build');

    assert.deepStrictEqual(choice, { kind: 'found', path: buildable });
    assert.ok(pick.notCalled, 'no pick shown');
  });

  test('chooseBuildProject with two buildable projects and the pick dismissed gives dismissed', async () => {
    foundBy([project('one', BUILDABLE), project('two', BUILDABLE)]);
    const pick = sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);

    const choice = await chooseBuildProject('Select a project to build');

    assert.deepStrictEqual(choice, { kind: 'dismissed' });
    assert.strictEqual(pick.callCount, 1);
  });

  test('chooseBuildProject with two buildable projects and one picked finds that project', async () => {
    const one = project('one', BUILDABLE);
    const two = project('two', BUILDABLE);
    foundBy([one, two]);
    sinon.stub(vscode.window, 'showQuickPick').callsFake(async (items: unknown) => {
      const list = (await items) as vscode.QuickPickItem[];
      return list.find((item) => item.detail === two);
    });

    const choice = await chooseBuildProject('Select a project to build');

    assert.deepStrictEqual(choice, { kind: 'found', path: two });
  });

  test('startBuild while an install holds the lock warns, prompts for nothing and leaves the lock alone', async () => {
    const held = acquireOperationLock('install');
    assert.ok(held.success, 'the install lock is taken for the case');
    const pick = sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);
    const warning = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);
    const error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);

    const start = await startBuild({ releaseDescription: 'Release', projectPlaceHolder: 'Select a project to build', recursive: true });

    assert.strictEqual(start, undefined);
    assert.strictEqual(warning.callCount, 1);
    assert.strictEqual(warning.firstCall.args[0], 'Cannot build while an install operation is in progress.');
    assert.ok(pick.notCalled && error.notCalled, 'no prompt and no error');
    const lock = getOperationLock();
    assert.strictEqual(lock.type, 'install');
    assert.strictEqual(lock.abortController, held.abortController);
  });
  /** What the prompts answer, in order; 'limits' in `modes` chooses the build limits item. */
  interface Answers {
    modes: (string | undefined)[];
    inputs?: (string | undefined)[];
    use?: (string | undefined)[];
  }

  interface Shown {
    modePicks: vscode.QuickPickItem[][];
    usePicks: string[][];
    inputBoxes: vscode.InputBoxOptions[];
  }

  /** Answers the build-mode choice, the limit boxes and the save choice from `answers`. */
  function answer(answers: Answers): Shown {
    const shown: Shown = { modePicks: [], usePicks: [], inputBoxes: [] };
    sinon.stub(vscode.window, 'showQuickPick').callsFake((async (items: unknown, options?: vscode.QuickPickOptions) => {
      const list = (await items) as (vscode.QuickPickItem | string)[];
      if (options?.placeHolder === 'Select build mode') {
        const modes = list as vscode.QuickPickItem[];
        shown.modePicks.push(modes);
        const label = answers.modes.shift();
        if (label === undefined) {
          return undefined;
        }
        return label === 'limits' ? modes.find((item) => item.label.startsWith('Build limits: ')) : modes.find((item) => item.label === label);
      }
      if (options?.placeHolder === 'Use these build limits') {
        shown.usePicks.push(list as string[]);
        return answers.use?.shift();
      }
      return undefined;
    }) as never);
    sinon.stub(vscode.window, 'showInputBox').callsFake(async (options?: vscode.InputBoxOptions) => {
      shown.inputBoxes.push(options ?? {});
      return answers.inputs?.shift();
    });
    return shown;
  }

  async function start(recursive: boolean): Promise<BuildStart | undefined> {
    foundBy([project('game', BUILDABLE)]);
    return startBuild({ releaseDescription: 'Release', projectPlaceHolder: 'Select a project to build', recursive });
  }

  function assertNothingChanged(settings: ReturnType<typeof fakeBuildSettings>, result: BuildStart | undefined): void {
    assert.strictEqual(result, undefined, 'the build does not start');
    assert.strictEqual(getOperationLock().active, false, 'the lock is free');
    assert.deepStrictEqual(settings.updates, [], 'nothing is saved');
  }

  test('without the limits item the build asks nothing more and requests no limit', async () => {
    fakeBuildSettings();
    const shown = answer({ modes: ['Debug'] });

    const result = await start(true);

    assert.ok(result, 'the build starts');
    assert.deepStrictEqual(result.limits, {});
    assert.deepStrictEqual(result.settingProblems, []);
    assert.strictEqual(result.release, false);
    assert.strictEqual(shown.modePicks.length, 1, 'one build-mode choice');
    assert.deepStrictEqual(shown.modePicks[0].map((item) => item.label), ['Debug', 'Release', '', 'Build limits: 1 project at a time, compile jobs: processor count']);
    assert.strictEqual(shown.modePicks[0][2].kind, vscode.QuickPickItemKind.Separator);
    assert.strictEqual(shown.inputBoxes.length, 0, 'no limit box');
    result.abortController.abort();
  });

  test('a recursive build asks for the project count, then the job limit, and carries both for this build', async () => {
    const settings = fakeBuildSettings();
    const shown = answer({ modes: ['limits', 'Release'], inputs: ['3', ' 6 '], use: ['Use for this build only'] });

    const result = await start(true);

    assert.ok(result, 'the build starts');
    assert.deepStrictEqual(result.limits, {
      parallel: { value: 3, source: 'this build' },
      jobs: { value: 6, source: 'this build' },
    });
    assert.strictEqual(result.release, true);
    assert.deepStrictEqual(shown.inputBoxes.map((box) => box.title), ['Build limits: the project count', 'Build limits: the job limit']);
    assert.strictEqual(shown.modePicks.length, 2, 'the build-mode choice is shown again');
    assert.strictEqual(shown.modePicks[1][3].label, 'Build limits: up to 3 projects at once, 6 compile jobs');
    assert.deepStrictEqual(settings.updates, [], 'nothing is saved');
    assert.strictEqual(getOperationLock().type, 'build', 'the lock is taken for the build');
  });

  test('a single-project build asks only for the job limit', async () => {
    fakeBuildSettings();
    const shown = answer({ modes: ['limits', 'Debug'], inputs: ['2'], use: ['Use for this build only'] });

    const result = await start(false);

    assert.ok(result, 'the build starts');
    assert.deepStrictEqual(result.limits, { jobs: { value: 2, source: 'this build' } });
    assert.deepStrictEqual(shown.inputBoxes.map((box) => box.title), ['Build limits: the job limit']);
    assert.strictEqual(shown.modePicks[0][3].label, 'Build limits: compile jobs: processor count');
  });

  test('the limit boxes check the text as it is typed and accept an empty box', async () => {
    fakeBuildSettings();
    const shown = answer({ modes: ['limits', undefined], inputs: ['', ''], use: ['Use for this build only'] });

    await start(true);

    const [parallel, jobs] = shown.inputBoxes;
    assert.strictEqual(parallel.validateInput!('four'), 'Invalid value "four" for the project count; expected a positive whole number.');
    assert.strictEqual(jobs.validateInput!('0'), 'Invalid value "0" for the job limit; expected a positive whole number.');
    assert.strictEqual(jobs.validateInput!('4.5'), 'Invalid value "4.5" for the job limit; expected a positive whole number.');
    assert.strictEqual(jobs.validateInput!(''), undefined);
    assert.strictEqual(jobs.validateInput!(' 8 '), undefined);
  });

  const dismissals: { name: string; answers: Answers }[] = [
    { name: 'the project-count box', answers: { modes: ['limits'], inputs: [undefined] } },
    { name: 'the job-limit box', answers: { modes: ['limits'], inputs: ['3', undefined] } },
    { name: 'the save choice', answers: { modes: ['limits'], inputs: ['3', '6'], use: [undefined] } },
    { name: 'the build-mode choice after the limits', answers: { modes: ['limits', undefined], inputs: ['3', '6'], use: ['Use for this build only'] } },
  ];

  for (const { name, answers } of dismissals) {
    test(`dismissing ${name} starts nothing, saves nothing and leaves the lock free`, async () => {
      const settings = fakeBuildSettings({ workspace: { jobs: 2 } });
      answer(answers);

      assertNothingChanged(settings, await start(true));
    });
  }

  test('a dismissed save choice saves nothing even when saving was offered', async () => {
    const settings = fakeBuildSettings();
    const shown = answer({ modes: ['limits'], inputs: ['3', '6'], use: [undefined] });

    assertNothingChanged(settings, await start(true));
    assert.deepStrictEqual(shown.usePicks, [['Use for this build only', 'Use and save as workspace default']]);
  });

  test('saved defaults are used without any extra prompt', async () => {
    fakeBuildSettings({ workspace: { parallel: 4, jobs: 8 } });
    const shown = answer({ modes: ['Debug'] });

    const result = await start(true);

    assert.ok(result, 'the build starts');
    assert.deepStrictEqual(result.limits, {
      parallel: { value: 4, source: 'workspace default' },
      jobs: { value: 8, source: 'workspace default' },
    });
    assert.strictEqual(shown.inputBoxes.length, 0, 'no limit box');
    assert.strictEqual(shown.modePicks[0][3].label, 'Build limits: up to 4 projects at once, 8 compile jobs');
  });

  test('values entered for one build override the defaults and leave the settings alone', async () => {
    const settings = fakeBuildSettings({ workspace: { parallel: 4, jobs: 8 } });
    const shown = answer({ modes: ['limits', 'Debug'], inputs: ['2', '8'], use: ['Use for this build only'] });

    const result = await start(true);

    assert.ok(result, 'the build starts');
    assert.deepStrictEqual(shown.inputBoxes.map((box) => box.value), ['4', '8'], 'the boxes hold the values in effect');
    assert.deepStrictEqual(result.limits, {
      parallel: { value: 2, source: 'this build' },
      jobs: { value: 8, source: 'workspace default' },
    });
    assert.deepStrictEqual(settings.updates, []);
    assert.deepStrictEqual(settings.workspace, { parallel: 4, jobs: 8 });
  });

  test('an emptied box falls back to the workspace default for this build', async () => {
    fakeBuildSettings({ workspace: { jobs: 8 } });
    answer({ modes: ['limits', 'Debug'], inputs: ['3', ''], use: ['Use for this build only'] });

    const result = await start(true);

    assert.ok(result, 'the build starts');
    assert.deepStrictEqual(result.limits, {
      parallel: { value: 3, source: 'this build' },
      jobs: { value: 8, source: 'workspace default' },
    });
  });

  test('"Use and save as workspace default" saves the values and uses them', async () => {
    const settings = fakeBuildSettings({ workspace: { jobs: 8 } });
    answer({ modes: ['limits', 'Debug'], inputs: ['3', '6'], use: ['Use and save as workspace default'] });

    const result = await start(true);

    assert.ok(result, 'the build starts');
    assert.deepStrictEqual(settings.updates, [
      { key: 'parallel', value: 3, target: vscode.ConfigurationTarget.Workspace },
      { key: 'jobs', value: 6, target: vscode.ConfigurationTarget.Workspace },
    ]);
    assert.deepStrictEqual(result.limits, {
      parallel: { value: 3, source: 'workspace default' },
      jobs: { value: 6, source: 'workspace default' },
    });
  });

  test('saving is not offered when no folder is open', async () => {
    fakeBuildSettings();
    const shown = answer({ modes: ['limits'], inputs: ['3', '6'], use: [undefined] });
    state.setWorkspaceFolders([]);

    const result = await startBuild({ releaseDescription: 'Release', projectPlaceHolder: 'Select a project to build', recursive: true });

    assert.strictEqual(result, undefined);
    assert.deepStrictEqual(shown.usePicks, [['Use for this build only']]);
  });

  test('an invalid saved value is reported and not used', async () => {
    fakeBuildSettings({ workspace: { parallel: 3, jobs: 'six' } });
    answer({ modes: ['Debug'] });

    const result = await start(true);

    assert.ok(result, 'the build starts');
    assert.deepStrictEqual(result.limits, { parallel: { value: 3, source: 'workspace default' } });
    assert.deepStrictEqual(result.settingProblems.map((problem) => problem.message), [
      'The setting "the-seed.build.jobs" is "six"; expected a positive whole number. Using the processor count for this build.',
    ]);
  });

  test('an invalid saved value replaced for this build is not reported', async () => {
    fakeBuildSettings({ workspace: { jobs: 'six' } });
    answer({ modes: ['limits', 'Debug'], inputs: ['', '4'], use: ['Use for this build only'] });

    const result = await start(true);

    assert.ok(result, 'the build starts');
    assert.deepStrictEqual(result.limits, { jobs: { value: 4, source: 'this build' } });
    assert.deepStrictEqual(result.settingProblems, []);
  });

  test('a single-project build ignores a saved project count, even an invalid one', async () => {
    fakeBuildSettings({ workspace: { parallel: 'many', jobs: 2 } });
    answer({ modes: ['Debug'] });

    const result = await start(false);

    assert.ok(result, 'the build starts');
    assert.deepStrictEqual(result.limits, { jobs: { value: 2, source: 'workspace default' } });
    assert.deepStrictEqual(result.settingProblems, []);
  });
});
