// Starting a build: the refusal texts, the project choice (no folder, one
// project, a pick, a dismissed pick) and the refusal when another operation
// holds the lock. The cases with package.json files write real files in a
// scratch workspace folder and stub the workspace search, because the real
// search does not see stubbed workspace folders.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { acquireOperationLock, getOperationLock } from '../../operationLock';
import { buildRefusal, chooseBuildProject, startBuild } from '../../build/buildStart';
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

    const start = await startBuild({ releaseDescription: 'Release', projectPlaceHolder: 'Select a project to build' });

    assert.strictEqual(start, undefined);
    assert.strictEqual(warning.callCount, 1);
    assert.strictEqual(warning.firstCall.args[0], 'Cannot build while an install operation is in progress.');
    assert.ok(pick.notCalled && error.notCalled, 'no prompt and no error');
    const lock = getOperationLock();
    assert.strictEqual(lock.type, 'install');
    assert.strictEqual(lock.abortController, held.abortController);
  });
});
