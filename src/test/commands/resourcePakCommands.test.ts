// Resource pak commands through the command registry: Create Resource Pak,
// Add Resource and Build Resource Pak. Prompts are stubbed (the scope pick,
// the name input, the file and folder dialogs), the output panel is observed
// through a stub of the shared channel's appendLine, and the command that
// opens a folder is recorded instead of run. Each case runs against a scratch
// home with one scope and a scratch prefix.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { getOutputChannel } from '../../outputChannel';
import { describeError } from '../../utils/projectFolder';
import { useScratchState } from '../helpers/scratchState';
import { readTree } from '../helpers/workspaceStub';
import { testTool } from '../helpers/tool';

const SCOPE = '@acme';
const NAME = 'sprites';

suite('Resource Pak Commands', () => {
  const state = useScratchState({ scopes: { [SCOPE]: 'Ada Lovelace' } });
  let panel: string[];
  let opened: unknown[][];
  let info: sinon.SinonStub;
  let error: sinon.SinonStub;

  setup(() => {
    panel = [];
    opened = [];
    sinon.stub(getOutputChannel(), 'appendLine').callsFake((text: string) => { panel.push(text); });
    info = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
    sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);
    const original = vscode.commands.executeCommand.bind(vscode.commands);
    sinon.stub(vscode.commands, 'executeCommand').callsFake(((command: string, ...args: unknown[]) => {
      if (command === 'vscode.openFolder') {
        opened.push(args);
        return Promise.resolve(undefined);
      }
      return original(command, ...args);
    }) as typeof vscode.commands.executeCommand);
  });

  function messages(stub: sinon.SinonStub): string[] {
    return stub.getCalls().map((call) => String(call.args[0]));
  }

  /** A resource pak project created by the tool in a scratch workspace folder, which is opened. */
  function openPakProject(): string {
    const workspace = state.dir('workspace');
    const config = new (testTool().Config)();
    config.loadConfig();
    const packageDir = new (testTool().ResourcePak)(config).createPackage(SCOPE, NAME, workspace);
    state.setWorkspaceFolders([packageDir]);
    return packageDir;
  }

  function readResources(packageDir: string): { name: string; filename: string }[] {
    return JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf-8')).resources;
  }

  suite('Create Resource Pak', () => {
    test('a dismissed scope pick creates nothing', async () => {
      const workspace = state.dir('workspace');
      state.setWorkspaceFolders([workspace]);
      sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);
      const input = sinon.stub(vscode.window, 'showInputBox').resolves(NAME);

      await vscode.commands.executeCommand('the-seed.createResourcePak');

      assert.ok(input.notCalled, 'no name is asked for');
      assert.deepStrictEqual(fs.readdirSync(workspace), []);
      assert.deepStrictEqual(panel, []);
      assert.ok(info.notCalled);
      assert.strictEqual(opened.length, 0);
    });

    test('a dismissed name input creates nothing', async () => {
      const workspace = state.dir('workspace');
      state.setWorkspaceFolders([workspace]);
      sinon.stub(vscode.window, 'showQuickPick').resolves(SCOPE as never);
      sinon.stub(vscode.window, 'showInputBox').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.createResourcePak');

      assert.deepStrictEqual(fs.readdirSync(workspace), []);
      assert.deepStrictEqual(panel, []);
      assert.ok(info.notCalled);
      assert.strictEqual(opened.length, 0);
    });

    test('a dismissed folder chooser with no folder open creates nothing', async () => {
      const chosen = state.dir('chosen');
      sinon.stub(vscode.window, 'showQuickPick').resolves(SCOPE as never);
      sinon.stub(vscode.window, 'showInputBox').resolves(NAME);
      const dialog = sinon.stub(vscode.window, 'showOpenDialog').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.createResourcePak');

      assert.strictEqual(dialog.callCount, 1);
      assert.deepStrictEqual(fs.readdirSync(chosen), []);
      assert.deepStrictEqual(fs.readdirSync(state.prefix!), []);
      assert.deepStrictEqual(panel, []);
      assert.ok(info.notCalled);
      assert.strictEqual(opened.length, 0);
    });

    test('with a folder open the pak is created inside it, reported, and nothing is opened', async () => {
      const workspace = state.dir('workspace');
      state.setWorkspaceFolders([workspace]);
      sinon.stub(vscode.window, 'showQuickPick').resolves(SCOPE as never);
      sinon.stub(vscode.window, 'showInputBox').resolves(NAME);
      const dialog = sinon.stub(vscode.window, 'showOpenDialog').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.createResourcePak');

      const packageDir = path.join(workspace, NAME);
      assert.ok(dialog.notCalled, 'no folder is asked for while a folder is open');
      assert.ok(fs.existsSync(path.join(packageDir, 'package.json')), 'the pak project is created in the open folder');
      assert.strictEqual(JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf-8')).name, `${SCOPE}/${NAME}`);
      assert.deepStrictEqual(panel, [`[INFO] ResourcePak '${NAME}' created at ${packageDir}`]);
      assert.deepStrictEqual(messages(info), [`ResourcePak '${NAME}' created at ${packageDir}`]);
      assert.ok(error.notCalled);
      assert.deepStrictEqual(fs.readdirSync(state.prefix!), [], 'nothing is written under the prefix');
      assert.strictEqual(opened.length, 0, 'the open folder is not replaced');
    });
  });

  suite('Add Resource', () => {
    test('a dismissed file dialog adds nothing', async () => {
      const packageDir = openPakProject();
      const before = readTree(packageDir);
      sinon.stub(vscode.window, 'showOpenDialog').resolves(undefined);
      const input = sinon.stub(vscode.window, 'showInputBox').resolves('hero');

      await vscode.commands.executeCommand('the-seed.addResource');

      assert.ok(input.notCalled, 'no name is asked for');
      assert.deepStrictEqual(readTree(packageDir), before);
      assert.deepStrictEqual(panel, [`[INFO] ResourcePak: ${packageDir}`]);
      assert.ok(info.notCalled);
      assert.ok(error.notCalled);
    });

    test('a dismissed name input adds nothing', async () => {
      const packageDir = openPakProject();
      const source = path.join(state.dir('source'), 'hero.png');
      fs.writeFileSync(source, 'pixels');
      const before = readTree(packageDir);
      sinon.stub(vscode.window, 'showOpenDialog').resolves([vscode.Uri.file(source)]);
      sinon.stub(vscode.window, 'showInputBox').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.addResource');

      assert.deepStrictEqual(readTree(packageDir), before);
      assert.ok(info.notCalled);
      assert.ok(error.notCalled);
    });

    test('an added file appears in the pak\'s package.json', async () => {
      const packageDir = openPakProject();
      const source = path.join(state.dir('source'), 'hero.png');
      fs.writeFileSync(source, 'pixels');
      sinon.stub(vscode.window, 'showOpenDialog').resolves([vscode.Uri.file(source)]);
      sinon.stub(vscode.window, 'showInputBox').resolves('hero');

      await vscode.commands.executeCommand('the-seed.addResource');

      const resources = readResources(packageDir);
      assert.strictEqual(resources.length, 1);
      assert.strictEqual(resources[0].name, 'hero');
      assert.strictEqual(resources[0].filename, 'hero.png');
      assert.strictEqual(fs.readFileSync(path.join(packageDir, 'hero.png'), 'utf-8'), 'pixels');
      assert.deepStrictEqual(panel, [`[INFO] ResourcePak: ${packageDir}`]);
      assert.deepStrictEqual(messages(info), ['Resource \'hero\' added to ResourcePak']);
      assert.ok(error.notCalled);
    });

    test('a refusal from the tool is shown as the error and written to the panel', async () => {
      const packageDir = openPakProject();
      const sourceDir = state.dir('source');
      const first = path.join(sourceDir, 'hero.png');
      const second = path.join(sourceDir, 'villain.png');
      fs.writeFileSync(first, 'pixels');
      fs.writeFileSync(second, 'other pixels');
      const config = new (testTool().Config)();
      fs.copyFileSync(first, path.join(packageDir, 'hero.png'));
      new (testTool().ResourcePak)(config).addResource('hero', 'hero.png', packageDir);
      const before = readTree(packageDir);
      sinon.stub(vscode.window, 'showOpenDialog').resolves([vscode.Uri.file(second)]);
      sinon.stub(vscode.window, 'showInputBox').resolves('hero');

      await vscode.commands.executeCommand('the-seed.addResource');

      assert.strictEqual(error.callCount, 1);
      const shown = String(error.firstCall.args[0]);
      assert.ok(shown.startsWith(`Resource "hero" already exists in ${SCOPE}/${NAME}`), shown);
      const refusal = new (testTool().ProjectError)(
        'duplicate-resource',
        `Resource "hero" already exists in ${SCOPE}/${NAME}; it refers to hero.png.`,
        testTool().replaceResourceHint()
      );
      assert.strictEqual(shown, describeError(refusal));
      assert.deepStrictEqual(panel, [`[INFO] ResourcePak: ${packageDir}`, `[ERROR] ${shown}`]);
      assert.ok(info.notCalled);
      assert.deepStrictEqual(readTree(packageDir), before, 'the project is unchanged');
    });
  });

  suite('Build Resource Pak', () => {
    test('builds <name>.pak and reports where', async () => {
      const packageDir = openPakProject();
      fs.writeFileSync(path.join(packageDir, 'hero.png'), 'pixels');
      new (testTool().ResourcePak)(new (testTool().Config)()).addResource('hero', 'hero.png', packageDir);

      await vscode.commands.executeCommand('the-seed.buildResourcePak');

      const pak = path.join(packageDir, `${NAME}.pak`);
      assert.ok(fs.existsSync(pak), 'the pak is written');
      assert.ok(fs.readFileSync(pak).includes(Buffer.from('pixels')), 'the pak holds the resource');
      assert.deepStrictEqual(messages(info), [`ResourcePak built successfully: ${pak}`]);
      assert.deepStrictEqual(panel, [`[INFO] ResourcePak: ${packageDir}`]);
      assert.ok(error.notCalled);
    });

    test('reports the path the tool\'s build returned', async () => {
      const packageDir = openPakProject();
      fs.writeFileSync(path.join(packageDir, 'hero.png'), 'pixels');
      new (testTool().ResourcePak)(new (testTool().Config)()).addResource('hero', 'hero.png', packageDir);
      const elsewhere = path.join(state.dir('output'), 'renamed.pak');
      assert.notStrictEqual(elsewhere, path.join(packageDir, `${NAME}.pak`), 'the case needs a path other than <dir>/<name>.pak');
      sinon.stub(testTool().ResourcePak.prototype, 'build').returns(elsewhere);

      await vscode.commands.executeCommand('the-seed.buildResourcePak');

      assert.deepStrictEqual(messages(info), [`ResourcePak built successfully: ${elsewhere}`]);
      assert.ok(error.notCalled);
    });

    test('a refusal from the tool is shown and nothing is written', async () => {
      const packageDir = openPakProject();
      const description = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf-8'));
      description.resources = [{ name: 'hero', filename: 'hero.png', size: 6 }];
      fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify(description, null, 2) + '\n');
      const before = readTree(packageDir);

      await vscode.commands.executeCommand('the-seed.buildResourcePak');

      const expected = `Resource "hero" refers to hero.png, which is missing.`;
      assert.deepStrictEqual(messages(error), [expected]);
      assert.deepStrictEqual(panel, [`[INFO] ResourcePak: ${packageDir}`, `[ERROR] ${expected}`]);
      assert.ok(info.notCalled);
      assert.deepStrictEqual(readTree(packageDir), before, 'nothing is written');
    });
  });
});
