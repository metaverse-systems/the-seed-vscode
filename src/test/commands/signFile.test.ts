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
