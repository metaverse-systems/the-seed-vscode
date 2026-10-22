// Interface choices where the contract leaves them open:
// - the module under test is loaded with require() inside each case, so this
//   file compiles before the module exists and the cases fail at run time;
// - a ProjectError from the pak check is shown with showErrorMessage and the
//   case reads the shown text as the first argument, which must contain the
//   error's message and, when it has one, its hint;
// - a workspace folder that is not a pak project does not stop the chooser
//   asking for a folder;
// - the open-folder dialog is stubbed to resolve an array holding one Uri.
// The suite runs in the extension host because it imports vscode.
import * as assert from 'assert';
import * as fs from 'fs';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import Config from '@metaverse-systems/the-seed/Config';
import ResourcePak from '@metaverse-systems/the-seed/ResourcePak';
import { writeScopes } from '../helpers/scratchHome';
import { useScratchState } from '../helpers/scratchState';

interface ProjectFolder {
  chooseProjectFolder(): Promise<string | undefined>;
  choosePakProject(): Promise<string | undefined>;
}

function load(): ProjectFolder {
  return require('../../utils/projectFolder') as ProjectFolder;
}

const DIALOG_OPTIONS = {
  canSelectFolders: true,
  canSelectFiles: false,
  canSelectMany: false,
  openLabel: 'Create Here',
};

suite('projectFolder', () => {
  const state = useScratchState({ prefix: false });

  function scratch(label: string): string {
    return state.dir(label);
  }

  function makePak(parent: string, name: string): string {
    writeScopes({ '@acme': 'Ada Lovelace' });
    const config = new Config();
    config.loadConfig();
    return new ResourcePak(config).createPackage('@acme', name, parent);
  }

  suite('chooseProjectFolder', () => {
    test('an open folder is returned without asking', async () => {
      const first = scratch('first');
      const second = scratch('second');
      state.setWorkspaceFolders([first, second]);
      const dialog = sinon.stub(vscode.window, 'showOpenDialog').resolves(undefined);

      assert.strictEqual(await load().chooseProjectFolder(), first);
      assert.ok(dialog.notCalled);
    });

    test('no open folder: asks with the folder options and returns the chosen path', async () => {
      const chosen = scratch('chosen');
      state.setWorkspaceFolders([]);
      const dialog = sinon.stub(vscode.window, 'showOpenDialog').resolves([vscode.Uri.file(chosen)]);

      assert.strictEqual(await load().chooseProjectFolder(), chosen);
      assert.ok(dialog.calledOnce);
      assert.deepStrictEqual(dialog.firstCall.args[0], DIALOG_OPTIONS);
    });

    test('no open folder and the dialog cancelled: undefined', async () => {
      state.setWorkspaceFolders([]);
      sinon.stub(vscode.window, 'showOpenDialog').resolves(undefined);
      assert.strictEqual(await load().chooseProjectFolder(), undefined);
    });

    test('no open folder and an empty selection: undefined', async () => {
      state.setWorkspaceFolders([]);
      sinon.stub(vscode.window, 'showOpenDialog').resolves([]);
      assert.strictEqual(await load().chooseProjectFolder(), undefined);
    });
  });

  suite('choosePakProject', () => {
    test('the pak project in the open folder is returned without asking', async () => {
      const workspace = scratch('workspace');
      const pak = makePak(workspace, 'assets');
      state.setWorkspaceFolders([pak]);
      const dialog = sinon.stub(vscode.window, 'showOpenDialog').resolves(undefined);

      assert.strictEqual(await load().choosePakProject(), pak);
      assert.ok(dialog.notCalled);
    });

    test('open folder that is not a pak project: asks, and a chosen pak project is returned', async () => {
      const workspace = scratch('workspace');
      const parent = scratch('parent');
      const pak = makePak(parent, 'assets');
      state.setWorkspaceFolders([workspace]);
      const dialog = sinon.stub(vscode.window, 'showOpenDialog').resolves([vscode.Uri.file(pak)]);

      assert.strictEqual(await load().choosePakProject(), pak);
      assert.ok(dialog.calledOnce);
      const options = dialog.firstCall.args[0] as vscode.OpenDialogOptions;
      assert.strictEqual(options.canSelectFolders, true);
      assert.strictEqual(options.canSelectFiles, false);
      assert.strictEqual(options.canSelectMany, false);
    });

    test('no open folder: asks, and a chosen pak project is returned', async () => {
      const parent = scratch('parent');
      const pak = makePak(parent, 'assets');
      state.setWorkspaceFolders([]);
      const dialog = sinon.stub(vscode.window, 'showOpenDialog').resolves([vscode.Uri.file(pak)]);

      assert.strictEqual(await load().choosePakProject(), pak);
      assert.ok(dialog.calledOnce);
    });

    test('cancelled: undefined and nothing shown', async () => {
      state.setWorkspaceFolders([]);
      sinon.stub(vscode.window, 'showOpenDialog').resolves(undefined);
      const error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);

      assert.strictEqual(await load().choosePakProject(), undefined);
      assert.ok(error.notCalled);
    });

    test('a chosen folder that is not a pak project: the tool\'s error is shown and undefined returned', async () => {
      const notPak = scratch('not-pak');
      state.setWorkspaceFolders([]);
      sinon.stub(vscode.window, 'showOpenDialog').resolves([vscode.Uri.file(notPak)]);
      const error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);

      let expectedMessage = '';
      let expectedHint: string | undefined;
      try {
        new ResourcePak(new Config()).readProject(notPak);
      } catch (caught) {
        const refusal = caught as Error & { hint?: string };
        expectedMessage = refusal.message;
        expectedHint = refusal.hint;
      }
      assert.notStrictEqual(expectedMessage, '', 'the library must refuse the folder');

      assert.strictEqual(await load().choosePakProject(), undefined);
      assert.ok(error.calledOnce);
      const shown = String(error.firstCall.args[0]);
      assert.ok(shown.includes(expectedMessage), `shown text "${shown}" lacks the message`);
      if (expectedHint) {
        assert.ok(shown.includes(expectedHint), `shown text "${shown}" lacks the hint`);
      }
    });
  });
});
