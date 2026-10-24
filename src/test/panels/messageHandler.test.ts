// Interface choices where the contract leaves them open:
// - the folder-based cases post the messages without the fields the panel no
//   longer sends (scope, pakName, useDetectedPak on addResource; any data on
//   buildResourcePak), through post(), which casts them to the message type so
//   this file compiles before the types change;
// - an error response is read as { type: 'error', payload: { message, hint? } }
//   and a refusal by the tool is compared with the ProjectError the library
//   throws for the same call (message and hint equal);
// - a cancelled folder chooser is checked only by "not created" and an
//   untouched scratch folder and prefix, since the response is not fixed;
// - the open folder, the folder chooser and the prefix are scratch: the
//   workspace folders and showOpenDialog are stubbed and the home is a
//   scratch directory.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { handleMessage as handleWithService } from '../../panels/messageHandler';
import type Config from '@metaverse-systems/the-seed/Config';
import { activeToolService } from '../../tool/toolService';
import { createCertFor, writeScopes } from '../helpers/scratchHome';
import { ScratchState, useScratchState } from '../helpers/scratchState';
import { withoutInternalMembers } from '../helpers/stubTool';
import { testTool, useToolApi } from '../helpers/tool';
import type { ToolApi } from '../../tool/toolApi';

type Message = Parameters<typeof handleWithService>[0];
type Push = NonNullable<Parameters<typeof handleWithService>[1]>;

/** handleMessage as the extension calls it: with the service of the running extension. */
function handleMessage(message: Message, push?: Push): ReturnType<typeof handleWithService> {
  return handleWithService(message, push, activeToolService());
}
interface LooseResponse {
  type: string;
  payload: { message: string; hint?: string; projectPath: string; templateType: string; openFolder: boolean; packageDir: string };
}

const SCOPE = '@acme';

let state: ScratchState;

async function post(message: object, push?: Push): Promise<LooseResponse | null> {
  const response = await handleMessage(message as unknown as Message, push);
  return response as unknown as LooseResponse | null;
}

function scratch(label: string): string {
  return state.dir(label);
}

function stubChooser(folder: string): sinon.SinonStub {
  return sinon.stub(vscode.window, 'showOpenDialog').resolves([vscode.Uri.file(folder)]);
}

function loadConfig(): Config {
  const config = new (testTool().Config)();
  config.loadConfig();
  return config;
}

/** What the library throws for a refused call: the text the panel must pass on. */
function refusal(call: () => unknown): { message: string; hint?: string } {
  try {
    call();
  } catch (caught) {
    const error = caught as Error & { hint?: string };
    return { message: error.message, hint: error.hint };
  }
  assert.fail('the library was expected to refuse the call');
}

suite('messageHandler', () => {
  state = useScratchState({ scopes: { [SCOPE]: 'Ada Lovelace' } });

  test('unknown command responds with error', async () => {
    const response = await handleMessage({
      command: 'unknownCommand' as 'ready',
    });
    assert.ok(response, 'Should return a response');
    assert.strictEqual(response!.type, 'error');
    if (response!.type === 'error') {
      assert.ok(
        response!.payload.message.includes('Unknown command'),
        'Error should mention unknown command'
      );
    }
  });

  test('ready command responds with configLoaded', async () => {
    const response = await handleMessage({ command: 'ready' });
    assert.ok(response, 'Should return a response');
    assert.strictEqual(response!.type, 'configLoaded');
    if (response!.type === 'configLoaded') {
      assert.ok(
        typeof response!.payload.prefix === 'string',
        'Payload should have prefix string'
      );
      assert.ok(
        typeof response!.payload.isDefault === 'boolean',
        'Payload should have isDefault boolean'
      );
      assert.ok(
        Array.isArray(response!.payload.scopes),
        'Payload should have scopes array'
      );
    }
  });

  test('getConfig command responds with configLoaded and requestId', async () => {
    const response = await handleMessage({
      command: 'getConfig',
      requestId: 'test-123',
    });
    assert.ok(response, 'Should return a response');
    assert.strictEqual(response!.type, 'configLoaded');
    if (response!.type === 'configLoaded') {
      assert.strictEqual(response!.requestId, 'test-123');
    }
  });

  test('savePrefix command responds with prefixSaved', async () => {
    const savedPrefix = state.dir('saved-prefix');
    const response = await handleMessage({
      command: 'savePrefix',
      requestId: 'test-save-prefix',
      data: { prefix: savedPrefix },
    });
    assert.ok(response, 'Should return a response');
    assert.strictEqual(response!.type, 'prefixSaved');
    if (response!.type === 'prefixSaved') {
      assert.strictEqual(response!.requestId, 'test-save-prefix');
      assert.strictEqual(response!.payload.prefix, savedPrefix);
    }
  });

  test('addScope with new scope responds with scopeAdded', async () => {
    const uniqueScope = `@test-scope-${Date.now()}`;
    const response = await handleMessage({
      command: 'addScope',
      requestId: 'test-add',
      data: {
        scopeName: uniqueScope,
        authorName: 'Test Author',
        authorEmail: 'test@test.com',
        authorUrl: 'https://test.com',
      },
    });
    assert.ok(response, 'Should return a response');
    assert.strictEqual(response!.type, 'scopeAdded');
    if (response!.type === 'scopeAdded') {
      assert.strictEqual(response!.requestId, 'test-add');
      const found = response!.payload.scopes.find((s) => s.name === uniqueScope);
      assert.ok(found, 'Newly added scope should be in payload');
    }

    // Cleanup: delete the scope
    await handleMessage({
      command: 'deleteScope',
      requestId: 'cleanup',
      data: { scopeName: uniqueScope },
    });
  });

  test('addScope with existing scope responds with scopeExists', async () => {
    const uniqueScope = `@test-exists-${Date.now()}`;
    // First add
    await handleMessage({
      command: 'addScope',
      requestId: 'setup',
      data: {
        scopeName: uniqueScope,
        authorName: 'First',
        authorEmail: '',
        authorUrl: '',
      },
    });

    // Second add (duplicate)
    const response = await handleMessage({
      command: 'addScope',
      requestId: 'test-dup',
      data: {
        scopeName: uniqueScope,
        authorName: 'Second',
        authorEmail: '',
        authorUrl: '',
      },
    });
    assert.ok(response, 'Should return a response');
    assert.strictEqual(response!.type, 'scopeExists');
    if (response!.type === 'scopeExists') {
      assert.strictEqual(response!.requestId, 'test-dup');
      assert.strictEqual(response!.payload.scopeName, uniqueScope);
    }

    // Cleanup
    await handleMessage({
      command: 'deleteScope',
      requestId: 'cleanup',
      data: { scopeName: uniqueScope },
    });
  });

  test('confirmOverwriteScope responds with scopeAdded', async () => {
    const uniqueScope = `@test-overwrite-${Date.now()}`;
    // First create
    await handleMessage({
      command: 'addScope',
      requestId: 'setup',
      data: {
        scopeName: uniqueScope,
        authorName: 'Original',
        authorEmail: '',
        authorUrl: '',
      },
    });

    // Overwrite
    const response = await handleMessage({
      command: 'confirmOverwriteScope',
      requestId: 'test-overwrite',
      data: {
        scopeName: uniqueScope,
        authorName: 'Updated',
        authorEmail: 'new@test.com',
        authorUrl: '',
      },
    });
    assert.ok(response, 'Should return a response');
    assert.strictEqual(response!.type, 'scopeAdded');

    // Cleanup
    await handleMessage({
      command: 'deleteScope',
      requestId: 'cleanup',
      data: { scopeName: uniqueScope },
    });
  });

  test('editScope responds with scopeEdited', async () => {
    const uniqueScope = `@test-edit-${Date.now()}`;
    // First create
    await handleMessage({
      command: 'addScope',
      requestId: 'setup',
      data: {
        scopeName: uniqueScope,
        authorName: 'Original',
        authorEmail: '',
        authorUrl: '',
      },
    });

    // Edit
    const response = await handleMessage({
      command: 'editScope',
      requestId: 'test-edit',
      data: {
        scopeName: uniqueScope,
        authorName: 'Edited Author',
        authorEmail: 'edited@test.com',
        authorUrl: 'https://edited.com',
      },
    });
    assert.ok(response, 'Should return a response');
    assert.strictEqual(response!.type, 'scopeEdited');
    if (response!.type === 'scopeEdited') {
      assert.strictEqual(response!.requestId, 'test-edit');
      const found = response!.payload.scopes.find((s) => s.name === uniqueScope);
      assert.ok(found, 'Edited scope should exist');
      assert.strictEqual(found!.author.name, 'Edited Author');
    }

    // Cleanup
    await handleMessage({
      command: 'deleteScope',
      requestId: 'cleanup',
      data: { scopeName: uniqueScope },
    });
  });

  test('deleteScope responds with scopeDeleted', async () => {
    const uniqueScope = `@test-delete-${Date.now()}`;
    // First create
    await handleMessage({
      command: 'addScope',
      requestId: 'setup',
      data: {
        scopeName: uniqueScope,
        authorName: 'ToDelete',
        authorEmail: '',
        authorUrl: '',
      },
    });

    // Delete
    const response = await handleMessage({
      command: 'deleteScope',
      requestId: 'test-del',
      data: { scopeName: uniqueScope },
    });
    assert.ok(response, 'Should return a response');
    assert.strictEqual(response!.type, 'scopeDeleted');
    if (response!.type === 'scopeDeleted') {
      assert.strictEqual(response!.requestId, 'test-del');
      const found = response!.payload.scopes.find((s) => s.name === uniqueScope);
      assert.ok(!found, 'Deleted scope should not be in payload');
    }
  });

  suite('createTemplate', () => {
    function create(templateType: 'component' | 'system' | 'program', templateName: string, scopeName = SCOPE) {
      return post({
        command: 'createTemplate',
        requestId: `create-${templateType}`,
        data: { templateType, scopeName, templateName },
      });
    }

    for (const kind of ['component', 'system', 'program'] as const) {
      test(`${kind}: no open folder asks for a folder and creates the project there`, async () => {
        const chosen = scratch('chosen');
        const dialog = stubChooser(chosen);

        const response = await create(kind, 'widget');

        assert.strictEqual(response?.type, 'templateCreated');
        assert.ok(dialog.calledOnce, 'the folder chooser must be asked');
        const projectPath = path.join(chosen, 'widget');
        assert.strictEqual(response!.payload.projectPath, projectPath);
        assert.strictEqual(response!.payload.templateType, kind);
        assert.strictEqual(response!.payload.openFolder, true);
        assert.ok(fs.existsSync(projectPath), 'project directory should exist on disk');
        assert.strictEqual(fs.existsSync(path.join(projectPath, 'widget.pc.in')), kind !== 'program');
        assert.deepStrictEqual(fs.readdirSync(state.prefix!), [], 'nothing may be written under the prefix');
      });
    }

    test('an open folder is used without asking and is not reopened', async () => {
      const workspace = scratch('workspace');
      state.setWorkspaceFolders([workspace]);
      const dialog = stubChooser(scratch('unused'));

      const response = await create('component', 'widget');

      assert.strictEqual(response?.type, 'templateCreated');
      assert.ok(dialog.notCalled);
      assert.strictEqual(response!.payload.projectPath, path.join(workspace, 'widget'));
      assert.strictEqual(response!.payload.openFolder, false);
      assert.deepStrictEqual(fs.readdirSync(state.prefix!), []);
    });

    test('cancelling the folder chooser creates nothing', async () => {
      const chosen = scratch('chosen');
      sinon.stub(vscode.window, 'showOpenDialog').resolves(undefined);

      const response = await create('system', 'widget');

      assert.notStrictEqual(response?.type, 'templateCreated');
      assert.deepStrictEqual(fs.readdirSync(chosen), []);
      assert.deepStrictEqual(fs.readdirSync(state.prefix!), []);
    });

    test('existing directory returns templateExists and keeps its files', async () => {
      const workspace = scratch('workspace');
      fs.mkdirSync(path.join(workspace, 'widget'));
      fs.writeFileSync(path.join(workspace, 'widget', 'mine.txt'), 'mine');
      state.setWorkspaceFolders([workspace]);

      const response = await create('component', 'widget');

      assert.strictEqual(response?.type, 'templateExists');
      assert.strictEqual(response!.payload.projectPath, path.join(workspace, 'widget'));
      assert.deepStrictEqual(fs.readdirSync(path.join(workspace, 'widget')), ['mine.txt']);
      assert.strictEqual(fs.readFileSync(path.join(workspace, 'widget', 'mine.txt'), 'utf-8'), 'mine');
    });

    test('an invalid name gives an error with the tool\'s message and hint', async () => {
      const chosen = scratch('chosen');
      stubChooser(chosen);

      const response = await create('component', '3d.thing');

      assert.strictEqual(response?.type, 'error');
      const template = new (testTool().Template)(loadConfig());
      template.type = 'component';
      const expected = refusal(() => template.createPackage(SCOPE, '3d.thing', chosen));
      assert.strictEqual(response!.payload.message, expected.message);
      assert.strictEqual(response!.payload.hint, expected.hint);
      assert.deepStrictEqual(fs.readdirSync(chosen), []);
    });

    test('an author without a name gives an error with the tool\'s message and hint', async () => {
      writeScopes({ [SCOPE]: 'Ada Lovelace', '@anon': '' });
      const chosen = scratch('chosen');
      stubChooser(chosen);

      const response = await create('program', 'widget', '@anon');

      assert.strictEqual(response?.type, 'error');
      const template = new (testTool().Template)(loadConfig());
      template.type = 'program';
      const expected = refusal(() => template.createPackage('@anon', 'widget', chosen));
      assert.ok(expected.hint, 'the tool gives a hint for a missing author name');
      assert.strictEqual(response!.payload.message, expected.message);
      assert.strictEqual(response!.payload.hint, expected.hint);
      assert.deepStrictEqual(fs.readdirSync(chosen), []);
    });
  });

  suite('Build Messages', () => {
    test('startBuild responds with buildStarted and runs the native build command when no build is running', async () => {
      const execute = sinon.stub(vscode.commands, 'executeCommand').resolves(undefined);
      const response = await handleMessage({
        command: 'startBuild',
        requestId: 'test-build-1',
        data: { target: 'native' },
      });
      assert.ok(response, 'Should return a response');
      assert.strictEqual(response!.type, 'buildStarted');
      assert.strictEqual(response!.requestId, 'test-build-1');
      assert.ok(execute.calledOnceWithExactly('the-seed.buildNative'), 'the native build command should be started once');
    });

    test('cancelBuild responds with buildCancelled', async () => {
      const response = await handleMessage({
        command: 'cancelBuild',
        requestId: 'test-cancel-1',
      });
      assert.ok(response, 'Should return a response');
      assert.strictEqual(response!.type, 'buildCancelled');
      if (response!.type === 'buildCancelled') {
        assert.strictEqual(response!.requestId, 'test-cancel-1');
      }
    });

    test('getBuildStatus responds with buildStatusResponse', async () => {
      const response = await handleMessage({
        command: 'getBuildStatus',
        requestId: 'test-status-1',
      });
      assert.ok(response, 'Should return a response');
      assert.strictEqual(response!.type, 'buildStatusResponse');
      if (response!.type === 'buildStatusResponse') {
        assert.strictEqual(response!.requestId, 'test-status-1');
        assert.ok(response!.payload, 'Should have payload');
        assert.ok(
          ['idle', 'running', 'completed', 'failed', 'cancelled'].includes(response!.payload.state),
          'State should be a valid BuildState'
        );
      }
    });
  });

  suite('ResourcePak Messages', () => {
    test('getResourcePakStatus responds with resourcePakStatus', async () => {
      const response = await handleMessage({
        command: 'getResourcePakStatus',
        requestId: 'test-rpak-status-1',
      });
      assert.ok(response, 'Should return a response');
      assert.strictEqual(response!.type, 'resourcePakStatus');
      if (response!.type === 'resourcePakStatus') {
        assert.strictEqual(response!.requestId, 'test-rpak-status-1');
        assert.ok(typeof response!.payload.detected === 'boolean', 'Should have detected boolean');
      }
    });

    test('createResourcePak with no open folder asks for a folder and creates the pak there', async () => {
      const chosen = scratch('chosen');
      const dialog = stubChooser(chosen);

      const response = await post({
        command: 'createResourcePak',
        requestId: 'rpak-create',
        data: { scopeName: SCOPE, pakName: 'assets' },
      });

      assert.ok(response && response.type === 'resourcePakCreated', 'expected resourcePakCreated');
      assert.ok(dialog.calledOnce);
      assert.strictEqual(response!.payload.packageDir, path.join(chosen, 'assets'));
      assert.ok(fs.existsSync(path.join(chosen, 'assets', 'package.json')));
      assert.deepStrictEqual(fs.readdirSync(state.prefix!), []);
    });

    test('createResourcePak with the chooser cancelled creates nothing', async () => {
      const chosen = scratch('chosen');
      sinon.stub(vscode.window, 'showOpenDialog').resolves(undefined);

      const response = await post({
        command: 'createResourcePak',
        requestId: 'rpak-cancel',
        data: { scopeName: SCOPE, pakName: 'assets' },
      });

      assert.notStrictEqual(response?.type, 'resourcePakCreated');
      assert.deepStrictEqual(fs.readdirSync(chosen), []);
      assert.deepStrictEqual(fs.readdirSync(state.prefix!), []);
    });

    test('createResourcePak with an existing target gives the tool\'s message and hint', async () => {
      const workspace = scratch('workspace');
      fs.mkdirSync(path.join(workspace, 'assets'));
      fs.writeFileSync(path.join(workspace, 'assets', 'mine.txt'), 'mine');
      state.setWorkspaceFolders([workspace]);

      const response = await post({
        command: 'createResourcePak',
        requestId: 'rpak-exists',
        data: { scopeName: SCOPE, pakName: 'assets' },
      });

      assert.strictEqual(response?.type, 'error');
      const expected = refusal(() => new (testTool().ResourcePak)(loadConfig()).createPackage(SCOPE, 'assets', workspace));
      assert.strictEqual(response!.payload.message, expected.message);
      assert.strictEqual(response!.payload.hint, expected.hint);
      assert.strictEqual(fs.readFileSync(path.join(workspace, 'assets', 'mine.txt'), 'utf-8'), 'mine');
    });

    test('createResourcePak with an invalid name gives the tool\'s message and hint', async () => {
      const chosen = scratch('chosen');
      stubChooser(chosen);

      const response = await post({
        command: 'createResourcePak',
        requestId: 'rpak-invalid',
        data: { scopeName: SCOPE, pakName: '3d.thing' },
      });

      assert.strictEqual(response?.type, 'error');
      const expected = refusal(() => new (testTool().ResourcePak)(loadConfig()).createPackage(SCOPE, '3d.thing', chosen));
      assert.strictEqual(response!.payload.message, expected.message);
      assert.strictEqual(response!.payload.hint, expected.hint);
      assert.deepStrictEqual(fs.readdirSync(chosen), []);
    });

    suite('with a pak project in the open folder', () => {
      let pak: string;
      let sources: string;

      setup(() => {
        const workspace = scratch('workspace');
        pak = new (testTool().ResourcePak)(loadConfig()).createPackage(SCOPE, 'assets', workspace);
        sources = scratch('sources');
        state.setWorkspaceFolders([pak]);
      });

      function source(name: string, text: string): string {
        const file = path.join(sources, name);
        fs.writeFileSync(file, text);
        return file;
      }

      function resourceNames(): string[] {
        const project = JSON.parse(fs.readFileSync(path.join(pak, 'package.json'), 'utf-8')) as { resources: Array<{ name: string }> };
        return project.resources.map((r) => r.name);
      }

      test('addResource with { resourceName, filePath } copies the file in and records it', async () => {
        const response = await post({
          command: 'addResource',
          requestId: 'add-ok',
          data: { resourceName: 'any name at all', filePath: source('tex.png', 'texture') },
        });

        assert.strictEqual(response?.type, 'resourceAdded');
        assert.deepStrictEqual(resourceNames(), ['any name at all']);
        assert.strictEqual(fs.readFileSync(path.join(pak, 'tex.png'), 'utf-8'), 'texture');
      });

      test('addResource of a duplicate refuses before copying any file', async () => {
        await post({
          command: 'addResource',
          requestId: 'add-first',
          data: { resourceName: 'tex', filePath: source('tex.png', 'texture') },
        });
        const before = fs.readdirSync(pak).sort();

        const response = await post({
          command: 'addResource',
          requestId: 'add-dup',
          data: { resourceName: 'tex', filePath: source('other.png', 'other') },
        });

        const expected = refusal(() => new (testTool().ResourcePak)(loadConfig()).addResource('tex', 'tex.png', pak));
        assert.strictEqual(response?.type, 'error');
        assert.strictEqual(response!.payload.message, expected.message);
        assert.strictEqual(response!.payload.hint, expected.hint);
        assert.deepStrictEqual(fs.readdirSync(pak).sort(), before, 'no file may be copied in');
        assert.deepStrictEqual(resourceNames(), ['tex']);
      });

      test('addResource never overwrites a different file of the same base name', async () => {
        await post({
          command: 'addResource',
          requestId: 'add-first',
          data: { resourceName: 'first', filePath: source('data.bin', 'original') },
        });
        const elsewhere = path.join(scratch('elsewhere'), 'data.bin');
        fs.writeFileSync(elsewhere, 'different');

        const response = await post({
          command: 'addResource',
          requestId: 'add-clash',
          data: { resourceName: 'second', filePath: elsewhere },
        });

        assert.strictEqual(response?.type, 'error');
        assert.strictEqual(fs.readFileSync(path.join(pak, 'data.bin'), 'utf-8'), 'original');
        assert.deepStrictEqual(resourceNames(), ['first']);
      });

      test('addResource with a missing file responds with error', async () => {
        const response = await post({
          command: 'addResource',
          requestId: 'add-missing',
          data: { resourceName: 'res1', filePath: path.join(sources, 'nonexistent.txt') },
        });
        assert.strictEqual(response?.type, 'error');
        assert.ok(response!.payload.message.includes('not found'), 'Error should mention file not found');
        assert.deepStrictEqual(resourceNames(), []);
      });

      test('buildResourcePak without data builds the detected pak', async () => {
        await post({
          command: 'addResource',
          requestId: 'add-first',
          data: { resourceName: 'tex', filePath: source('tex.png', 'texture') },
        });
        const pushed: Array<{ type: string; payload: { state?: string } }> = [];

        const response = await post(
          { command: 'buildResourcePak', requestId: 'build-ok' },
          (msg) => pushed.push(msg as unknown as { type: string; payload: { state?: string } })
        );

        assert.strictEqual(response?.type, 'resourcePakBuilt');
        assert.ok(fs.existsSync(path.join(pak, 'assets.pak')), 'the pak must be written');
        assert.strictEqual((response!.payload as unknown as { pakFilePath: string }).pakFilePath, path.join(pak, 'assets.pak'));
        assert.ok(pushed.some((m) => m.type === 'resourcePakBuildProgress' && m.payload.state === 'completed'));
      });

      test('buildResourcePak answers with the path the tool\'s build returned', async () => {
        await post({
          command: 'addResource',
          requestId: 'add-first',
          data: { resourceName: 'tex', filePath: source('tex.png', 'texture') },
        });
        const elsewhere = path.join(scratch('output'), 'renamed.pak');
        sinon.stub(testTool().ResourcePak.prototype, 'build').returns(elsewhere);

        const response = await handleMessage({ command: 'buildResourcePak', requestId: 'build-elsewhere' });

        assert.strictEqual(response?.type, 'resourcePakBuilt');
        assert.notStrictEqual(elsewhere, path.join(pak, 'assets.pak'), 'the case needs a path other than <dir>/<name>.pak');
        assert.strictEqual(response.type === 'resourcePakBuilt' ? response.payload.pakFilePath : undefined, elsewhere);
      });
    });

    test('addResource and buildResourcePak with no pak project in the open folder give an error', async () => {
      const workspace = scratch('workspace');
      state.setWorkspaceFolders([workspace]);
      const file = path.join(scratch('sources'), 'a.txt');
      fs.writeFileSync(file, 'a');

      const added = await post({
        command: 'addResource',
        requestId: 'add-none',
        data: { resourceName: 'a', filePath: file },
      });
      const built = await post({ command: 'buildResourcePak', requestId: 'build-none' });

      for (const response of [added, built]) {
        assert.strictEqual(response?.type, 'error');
        assert.strictEqual(response!.payload.message, 'No resource pak project in the open folder.');
      }
      assert.deepStrictEqual(fs.readdirSync(workspace), []);
    });

    test('buildResourcePak with no open folder gives an error', async () => {
      const response = await post({ command: 'buildResourcePak', requestId: 'build-no-folder' });
      assert.strictEqual(response?.type, 'error');
      assert.strictEqual(response!.payload.message, 'No resource pak project in the open folder.');
    });
  });
});

// The cases below run against a scratch home directory, so the real
// configuration is not read or written. A signing status payload is read as
// { scopes: [{ scope, fingerprint?, ... }] }; an entry without a certificate
// has no fingerprint and carries the text "no certificate" in one of its fields.
suite('messageHandler scope validation and signing status', () => {
  useScratchState({ prefix: false });

  for (const name of ['', 'a b', 'a/b']) {
    test(`addScope with ${JSON.stringify(name)} responds with the validation reason and changes nothing`, async () => {
      writeScopes({ '@kept': 'Kept' });
      const configPath = new (testTool().Config)().configPath;
      const before = fs.readFileSync(configPath, 'utf8');
      const reason = testTool().validateScopeName(name.startsWith('@') ? name : `@${name}`);
      assert.ok(reason, 'the name is invalid');

      const response = await handleMessage({
        command: 'addScope',
        requestId: 'invalid-name',
        data: { scopeName: name, authorName: 'X', authorEmail: '', authorUrl: '' },
      });

      assert.ok(response, 'Should return a response');
      assert.strictEqual(response!.type, 'error');
      if (response!.type === 'error') {
        assert.ok(response!.payload.message.includes(reason!), `"${response!.payload.message}" should carry "${reason}"`);
      }
      assert.strictEqual(fs.readFileSync(configPath, 'utf8'), before);
    });
  }

  test('getSigningStatus with two scopes, one with a certificate, reports two entries', async () => {
    writeScopes({ '@with': 'With Cert', '@without': 'No Cert' });
    const fingerprint = await createCertFor('@with');

    const response = await handleMessage({ command: 'getSigningStatus', requestId: 'status' });

    assert.ok(response, 'Should return a response');
    assert.strictEqual(response!.type, 'signingStatus');
    const payload = response!.payload as unknown as { scopes: Array<Record<string, unknown>> };
    assert.ok(Array.isArray(payload.scopes));
    assert.strictEqual(payload.scopes.length, 2);
    const withCert = payload.scopes.find((e) => e.scope === '@with');
    const without = payload.scopes.find((e) => e.scope === '@without');
    assert.ok(withCert && without);
    assert.strictEqual(withCert!.fingerprint, fingerprint);
    assert.ok(!without!.fingerprint);
    assert.ok(Object.values(without!).includes('no certificate'));
  });

  test('getSigningStatus shows a certificate\'s subject through the tool\'s public formatSubject', async () => {
    writeScopes({ '@with': 'With Cert' });
    const config = new (testTool().Config)();
    config.config.scopes['@with'].author.email = 'with@example.com';
    config.saveConfig();
    await createCertFor('@with');
    await useToolApi(withoutInternalMembers(testTool()));

    const response = await handleMessage({ command: 'getSigningStatus', requestId: 'status' });

    assert.strictEqual(response?.type, 'signingStatus');
    const payload = response!.payload as unknown as { scopes: Array<Record<string, unknown>> };
    assert.deepStrictEqual(payload.scopes.map((entry) => [entry.scope, entry.subject]), [
      ['@with', 'CN=With Cert, EMAIL=with@example.com, O=@with'],
    ]);
  });
});

suite('messageHandler: whether the configuration is the default one', () => {
  const scratchState = useScratchState({ scopes: { [SCOPE]: 'Ada Lovelace' } });

  /** The configuration file under the scratch home, which the tool's own location would name. */
  function homeConfigFile(): string {
    return path.join(scratchState.home, 'the-seed', 'config.json');
  }

  /** The loaded tool, with the configuration location it reports and, optionally, its Config replaced. */
  function toolReporting(location: string, config?: ToolApi['Config']): ToolApi {
    return Object.assign({}, testTool(), { configFilePath: () => location }, config ? { Config: config } : {});
  }

  async function readyIsDefault(): Promise<boolean> {
    const response = await handleMessage({ command: 'ready' });
    assert.strictEqual(response?.type, 'configLoaded');
    return (response!.payload as { isDefault: boolean }).isDefault;
  }

  test('a file at the location the tool reports is not the default, with none under the home', async () => {
    const reported = path.join(scratchState.dir('reported'), 'config.json');
    fs.writeFileSync(reported, '{}\n');
    fs.rmSync(homeConfigFile());
    await useToolApi(toolReporting(reported));

    assert.strictEqual(await readyIsDefault(), false);
  });

  test('no file at the location the tool reports is the default, even with one under the home', async () => {
    assert.ok(fs.existsSync(homeConfigFile()), 'the scratch home has a configuration file');
    const reported = path.join(scratchState.dir('reported'), 'config.json');
    await useToolApi(toolReporting(reported));

    assert.strictEqual(await readyIsDefault(), true);
  });

  test('the location is looked at before Config is constructed, which creates the file there', async () => {
    const reported = path.join(scratchState.dir('reported'), 'config.json');
    const RealConfig = testTool().Config;
    class CreatingConfig extends RealConfig {
      constructor(configDir?: string) {
        super(configDir);
        fs.writeFileSync(reported, '{}\n');
      }
    }
    await useToolApi(toolReporting(reported, CreatingConfig));

    assert.strictEqual(await readyIsDefault(), true);
    assert.ok(fs.existsSync(reported), 'the Config constructor created the file');
  });
});
