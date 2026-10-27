// The workspace defaults for the build limits: only the workspace's values are
// read, invalid ones are reported and not used, and saving writes only the
// workspace level.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { canSaveWorkspaceDefaults, readWorkspaceDefaults, saveWorkspaceDefaults } from '../../build/limitSettings';
import { fakeBuildSettings } from '../helpers/fakeSettings';
import { useScratchState } from '../helpers/scratchState';

suite('Build limit settings', () => {
  const state = useScratchState({ workspaceFolders: 1 });

  test('the manifest declares both settings with no default', () => {
    const configuration = vscode.workspace.getConfiguration('the-seed.build');
    for (const key of ['parallel', 'jobs']) {
      const inspected = configuration.inspect(key);
      assert.ok(inspected, `the-seed.build.${key} is declared`);
      assert.strictEqual(inspected.defaultValue, null, `the-seed.build.${key} has no default`);
    }
  });

  test('the workspace values are read with their source', () => {
    fakeBuildSettings({ workspace: { parallel: 4, jobs: 8 } });
    assert.deepStrictEqual(readWorkspaceDefaults(true), {
      limits: {
        parallel: { value: 4, source: 'workspace default' },
        jobs: { value: 8, source: 'workspace default' },
      },
      problems: [],
    });
  });

  test('a single-project build reads only the job limit', () => {
    fakeBuildSettings({ workspace: { parallel: 'many', jobs: 8 } });
    assert.deepStrictEqual(readWorkspaceDefaults(false), {
      limits: { jobs: { value: 8, source: 'workspace default' } },
      problems: [],
    });
  });

  test('null or missing values give no value and no problem', () => {
    fakeBuildSettings({ workspace: { parallel: null } });
    assert.deepStrictEqual(readWorkspaceDefaults(true), { limits: {}, problems: [] });
  });

  const invalid: { value: unknown; shown: string }[] = [
    { value: 0, shown: '0' },
    { value: -1, shown: '-1' },
    { value: 4.5, shown: '4.5' },
    { value: '4', shown: '"4"' },
    { value: true, shown: 'true' },
  ];

  for (const { value, shown } of invalid) {
    test(`a saved ${shown} is reported once and not used`, () => {
      fakeBuildSettings({ workspace: { parallel: value, jobs: value } });
      assert.deepStrictEqual(readWorkspaceDefaults(true), {
        limits: {},
        problems: [
          {
            setting: 'the-seed.build.parallel',
            value,
            message: `The setting "the-seed.build.parallel" is ${shown}; expected a positive whole number. Using 1 project at a time for this build.`,
          },
          {
            setting: 'the-seed.build.jobs',
            value,
            message: `The setting "the-seed.build.jobs" is ${shown}; expected a positive whole number. Using the processor count for this build.`,
          },
        ],
      });
    });
  }

  test('a value in the user settings is ignored', () => {
    fakeBuildSettings({ user: { parallel: 4, jobs: 'six' } });
    assert.deepStrictEqual(readWorkspaceDefaults(true), { limits: {}, problems: [] });
  });

  test('saving writes only the given keys, at workspace level', async () => {
    const settings = fakeBuildSettings({ workspace: { parallel: 2 }, user: { jobs: 3 } });

    await saveWorkspaceDefaults({ jobs: 6 });

    assert.deepStrictEqual(settings.updates, [{ key: 'jobs', value: 6, target: vscode.ConfigurationTarget.Workspace }]);
    assert.deepStrictEqual(settings.workspace, { parallel: 2, jobs: 6 });
    assert.deepStrictEqual(settings.user, { jobs: 3 }, 'the user settings are unchanged');
  });

  test('saving an empty value removes that default', async () => {
    const settings = fakeBuildSettings({ workspace: { parallel: 2, jobs: 6 } });

    await saveWorkspaceDefaults({ parallel: undefined });

    assert.deepStrictEqual(settings.workspace, { jobs: 6 });
  });

  test('saving is offered only when a folder is open', () => {
    assert.strictEqual(canSaveWorkspaceDefaults(), true);
    state.setWorkspaceFolders([]);
    assert.strictEqual(canSaveWorkspaceDefaults(), vscode.workspace.workspaceFile !== undefined);
    assert.strictEqual(canSaveWorkspaceDefaults(), false, 'the test editor has no workspace file either');
  });
});
