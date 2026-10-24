// Interface choices where the contract leaves them open:
// - the command function is called directly with a stub output channel and a
//   file uri, with vscode.window and vscode.commands stubbed;
// - the home directory is a scratch directory holding the configuration and
//   the certificates; the program is a copy of the tool's tiny.exe fixture;
// - which scope signed is read from the options passed to Signing.signFile,
//   observed with a spy that calls through, and the file's bytes show whether
//   anything was written.
// The suite runs in the extension host because it imports vscode.
import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { signFile } from '../../commands/signFile';
import { createCertFor, fixturePath, writeScopes } from '../helpers/scratchHome';
import { useScratchState } from '../helpers/scratchState';
import { requires } from '../harness/platform';
import { testTool } from '../helpers/tool';
import type { ToolApi } from '../../tool/toolApi';

function digest(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

suite('signFile command', () => {
  requires('native-component');
  const state = useScratchState({ prefix: false });
  let program: string;
  let original: string;
  const channel = { appendLine: (): void => undefined } as unknown as vscode.OutputChannel;

  setup(() => {
    program = path.join(state.home, 'tiny.exe');
    fs.copyFileSync(fixturePath('tiny.exe'), program);
    original = digest(program);
    sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);
  });

  test('one scope with a certificate: signed with that scope', async () => {
    writeScopes({ '@only': 'Only Author' });
    await createCertFor('@only');
    const pick = sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);
    const spy = sinon.spy(testTool().Signing.prototype, 'signFile');

    await signFile(channel, testTool(), vscode.Uri.file(program));

    assert.ok(pick.notCalled);
    assert.ok(spy.calledOnce);
    assert.strictEqual(spy.firstCall.args[1]?.scope, '@only');
    assert.notStrictEqual(digest(program), original, 'the program should carry a signature');
  });

  test('two scopes: the picked scope is used', async () => {
    writeScopes({ '@a': 'A', '@b': 'B' });
    await createCertFor('@a');
    await createCertFor('@b');
    const pick = sinon.stub(vscode.window, 'showQuickPick').resolves('@b' as never);
    const spy = sinon.spy(testTool().Signing.prototype, 'signFile');

    await signFile(channel, testTool(), vscode.Uri.file(program));

    assert.ok(pick.calledOnce);
    assert.ok(spy.calledOnce);
    assert.strictEqual(spy.firstCall.args[1]?.scope, '@b');
  });

  test('dismissed pick: nothing is written', async () => {
    writeScopes({ '@a': 'A', '@b': 'B' });
    await createCertFor('@a');
    await createCertFor('@b');
    sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);
    const spy = sinon.spy(testTool().Signing.prototype, 'signFile');

    await signFile(channel, testTool(), vscode.Uri.file(program));

    assert.ok(spy.notCalled);
    assert.strictEqual(digest(program), original);
  });

  test('no certificate for the chosen scope: Create Certificate is offered and runs', async () => {
    writeScopes({ '@a': 'A', '@b': 'B' });
    await createCertFor('@a');
    sinon.stub(vscode.window, 'showQuickPick').resolves('@b' as never);
    const error = sinon.stub(vscode.window, 'showErrorMessage').resolves('Create Certificate' as never);
    const exec = sinon.stub(vscode.commands, 'executeCommand').resolves(undefined);
    const spy = sinon.spy(testTool().Signing.prototype, 'signFile');

    await signFile(channel, testTool(), vscode.Uri.file(program));

    assert.ok(error.calledOnce);
    assert.strictEqual(error.firstCall.args[0], 'No signing certificate for scope @b.');
    assert.strictEqual(error.firstCall.args[1], 'Create Certificate');
    assert.ok(exec.calledOnceWithExactly('the-seed.createSigningCert'));
    assert.ok(spy.notCalled);
    assert.strictEqual(digest(program), original);
  });
});

// The file and signature names in the notifications, for a target the tool
// reports with backslashes. The tool's Signing is replaced by a stand-in, so
// nothing is signed and the native component is not needed.
suite('signFile command names files with either separator', () => {
  useScratchState({ prefix: false });
  const channel = { appendLine: (): void => undefined } as unknown as vscode.OutputChannel;
  const TARGET = 'C:\\work\\app.exe';
  let info: sinon.SinonStub;

  setup(() => {
    writeScopes({ '@only': 'Only Author' });
    info = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);
    sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
    const editor = { document: { uri: { fsPath: TARGET } } } as unknown as vscode.TextEditor;
    sinon.stub(vscode.window, 'activeTextEditor').get(() => editor);
  });

  /** The loaded tool with a Signing whose signFile answers `result` for any file. */
  function toolSigning(result: { signatureType: 'embedded' | 'detached'; signaturePath: string | null }): ToolApi {
    class StandInSigning {
      async isBinaryFile(): Promise<boolean> {
        return true;
      }
      hasCert(): boolean {
        return true;
      }
      async signFile(filePath: string): Promise<unknown> {
        return { filePath, fingerprint: 'AA:BB', warnings: [], ...result };
      }
    }
    return { ...testTool(), Signing: StandInSigning as unknown as ToolApi['Signing'] };
  }

  function messages(): string[] {
    return info.getCalls().map((call) => String(call.args[0]));
  }

  test('a detached signature at a backslash path is named app.exe.sig', async () => {
    await signFile(channel, toolSigning({ signatureType: 'detached', signaturePath: 'C:\\work\\app.exe.sig' }));

    assert.deepStrictEqual(messages(), ['Detached signature saved to app.exe.sig']);
  });

  test('an embedded signature in a backslash path is named app.exe', async () => {
    await signFile(channel, toolSigning({ signatureType: 'embedded', signaturePath: null }));

    assert.deepStrictEqual(messages(), ['Embedded signature applied to app.exe']);
  });
});
