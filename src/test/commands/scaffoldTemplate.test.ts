// Interface choices where the contract leaves them open:
// - the extension's creation path for code projects is scaffoldTemplate(kind,
//   outputChannel), with the scope and name answered through stubs of
//   showQuickPick and showInputBox and the folder chooser's showOpenDialog
//   stubbed to a scratch folder; the command that opens a new folder is
//   observed through a stub of vscode.commands.executeCommand that records
//   "vscode.openFolder" and forwards every other command;
// - resource paks are checked through both extension paths: the palette
//   command "the-seed.createResourcePak" (same stubs) and the panel's
//   createResourcePak message (no workspace, folder chooser stubbed);
// - the date is fixed by faking only Date, so the extension's creation and the
//   reference call agree on the year; the reference call also passes it
//   explicitly, as the command line does with the current date;
// - the source search looks for a "projects" path segment, a quoted string
//   "projects" or a "/projects/" fragment, in every .ts and .tsx file under
//   src/ except src/test.
// The suite runs in the extension host because it imports vscode.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import Config from '@metaverse-systems/the-seed/Config';
import Template from '@metaverse-systems/the-seed/Template';
import ResourcePak from '@metaverse-systems/the-seed/ResourcePak';
import { handleMessage } from '../../panels/messageHandler';
import { useScratchState } from '../helpers/scratchState';
import { readTree } from '../helpers/workspaceStub';

type Scaffold = (kind: 'component' | 'system' | 'program', channel: vscode.OutputChannel) => Promise<void>;

function loadScaffold(): Scaffold {
  const mod = require('../../commands/scaffoldTemplate') as { scaffoldTemplate: Scaffold };
  return mod.scaffoldTemplate;
}

const SCOPE = '@acme';
const NAME = 'widget';
const FIXED = new Date('2026-03-04T12:00:00Z');

suite('scaffoldTemplate', () => {
  const state = useScratchState({ scopes: { [SCOPE]: 'Ada Lovelace' } });
  let clock: sinon.SinonFakeTimers;
  let opened: unknown[][];

  function scratch(label: string): string {
    return state.dir(label);
  }

  function stubPrompts(scope: string, name: string): void {
    sinon.stub(vscode.window, 'showQuickPick').resolves(scope as never);
    sinon.stub(vscode.window, 'showInputBox').resolves(name);
    sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);
    sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
  }

  function stubChooser(folder: string): sinon.SinonStub {
    return sinon.stub(vscode.window, 'showOpenDialog').resolves([vscode.Uri.file(folder)]);
  }

  function assertSameTree(actualRoot: string, expectedRoot: string): void {
    const actual = readTree(actualRoot);
    const expected = readTree(expectedRoot);
    assert.deepStrictEqual([...actual.keys()].sort(), [...expected.keys()].sort(), 'paths differ');
    for (const [relative, entry] of expected) {
      assert.deepStrictEqual(actual.get(relative), entry, `${relative} differs`);
    }
  }

  setup(() => {
    clock = sinon.useFakeTimers({ now: FIXED, toFake: ['Date'] });
    opened = [];
    const original = vscode.commands.executeCommand.bind(vscode.commands);
    sinon.stub(vscode.commands, 'executeCommand').callsFake(((command: string, ...args: unknown[]) => {
      if (command === 'vscode.openFolder') {
        opened.push(args);
        return Promise.resolve(undefined);
      }
      return original(command, ...args);
    }) as typeof vscode.commands.executeCommand);
  });

  teardown(() => {
    clock.restore();
  });

  for (const kind of ['component', 'system', 'program'] as const) {
    test(`${kind}: the tree created through the extension equals the tool's`, async () => {
      const chosen = scratch('chosen');
      const reference = scratch('reference');
      stubPrompts(SCOPE, NAME);
      stubChooser(chosen);

      await loadScaffold()(kind, vscode.window.createOutputChannel('scaffold-test'));

      const config = new Config();
      config.loadConfig();
      const template = new Template(config);
      template.type = kind;
      template.createPackage(SCOPE, NAME, reference, FIXED);

      assert.ok(fs.existsSync(path.join(chosen, NAME)), 'project must be created in the chosen folder');
      assertSameTree(path.join(chosen, NAME), path.join(reference, NAME));
      assert.deepStrictEqual(fs.readdirSync(state.prefix!), [], 'nothing may be written under the prefix');
      assert.strictEqual(opened.length, 1, 'the new folder is opened when no workspace was open');
    });
  }

  test('an open folder is used as the parent and no dialog is shown', async () => {
    const workspace = scratch('workspace');
    const reference = scratch('reference');
    state.setWorkspaceFolders([workspace]);
    stubPrompts(SCOPE, NAME);
    const dialog = stubChooser(scratch('unused'));

    await loadScaffold()('component', vscode.window.createOutputChannel('scaffold-test'));

    const config = new Config();
    config.loadConfig();
    const template = new Template(config);
    template.type = 'component';
    template.createPackage(SCOPE, NAME, reference, FIXED);

    assertSameTree(path.join(workspace, NAME), path.join(reference, NAME));
    assert.ok(dialog.notCalled);
    assert.deepStrictEqual(fs.readdirSync(state.prefix!), []);
    assert.strictEqual(opened.length, 0);
  });

  test('cancelling the folder chooser creates nothing', async () => {
    const chosen = scratch('chosen');
    stubPrompts(SCOPE, NAME);
    sinon.stub(vscode.window, 'showOpenDialog').resolves(undefined);

    await loadScaffold()('system', vscode.window.createOutputChannel('scaffold-test'));

    assert.deepStrictEqual(fs.readdirSync(chosen), []);
    assert.deepStrictEqual(fs.readdirSync(state.prefix!), []);
    assert.strictEqual(opened.length, 0);
  });

  test('resource pak through the palette command equals the tool\'s', async () => {
    const chosen = scratch('chosen');
    const reference = scratch('reference');
    stubPrompts(SCOPE, NAME);
    stubChooser(chosen);

    await vscode.commands.executeCommand('the-seed.createResourcePak');

    const config = new Config();
    config.loadConfig();
    new ResourcePak(config).createPackage(SCOPE, NAME, reference);

    assert.ok(fs.existsSync(path.join(chosen, NAME)), 'pak project must be created in the chosen folder');
    assertSameTree(path.join(chosen, NAME), path.join(reference, NAME));
    assert.deepStrictEqual(fs.readdirSync(state.prefix!), [], 'nothing may be written under the prefix');
  });

  test('resource pak through the panel equals the tool\'s', async () => {
    const chosen = scratch('chosen');
    const reference = scratch('reference');
    stubChooser(chosen);

    const response = await handleMessage({
      command: 'createResourcePak',
      requestId: 'scaffold-pak',
      data: { scopeName: SCOPE, pakName: NAME },
    });

    const config = new Config();
    config.loadConfig();
    new ResourcePak(config).createPackage(SCOPE, NAME, reference);

    assert.ok(response && response.type === 'resourcePakCreated', 'expected resourcePakCreated');
    if (response && response.type === 'resourcePakCreated') {
      assert.strictEqual(response.payload.packageDir, path.join(chosen, NAME));
    }
    assertSameTree(path.join(chosen, NAME), path.join(reference, NAME));
    assert.deepStrictEqual(fs.readdirSync(state.prefix!), []);
  });

  test('the extension source has no "projects" path segment', () => {
    const srcRoot = path.resolve(__dirname, '..', '..', '..', 'src');
    assert.ok(fs.existsSync(path.join(srcRoot, 'extension.ts')), `source folder not found at ${srcRoot}`);
    const pattern = /(['"`])projects\1|[\/\\]projects[\/\\]/;
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (full !== path.join(srcRoot, 'test')) {
            walk(full);
          }
        } else if (/\.tsx?$/.test(entry.name)) {
          fs.readFileSync(full, 'utf-8').split('\n').forEach((line, index) => {
            if (pattern.test(line)) {
              offenders.push(`${path.relative(srcRoot, full)}:${index + 1}: ${line.trim()}`);
            }
          });
        }
      }
    };
    walk(srcRoot);
    assert.deepStrictEqual(offenders, []);
  });
});
