// Interface choices where the contract leaves them open:
// - the module under test is loaded with require() inside each case, so this
//   file compiles before the module exists and the cases fail at run time;
// - the "Add Scope" command is observed through a stub of
//   vscode.commands.executeCommand, which resolves undefined.
// The suite runs in the extension host because it imports vscode.
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import Signing from '@metaverse-systems/the-seed/Signing';
import { writeScopes } from '../helpers/scratchHome';
import { useScratchState } from '../helpers/scratchState';

type ChooseScope = (signing: Signing, purpose: string) => Promise<string | undefined>;

function loadChooseScope(): ChooseScope {
  const mod = require('../../signing/chooseScope') as { chooseScope: ChooseScope };
  return mod.chooseScope;
}

suite('chooseScope', () => {
  useScratchState({ prefix: false });

  test('no scopes: offers Add Scope, runs it on choosing, returns undefined', async () => {
    writeScopes({});
    const error = sinon.stub(vscode.window, 'showErrorMessage').resolves('Add Scope' as never);
    const pick = sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);
    const exec = sinon.stub(vscode.commands, 'executeCommand').resolves(undefined);

    const result = await loadChooseScope()(new Signing(), 'sign files');

    assert.strictEqual(result, undefined);
    assert.ok(error.calledOnce);
    assert.strictEqual(error.firstCall.args[0], 'No scopes are configured. Add one to sign files.');
    assert.strictEqual(error.firstCall.args[1], 'Add Scope');
    assert.ok(exec.calledOnceWithExactly('the-seed.addScope'));
    assert.ok(pick.notCalled);
  });

  test('no scopes: dismissing the message runs nothing', async () => {
    writeScopes({});
    sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
    const exec = sinon.stub(vscode.commands, 'executeCommand').resolves(undefined);

    const result = await loadChooseScope()(new Signing(), 'sign files');

    assert.strictEqual(result, undefined);
    assert.ok(exec.notCalled);
  });

  test('one scope: returned without a prompt', async () => {
    writeScopes({ '@only': 'Only Author' });
    const pick = sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);
    const error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);

    const result = await loadChooseScope()(new Signing(), 'sign files');

    assert.strictEqual(result, '@only');
    assert.ok(pick.notCalled);
    assert.ok(error.notCalled);
  });

  test('several scopes: quick pick with the placeholder, chosen scope returned', async () => {
    writeScopes({ '@a': 'A', '@b': 'B' });
    const pick = sinon.stub(vscode.window, 'showQuickPick').resolves('@b' as never);

    const result = await loadChooseScope()(new Signing(), 'sign files');

    assert.strictEqual(result, '@b');
    assert.ok(pick.calledOnce);
    const items = (await Promise.resolve(pick.firstCall.args[0])) as unknown as readonly string[];
    assert.deepStrictEqual([...items].sort(), ['@a', '@b']);
    const options = pick.firstCall.args[1] as vscode.QuickPickOptions;
    assert.strictEqual(options.placeHolder, 'Which scope should be used to sign files?');
  });

  test('several scopes: dismissing the pick returns undefined', async () => {
    writeScopes({ '@a': 'A', '@b': 'B' });
    sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);
    const exec = sinon.stub(vscode.commands, 'executeCommand').resolves(undefined);

    const result = await loadChooseScope()(new Signing(), 'sign files');

    assert.strictEqual(result, undefined);
    assert.ok(exec.notCalled);
  });
});
