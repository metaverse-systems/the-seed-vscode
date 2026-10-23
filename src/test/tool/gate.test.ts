// Interface choices where the gate is not in place yet:
// - handleMessage is called the same way;
// - wrapCommand is called through a loose cast, so this file compiles before and after its
//   signature takes the service and the handler takes the tool;
// - a refusal by the tool is recognised by shape, so the error is built from the loaded tool's
//   own ProjectError class.
import * as assert from 'assert';
import * as fs from 'fs';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { wrapCommand } from '../../commands/wrapCommand';
import { handleMessage } from '../../panels/messageHandler';
import { describeError } from '../../utils/projectFolder';
import { activeToolService } from '../../tool/toolService';
import type { ToolApi } from '../../tool/toolApi';
import { useScratchState } from '../helpers/scratchState';
import { testTool } from '../helpers/tool';

type Handler = (outputChannel: vscode.OutputChannel, tool: ToolApi) => Promise<void>;
type Gated = (handler: Handler, outputChannel: vscode.OutputChannel, service: unknown) => () => Promise<void>;
type Message = Parameters<typeof handleMessage>[0];

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
        `The Seed: Using the-seed ${version} at ${location} (found through the "the-seed.toolPath" setting).`,
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
});
