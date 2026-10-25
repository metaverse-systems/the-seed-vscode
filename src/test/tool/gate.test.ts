// Interface choices where the gate is not in place yet:
// - handleMessage is called the same way;
// - wrapCommand is called through a loose cast, so this file compiles before and after its
//   signature takes the service and the handler takes the tool;
// - a refusal by the tool is recognised by shape, so the error is built from the loaded tool's
//   own ProjectError class.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { wrapCommand } from '../../commands/wrapCommand';
import { handleMessage } from '../../panels/messageHandler';
import { describeError } from '../../utils/projectFolder';
import { getOperationLock } from '../../operationLock';
import { activeToolService, createVscodeNotifier, ToolService } from '../../tool/toolService';
import { loadInstallation } from '../../tool/loadTool';
import type { ToolApi } from '../../tool/toolApi';
import { useScratchState } from '../helpers/scratchState';
import { copyTestTool, makeStubTool, stubLoadError } from '../helpers/stubTool';
import { testTool, withToolSetting } from '../helpers/tool';
import { readTree } from '../helpers/workspaceStub';

type Handler = (outputChannel: vscode.OutputChannel, tool: ToolApi) => Promise<void>;
type Gated = (handler: Handler, outputChannel: vscode.OutputChannel, service: unknown) => () => Promise<void>;
type Message = Parameters<typeof handleMessage>[0];

type PanelCommand = Message['command'] | 'getToolStatus' | 'checkTool' | 'openToolSetting';
type Kind = 'operation' | 'toolFree' | 'special';

interface Loose {
  type: string;
  requestId?: string;
  payload: { message?: string; code?: string; state?: string; usable?: boolean };
}

const manifest = require(path.resolve(__dirname, '..', '..', '..', 'package.json')) as {
  contributes: { commands: Array<{ command: string }> };
};
const GATED_COMMANDS: string[] = manifest.contributes.commands
  .map((entry) => entry.command)
  .filter((command) => command !== 'the-seed.checkTool');

const SCOPE_FORM = { scopeName: '@gate', authorName: 'Gate', authorEmail: '', authorUrl: '' };
const TEMPLATE_FORM = { templateType: 'component', scopeName: '@gate', templateName: 'gate' };

/** Every panel message, how the gate treats it and a sample of it; the compiler keeps this complete. */
const PANEL_MESSAGES: Record<PanelCommand, { kind: Kind; message: object }> = {
  ready: { kind: 'special', message: { command: 'ready' } },
  getConfig: { kind: 'operation', message: { command: 'getConfig', requestId: 'r' } },
  savePrefix: { kind: 'operation', message: { command: 'savePrefix', requestId: 'r', data: { prefix: '/nowhere' } } },
  addScope: { kind: 'operation', message: { command: 'addScope', requestId: 'r', data: SCOPE_FORM } },
  confirmOverwriteScope: { kind: 'operation', message: { command: 'confirmOverwriteScope', requestId: 'r', data: SCOPE_FORM } },
  editScope: { kind: 'operation', message: { command: 'editScope', requestId: 'r', data: SCOPE_FORM } },
  deleteScope: { kind: 'operation', message: { command: 'deleteScope', requestId: 'r', data: { scopeName: '@gate' } } },
  createTemplate: { kind: 'operation', message: { command: 'createTemplate', requestId: 'r', data: TEMPLATE_FORM } },
  startBuild: { kind: 'operation', message: { command: 'startBuild', requestId: 'r', data: { target: 'native' } } },
  cancelBuild: { kind: 'toolFree', message: { command: 'cancelBuild', requestId: 'r' } },
  getBuildStatus: { kind: 'toolFree', message: { command: 'getBuildStatus', requestId: 'r' } },
  startRecursiveBuild: { kind: 'operation', message: { command: 'startRecursiveBuild', requestId: 'r', data: { target: 'native' } } },
  cancelRecursiveBuild: { kind: 'toolFree', message: { command: 'cancelRecursiveBuild', requestId: 'r' } },
  getResourcePakStatus: { kind: 'toolFree', message: { command: 'getResourcePakStatus', requestId: 'r' } },
  createResourcePak: { kind: 'operation', message: { command: 'createResourcePak', requestId: 'r', data: { scopeName: '@gate', pakName: 'gate' } } },
  chooseResourcePak: { kind: 'operation', message: { command: 'chooseResourcePak', requestId: 'r' } },
  browseResourceFile: { kind: 'toolFree', message: { command: 'browseResourceFile', requestId: 'r' } },
  addResource: { kind: 'operation', message: { command: 'addResource', requestId: 'r', data: { resourceName: 'gate', filePath: '/nowhere/file.png' } } },
  buildResourcePak: { kind: 'operation', message: { command: 'buildResourcePak', requestId: 'r' } },
  checkDependencies: { kind: 'operation', message: { command: 'checkDependencies', requestId: 'r', data: { target: 'native' } } },
  installDependencies: { kind: 'operation', message: { command: 'installDependencies', requestId: 'r', data: { target: 'native' } } },
  cancelInstallDependencies: { kind: 'toolFree', message: { command: 'cancelInstallDependencies', requestId: 'r' } },
  getDependencyStatus: { kind: 'toolFree', message: { command: 'getDependencyStatus', requestId: 'r' } },
  startPackage: { kind: 'operation', message: { command: 'startPackage', requestId: 'r' } },
  getPackageStatus: { kind: 'toolFree', message: { command: 'getPackageStatus', requestId: 'r' } },
  generateInstaller: { kind: 'operation', message: { command: 'generateInstaller', requestId: 'r' } },
  createSigningCert: { kind: 'operation', message: { command: 'createSigningCert', requestId: 'r' } },
  importSigningCert: { kind: 'operation', message: { command: 'importSigningCert', requestId: 'r' } },
  signingCertInfo: { kind: 'operation', message: { command: 'signingCertInfo', requestId: 'r' } },
  exportSigningCert: { kind: 'operation', message: { command: 'exportSigningCert', requestId: 'r' } },
  getSigningStatus: { kind: 'operation', message: { command: 'getSigningStatus', requestId: 'r' } },
  getToolStatus: { kind: 'toolFree', message: { command: 'getToolStatus', requestId: 'r' } },
  checkTool: { kind: 'toolFree', message: { command: 'checkTool', requestId: 'r' } },
  openToolSetting: { kind: 'toolFree', message: { command: 'openToolSetting' } },
};

const gated = wrapCommand as unknown as Gated;

/** handleMessage with the service as its third argument, whether or not the signature has it yet. */
function handleWith(message: object, service: unknown): ReturnType<typeof handleMessage> {
  const call = handleMessage as unknown as (message: Message, push: undefined, service: unknown) => ReturnType<typeof handleMessage>;
  return call(message as Message, undefined, service);
}

interface FakeChannel {
  channel: vscode.OutputChannel;
  lines: string[];
}

function fakeChannel(): FakeChannel {
  const lines: string[] = [];
  const channel = {
    appendLine: (line: string) => {
      lines.push(line);
    },
    show: () => undefined,
  } as unknown as vscode.OutputChannel;
  return { channel, lines };
}

suite('tool gate', () => {
  useScratchState();

  suite('wrapCommand', () => {
    test('passes the tool of the service to the handler', async () => {
      const received: ToolApi[] = [];
      const { channel } = fakeChannel();
      let seenChannel: vscode.OutputChannel | undefined;

      await gated(async (oc, tool) => {
        seenChannel = oc;
        received.push(tool);
      }, channel, activeToolService())();

      assert.strictEqual(received.length, 1, 'the handler runs once');
      assert.strictEqual(received[0], testTool(), 'the handler receives the tool the service loaded');
      assert.strictEqual(seenChannel, channel, 'the handler receives the output channel');
    });

    test('reports an error thrown by the handler to the channel and the user', async () => {
      const { channel, lines } = fakeChannel();
      const showError = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);

      await gated(async () => {
        throw new Error('something broke');
      }, channel, activeToolService())();

      assert.ok(
        lines.some((line) => /^\[\d{4}-\d\d-\d\dT[\d:.]+Z\] ERROR: something broke$/.test(line)),
        `the channel has the error line: ${JSON.stringify(lines)}`,
      );
      assert.ok(showError.calledOnce, 'one error message is shown');
      assert.strictEqual(showError.firstCall.args[0], 'The Seed: something broke');
    });

    test('shows the hint of a tool refusal with the message', async () => {
      const { channel } = fakeChannel();
      const showError = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      const ProjectError = testTool().ProjectError;

      await gated(async () => {
        throw new ProjectError('unknown-scope', 'The scope is not known.', 'Add it first.');
      }, channel, activeToolService())();

      assert.ok(showError.calledOnce, 'one error message is shown');
      assert.strictEqual(showError.firstCall.args[0], 'The Seed: The scope is not known. Add it first.');
    });
  });

  suite('describeError', () => {
    test('recognises a refusal of the loaded tool by its shape', () => {
      const ProjectError = testTool().ProjectError;
      const error = new ProjectError('target-exists', 'It exists.', 'Choose another name.');
      assert.strictEqual(describeError(error), 'It exists. Choose another name.');
    });

    test('recognises a refusal that is not an instance of the loaded class', () => {
      const lookalike = Object.assign(new Error('Not a pak project.'), { name: 'ProjectError', hint: 'Open a pak project.' });
      assert.strictEqual(describeError(lookalike), 'Not a pak project. Open a pak project.');
    });

    test('gives only the message when a refusal has no hint', () => {
      const ProjectError = testTool().ProjectError;
      assert.strictEqual(describeError(new ProjectError('write-failed', 'Could not write.')), 'Could not write.');
    });

    test('gives only the message for an error that is not a refusal', () => {
      assert.strictEqual(describeError(new Error('plain')), 'plain');
      const named = Object.assign(new Error('named'), { name: 'ProjectError' });
      assert.strictEqual(describeError(named), 'named', 'a name without a string hint is not a refusal');
      const hinted = Object.assign(new Error('hinted'), { hint: 'x' });
      assert.strictEqual(describeError(hinted), 'hinted', 'a hint without the name is not a refusal');
    });

    test('describes a value that is not an error', () => {
      assert.strictEqual(describeError('text'), 'text');
    });
  });

  suite('the-seed.checkTool', () => {
    test('shows the installation in use and how it was found', async () => {
      const showInfo = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
      const showWarning = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);
      const showError = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      const service = activeToolService();
      const location = fs.realpathSync(process.env.THE_SEED_TEST_TOOL as string);
      const version = service.status.installation?.version;
      assert.ok(version, 'the test tool has a version');

      await vscode.commands.executeCommand('the-seed.checkTool');

      assert.ok(showInfo.calledOnce, 'one information message is shown');
      assert.ok(!showWarning.called && !showError.called, 'no warning or error is shown');
      assert.strictEqual(
        showInfo.firstCall.args[0],
        `The Seed: Using the-seed ${version} at ${location} (found through the "the-seed.toolPath" setting). The native component is built.`,
      );
      assert.strictEqual(service.status.state, 'usable');
    });
  });

  suite('handleMessage', () => {
    test('answers getConfig from the tool of the service', async () => {
      const response = await handleWith({ command: 'getConfig', requestId: 'gate-config' }, activeToolService());
      assert.ok(response, 'a response is returned');
      assert.strictEqual(response.type, 'configLoaded');
      if (response.type === 'configLoaded') {
        assert.strictEqual(response.requestId, 'gate-config');
      }
    });
  });

  suite('with a tool that cannot be used', function () {
    this.timeout(120000);
    const state = useScratchState({ workspaceFolders: 1 });

    function snapshot(): Map<string, unknown>[] {
      return [state.home, state.prefix as string, ...state.workspaceFolders].map((root) => readTree(root));
    }

    function stubMessages(): { error: sinon.SinonStub; warning: sinon.SinonStub; info: sinon.SinonStub } {
      return {
        error: sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined),
        warning: sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined),
        info: sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined),
      };
    }

    test('every command is refused with the status message and changes nothing', async () => {
      const shown = stubMessages();
      const empty = state.dir('no-tool');
      await withToolSetting(empty, async () => {
        const service = activeToolService();
        assert.strictEqual(service.status.state, 'notTheTool');
        const message = `The Seed: ${service.status.message}`;
        assert.ok(shown.warning.callCount <= 1, 'the change of state is announced at most once');
        shown.warning.resetHistory();
        const before = snapshot();
        const registered = await vscode.commands.getCommands(true);

        for (const command of GATED_COMMANDS) {
          shown.error.resetHistory();
          await vscode.commands.executeCommand(command);
          assert.strictEqual(shown.error.callCount, 1, `${command} shows one error`);
          assert.strictEqual(shown.error.firstCall.args[0], message, command);
          assert.deepStrictEqual(shown.error.firstCall.args.slice(1), ['Open Setting', 'Check Again'], command);
          assert.strictEqual(getOperationLock().active, false, `${command} left the operation lock held`);
        }

        assert.strictEqual(shown.warning.callCount, 0, 'no warning accompanies a refusal');
        assert.strictEqual(shown.info.callCount, 0, 'no other message is shown');
        for (const command of manifest.contributes.commands.map((entry) => entry.command)) {
          assert.ok(registered.includes(command), `${command} is still registered`);
        }
        assert.deepStrictEqual(snapshot(), before, 'nothing was written');
      });
    });

    test('the notice for a state is shown once however many commands are refused', async () => {
      const shown = stubMessages();
      await withToolSetting(state.dir('once'), async () => {
        for (const command of GATED_COMMANDS.slice(0, 4)) {
          await vscode.commands.executeCommand(command);
        }
      });
      assert.strictEqual(shown.warning.callCount, 1, 'one notice for the state');
      assert.strictEqual(shown.error.callCount, 4, 'one refusal per command');
    });

    test('a refused command writes the channel line and calls no handler', async () => {
      const shown = stubMessages();
      await withToolSetting(state.dir('channel'), async () => {
        const { channel, lines } = fakeChannel();
        let called = false;
        await gated(async () => {
          called = true;
        }, channel, activeToolService())();
        assert.strictEqual(called, false);
        assert.strictEqual(lines.length, 1);
        assert.ok(
          lines[0].endsWith(`ERROR: ${activeToolService().status.message}`) && /^\[\d{4}-\d\d-\d\dT[\d:.]+Z\] /.test(lines[0]),
          lines[0],
        );
        assert.strictEqual(shown.error.callCount, 1);
      });
    });

    test('the-seed.checkTool shows the warning again for a state already shown', async () => {
      const shown = stubMessages();
      await withToolSetting(state.dir('again'), async () => {
        shown.warning.resetHistory();
        await vscode.commands.executeCommand('the-seed.checkTool');
        assert.strictEqual(shown.warning.callCount, 1);
        assert.strictEqual(shown.warning.firstCall.args[0], `The Seed: ${activeToolService().status.message}`);
        assert.strictEqual(shown.info.callCount, 0);
      });
    });

    suite('panel messages', () => {
      test('every message is an operation, tool-free or special, and operations are refused', async () => {
        stubMessages();
        sinon.stub(vscode.window, 'showOpenDialog').resolves(undefined);
        sinon.stub(vscode.commands, 'executeCommand').resolves(undefined);
        await withToolSetting(state.dir('panel'), async () => {
          const service = activeToolService();
          const before = snapshot();
          for (const [command, entry] of Object.entries(PANEL_MESSAGES)) {
            const response = (await handleWith(entry.message, service)) as unknown as Loose | null;
            if (entry.kind === 'operation') {
              assert.ok(response, `${command} gets a response`);
              assert.strictEqual(response.type, 'error', command);
              assert.strictEqual(response.payload.code, 'toolUnavailable', command);
              assert.strictEqual(response.payload.message, service.status.message, command);
              assert.strictEqual(response.requestId, 'r', command);
            } else if (response) {
              assert.ok(response.payload?.code !== 'toolUnavailable', `${command} is not refused`);
            }
            assert.strictEqual(getOperationLock().active, false, `${command} left the operation lock held`);
          }
          assert.deepStrictEqual(snapshot(), before, 'nothing was written');
        });
      });

      test('ready returns toolStatus, pushes it and returns no configLoaded', async () => {
        stubMessages();
        await withToolSetting(state.dir('ready'), async () => {
          const pushed: Loose[] = [];
          const call = handleMessage as unknown as (m: Message, push: (m: Loose) => void, s: unknown) => Promise<Loose | null>;
          const response = await call({ command: 'ready' } as Message, (m) => pushed.push(m), activeToolService());
          assert.ok(response);
          assert.strictEqual(response.type, 'toolStatus');
          assert.strictEqual(response.payload.usable, false);
          assert.strictEqual(response.payload.state, 'notTheTool');
          assert.deepStrictEqual(pushed.map((m) => m.type), ['toolStatus']);
        });
      });

      test('ready with a usable tool still returns configLoaded and also pushes toolStatus', async () => {
        const pushed: Loose[] = [];
        const call = handleMessage as unknown as (m: Message, push: (m: Loose) => void, s: unknown) => Promise<Loose | null>;
        const response = await call({ command: 'ready' } as Message, (m) => pushed.push(m), activeToolService());
        assert.ok(response);
        assert.strictEqual(response.type, 'configLoaded');
        assert.deepStrictEqual(pushed.map((m) => m.type), ['toolStatus']);
        assert.strictEqual(pushed[0].payload.usable, true);
      });

      test('checkTool checks again and returns toolStatus', async () => {
        const shown = stubMessages();
        await withToolSetting(state.dir('check-tool'), async () => {
          const response = (await handleWith({ command: 'checkTool', requestId: 'c' }, activeToolService())) as unknown as Loose | null;
          assert.ok(response);
          assert.strictEqual(response.type, 'toolStatus');
          assert.strictEqual(response.requestId, 'c');
          assert.strictEqual(response.payload.state, 'notTheTool');
        });
        assert.ok(shown.warning.called, 'the check the user asked for shows the notice');
      });

      test('getToolStatus returns the current status', async () => {
        const response = (await handleWith({ command: 'getToolStatus', requestId: 'g' }, activeToolService())) as unknown as Loose | null;
        assert.ok(response);
        assert.strictEqual(response.type, 'toolStatus');
        assert.strictEqual(response.requestId, 'g');
        assert.strictEqual(response.payload.usable, true);
      });

      test('openToolSetting opens the setting and returns nothing', async () => {
        const execute = sinon.stub(vscode.commands, 'executeCommand').resolves(undefined);
        const response = await handleWith({ command: 'openToolSetting' }, activeToolService());
        assert.strictEqual(response, null);
        assert.ok(execute.calledWith('workbench.action.openSettings', 'the-seed.toolPath'));
      });
    });

    suite('each unusable state', () => {
      async function expectRefused(): Promise<void> {
        const service = activeToolService();
        const { channel, lines } = fakeChannel();
        let called = false;
        await gated(async () => {
          called = true;
        }, channel, service)();
        assert.strictEqual(called, false, 'the handler is never called');
        assert.ok(lines[0].includes(service.status.message), lines[0]);
        const response = (await handleWith({ command: 'getConfig', requestId: 'x' }, service)) as unknown as Loose | null;
        assert.ok(response);
        assert.strictEqual(response.type, 'error');
        assert.strictEqual(response.payload.code, 'toolUnavailable');
        assert.strictEqual(response.payload.message, service.status.message);
        assert.strictEqual(getOperationLock().active, false);
      }

      function includesAll(text: string, parts: string[]): void {
        for (const part of parts) {
          assert.ok(text.includes(part), `"${part}" is not in: ${text}`);
        }
      }

      test('tooOld', async () => {
        const shown = stubMessages();
        const stub = makeStubTool(state.dir('old'), { version: '1.2.1' });
        await withToolSetting(stub, async () => {
          assert.strictEqual(activeToolService().status.state, 'tooOld');
          await expectRefused();
          includesAll(activeToolService().status.message, ['1.2.1', '2.1.0 or a later 2.x', 'npm install -g']);
        });
        assert.strictEqual(shown.error.callCount, 1);
      });

      test('tooNew', async () => {
        const shown = stubMessages();
        const stub = makeStubTool(state.dir('new'), { version: '3.0.0' });
        await withToolSetting(stub, async () => {
          assert.strictEqual(activeToolService().status.state, 'tooNew');
          await expectRefused();
          includesAll(activeToolService().status.message, ['3.0.0', '2.x', 'npm install -g']);
        });
        assert.strictEqual(shown.error.callCount, 1);
      });

      test('notLoadable', async () => {
        const shown = stubMessages();
        const stub = makeStubTool(state.dir('broken'), { version: '2.1.0', throwOnLoad: 'Config' });
        await withToolSetting(stub, async () => {
          assert.strictEqual(activeToolService().status.state, 'notLoadable');
          await expectRefused();
          const message = activeToolService().status.message;
          includesAll(message, [stubLoadError('Config'), 'npm install -g']);
          assert.ok(!message.includes('second line of the error'), 'only the first line of the error');
        });
        assert.strictEqual(shown.error.callCount, 1);
      });

      test('notFound', async () => {
        const shown = stubMessages();
        const service: ToolService = new ToolService({
          lookup: {
            platform: process.platform,
            env: { PATH: '' },
            homedir: state.dir('empty-home'),
            runNpmRoot: async () => undefined,
            defaultRoots: [],
          },
          readSetting: () => undefined,
          load: loadInstallation,
          notifier: createVscodeNotifier(() => service.check('checkAgain')),
        });
        try {
          await service.check('activate');
          assert.strictEqual(service.status.state, 'notFound');
          const { channel, lines } = fakeChannel();
          let called = false;
          await gated(async () => {
            called = true;
          }, channel, service)();
          assert.strictEqual(called, false);
          assert.ok(lines[0].includes(service.status.message));
          includesAll(service.status.message, ['not found', '2.1.0 or a later 2.x', 'npm install -g', 'the-seed.toolPath']);
          const response = (await handleWith({ command: 'getConfig', requestId: 'n' }, service)) as unknown as Loose | null;
          assert.ok(response);
          assert.strictEqual(response.payload.code, 'toolUnavailable');
          assert.strictEqual(response.payload.message, service.status.message);
          assert.strictEqual(shown.error.callCount, 1);
        } finally {
          service.dispose();
        }
      });
    });

    suite('recovery and change in place', () => {
      test('installing the tool at the set path is noticed by the next command without a restart', async () => {
        const shown = stubMessages();
        const where = state.dir('late');
        await withToolSetting(where, async () => {
          await vscode.commands.executeCommand('the-seed.showConfig');
          assert.strictEqual(shown.error.callCount, 1, 'refused while the tool is missing');
          shown.error.resetHistory();

          copyTestTool(where, { native: true });
          await vscode.commands.executeCommand('the-seed.showConfig');

          assert.strictEqual(shown.error.callCount, 0, 'not refused once the tool is there');
          assert.strictEqual(activeToolService().status.state, 'usable');
          assert.strictEqual(activeToolService().status.installation?.packageDir, fs.realpathSync(where));
        });
      });

      test('a change of the loaded installation asks for a reload', async () => {
        const shown = stubMessages();
        const stub = makeStubTool(state.dir('changing'), { version: '2.7.0' });
        await withToolSetting(stub, async () => {
          assert.strictEqual(activeToolService().status.state, 'usable');
          const manifestFile = path.join(stub, 'package.json');
          const changed = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as { version: string };
          changed.version = '2.8.0';
          fs.writeFileSync(manifestFile, JSON.stringify(changed));

          const { channel } = fakeChannel();
          let called = false;
          await gated(async () => {
            called = true;
          }, channel, activeToolService())();

          assert.strictEqual(called, false);
          assert.strictEqual(activeToolService().status.state, 'reloadRequired');
          assert.strictEqual(shown.error.callCount, 1);
          assert.ok(String(shown.error.firstCall.args[0]).includes('Reload the window'));
          assert.ok(shown.error.firstCall.args.includes('Reload Window'));
          assert.ok(String(shown.error.firstCall.args[0]).includes('2.7.0') && String(shown.error.firstCall.args[0]).includes('2.8.0'));
        });
      });
    });
  });
});
