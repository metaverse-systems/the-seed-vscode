// Interface choices where the contract leaves them open:
// - the module under test is loaded with require() inside each case, so this
//   file compiles before the module exists and the cases fail at run time;
// - a ProjectError from the pak check is shown with showErrorMessage and the
//   case reads the shown text as the first argument, which must contain the
//   error's message and, when it has one, its hint;
// - a workspace folder that is not a pak project does not stop the chooser
//   asking for a folder;
// - the open-folder dialog is stubbed to resolve an array holding one Uri;
// - opening a created project is observed through a stub of
//   vscode.commands.executeCommand that records "vscode.openFolder" without
//   running it and forwards every other command.
// The suite runs in the extension host because it imports vscode.
import * as assert from 'assert';
import * as fs from 'fs';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { writeScopes } from '../helpers/scratchHome';
import { useScratchState } from '../helpers/scratchState';
import type { ToolApi } from '../../tool/toolApi';
import { testTool } from '../helpers/tool';

interface ProjectFolder {
  chooseProjectFolder(): Promise<string | undefined>;
  choosePakProject(tool: ToolApi): Promise<string | undefined>;
  chooseAndRememberPak(tool: ToolApi): Promise<string | undefined>;
  chooseCreationFolder(): Promise<{ folder: string; openAfterCreate: boolean } | undefined>;
  openCreatedProject(projectDir: string): Thenable<unknown>;
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
    const config = new (testTool().Config)();
    config.loadConfig();
    return new (testTool().ResourcePak)(config).createPackage('@acme', name, parent);
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

  suite('chooseCreationFolder', () => {
    test('one open folder: that folder, not opened afterwards, no dialog', async () => {
      const only = scratch('only');
      state.setWorkspaceFolders([only]);
      const dialog = sinon.stub(vscode.window, 'showOpenDialog').resolves(undefined);

      assert.deepStrictEqual(await load().chooseCreationFolder(), { folder: only, openAfterCreate: false });
      assert.ok(dialog.notCalled);
    });

    test('two open folders: the first, not opened afterwards, no dialog', async () => {
      const first = scratch('first');
      const second = scratch('second');
      state.setWorkspaceFolders([first, second]);
      const dialog = sinon.stub(vscode.window, 'showOpenDialog').resolves(undefined);

      assert.deepStrictEqual(await load().chooseCreationFolder(), { folder: first, openAfterCreate: false });
      assert.ok(dialog.notCalled);
    });

    test('no open folder: the chosen folder, opened afterwards', async () => {
      const chosen = scratch('chosen');
      state.setWorkspaceFolders([]);
      const dialog = sinon.stub(vscode.window, 'showOpenDialog').resolves([vscode.Uri.file(chosen)]);

      assert.deepStrictEqual(await load().chooseCreationFolder(), { folder: chosen, openAfterCreate: true });
      assert.ok(dialog.calledOnce);
      assert.deepStrictEqual(dialog.firstCall.args[0], DIALOG_OPTIONS);
    });

    test('no open folder and the chooser dismissed: undefined', async () => {
      state.setWorkspaceFolders([]);
      sinon.stub(vscode.window, 'showOpenDialog').resolves(undefined);

      assert.strictEqual(await load().chooseCreationFolder(), undefined);
    });
  });

  suite('openCreatedProject', () => {
    test('opens the project directory as the window\'s folder', async () => {
      const project = scratch('project');
      const opened: unknown[][] = [];
      const original = vscode.commands.executeCommand.bind(vscode.commands);
      sinon.stub(vscode.commands, 'executeCommand').callsFake(((command: string, ...args: unknown[]) => {
        if (command === 'vscode.openFolder') {
          opened.push(args);
          return Promise.resolve(undefined);
        }
        return original(command, ...args);
      }) as typeof vscode.commands.executeCommand);

      await load().openCreatedProject(project);

      assert.strictEqual(opened.length, 1, 'vscode.openFolder is executed once');
      const target = opened[0][0];
      assert.ok(target instanceof vscode.Uri, 'the folder is passed as a Uri');
      assert.strictEqual(target.toString(), vscode.Uri.file(project).toString());
    });
  });

  suite('choosePakProject', () => {
    test('the pak project in the open folder is returned without asking', async () => {
      const workspace = scratch('workspace');
      const pak = makePak(workspace, 'assets');
      state.setWorkspaceFolders([pak]);
      const dialog = sinon.stub(vscode.window, 'showOpenDialog').resolves(undefined);

      assert.strictEqual(await load().choosePakProject(testTool()), pak);
      assert.ok(dialog.notCalled);
    });

    test('a pak project in a folder inside the open folder is returned without asking', async () => {
      const workspace = scratch('workspace');
      const pak = makePak(workspace, 'assets');
      state.setWorkspaceFolders([workspace]);
      const dialog = sinon.stub(vscode.window, 'showOpenDialog').resolves(undefined);
      const pick = sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);

      assert.strictEqual(await load().choosePakProject(testTool()), pak);
      assert.ok(dialog.notCalled && pick.notCalled);
    });

    test('several pak projects in the open folder: the user picks one', async () => {
      const workspace = scratch('workspace');
      makePak(workspace, 'first');
      const second = makePak(workspace, 'second');
      state.setWorkspaceFolders([workspace]);
      const dialog = sinon.stub(vscode.window, 'showOpenDialog').resolves(undefined);
      const pick = sinon.stub(vscode.window, 'showQuickPick').callsFake(((items: readonly { label: string; packageDir?: string }[]) => (
        Promise.resolve(items.find((item) => item.packageDir === second))
      )) as never);

      assert.strictEqual(await load().choosePakProject(testTool()), second);
      assert.ok(pick.calledOnce);
      assert.ok(dialog.notCalled);
    });

    test('a pak project chosen for the sidebar is used afterwards without asking', async () => {
      const workspace = scratch('workspace');
      const parent = scratch('parent');
      const pak = makePak(parent, 'assets');
      state.setWorkspaceFolders([workspace]);
      sinon.stub(vscode.window, 'showOpenDialog').resolves([vscode.Uri.file(pak)]);

      assert.strictEqual(await load().chooseAndRememberPak(testTool()), pak);
      (vscode.window.showOpenDialog as sinon.SinonStub).resetHistory();

      assert.strictEqual(await load().choosePakProject(testTool()), pak);
      assert.ok((vscode.window.showOpenDialog as sinon.SinonStub).notCalled);
    });

    test('open folder that is not a pak project: asks, and a chosen pak project is returned', async () => {
      const workspace = scratch('workspace');
      const parent = scratch('parent');
      const pak = makePak(parent, 'assets');
      state.setWorkspaceFolders([workspace]);
      const dialog = sinon.stub(vscode.window, 'showOpenDialog').resolves([vscode.Uri.file(pak)]);

      assert.strictEqual(await load().choosePakProject(testTool()), pak);
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

      assert.strictEqual(await load().choosePakProject(testTool()), pak);
      assert.ok(dialog.calledOnce);
    });

    test('cancelled: undefined and nothing shown', async () => {
      state.setWorkspaceFolders([]);
      sinon.stub(vscode.window, 'showOpenDialog').resolves(undefined);
      const error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);

      assert.strictEqual(await load().choosePakProject(testTool()), undefined);
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
        new (testTool().ResourcePak)(new (testTool().Config)()).readProject(notPak);
      } catch (caught) {
        const refusal = caught as Error & { hint?: string };
        expectedMessage = refusal.message;
        expectedHint = refusal.hint;
      }
      assert.notStrictEqual(expectedMessage, '', 'the library must refuse the folder');

      assert.strictEqual(await load().choosePakProject(testTool()), undefined);
      assert.ok(error.calledOnce);
      const shown = String(error.firstCall.args[0]);
      assert.ok(shown.includes(expectedMessage), `shown text "${shown}" lacks the message`);
      if (expectedHint) {
        assert.ok(shown.includes(expectedHint), `shown text "${shown}" lacks the hint`);
      }
    });
  });
});
