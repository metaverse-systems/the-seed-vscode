// Interface choices where the contract leaves them open:
// - the command function is called directly with a stub output channel, with
//   vscode.window and vscode.commands stubbed; the validity input's
//   validateInput function is read from the options given to showInputBox;
// - accepted input is expected to return a falsy value (undefined or null),
//   rejected input the exact text "A whole number of days from 1 to 3650";
// - the certificate's validity is read back from the stored certificate.
// The suite runs in the extension host because it imports vscode.
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import Config from '@metaverse-systems/the-seed/Config';
import Signing from '@metaverse-systems/the-seed/Signing';
import { createSigningCert } from '../../commands/createSigningCert';
import { createCertFor, writeScopes } from '../helpers/scratchHome';
import { useScratchState } from '../helpers/scratchState';

const DAY_MS = 24 * 60 * 60 * 1000;

suite('createSigningCert command', () => {
  useScratchState({ prefix: false });
  const channel = { appendLine: (): void => undefined } as unknown as vscode.OutputChannel;

  setup(() => {
    sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    sinon.stub(vscode.window, 'showWarningMessage').resolves('Overwrite' as never);
  });

  test('creates the certificate for the picked scope with the entered validity', async () => {
    writeScopes({ '@a': 'A', '@b': 'B' });
    sinon.stub(vscode.window, 'showQuickPick').resolves('@b' as never);
    sinon.stub(vscode.window, 'showInputBox').resolves('30');

    await createSigningCert(channel);

    const signing = new Signing();
    assert.strictEqual(signing.hasCert('@a'), false);
    assert.strictEqual(signing.hasCert('@b'), true);
    const info = signing.getCertInfo('@b');
    assert.ok(info);
    const days = Math.round((info.notAfter.getTime() - info.notBefore.getTime()) / DAY_MS);
    assert.strictEqual(days, 30);
  });

  test('no top-level name is needed', async () => {
    writeScopes({ '@only': 'Only Author' });
    const config = new Config();
    assert.ok(!config.config.name, 'the scratch configuration has no name');
    const error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
    sinon.stub(vscode.window, 'showInputBox').resolves('365');

    await createSigningCert(channel);

    assert.ok(error.notCalled, 'no message about a missing name');
    assert.strictEqual(new Signing().hasCert('@only'), true);
  });

  test('overwriting an existing certificate asks first', async () => {
    writeScopes({ '@only': 'Only Author' });
    const before = await createCertFor('@only');
    sinon.stub(vscode.window, 'showInputBox').resolves('365');
    const warning = vscode.window.showWarningMessage as sinon.SinonStub;
    warning.resolves('Cancel');

    await createSigningCert(channel);

    assert.ok(warning.calledOnce);
    assert.strictEqual(new Signing().getCertInfo('@only')?.fingerprint, before);
  });

  test('scope without an author name: Edit Scope is offered and runs', async () => {
    writeScopes({ '@nameless': '' });
    const error = sinon.stub(vscode.window, 'showErrorMessage').resolves('Edit Scope' as never);
    sinon.stub(vscode.window, 'showInputBox').resolves('365');
    const exec = sinon.stub(vscode.commands, 'executeCommand').resolves(undefined);

    await createSigningCert(channel);

    assert.ok(error.calledOnce);
    assert.strictEqual(error.firstCall.args[0], 'Scope @nameless has no author name.');
    assert.strictEqual(error.firstCall.args[1], 'Edit Scope');
    assert.ok(exec.calledOnceWithExactly('the-seed.editScope'));
    assert.strictEqual(new Signing().hasCert('@nameless'), false);
  });

  test('the validity input rejects 0, abc and 3651 and accepts 365', async () => {
    writeScopes({ '@only': 'Only Author' });
    const input = sinon.stub(vscode.window, 'showInputBox').resolves(undefined);

    await createSigningCert(channel);

    assert.ok(input.calledOnce);
    const options = input.firstCall.args[0] as vscode.InputBoxOptions;
    const validate = options.validateInput;
    assert.strictEqual(typeof validate, 'function');
    const message = 'A whole number of days from 1 to 3650';
    for (const bad of ['0', 'abc', '3651']) {
      assert.strictEqual(validate!(bad), message, `"${bad}" should be rejected`);
    }
    assert.ok(!validate!('365'), '"365" should be accepted');
    assert.strictEqual(new Signing().hasCert('@only'), false, 'dismissing the input creates nothing');
  });
});
