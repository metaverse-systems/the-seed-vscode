import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { activeViewProvider } from '../../panels/TheSeedViewProvider';
import { fakeView } from '../helpers/fakeView';
import type { FakeView, Posted } from '../helpers/fakeView';
import { writeScopes } from '../helpers/scratchHome';
import { useScratchState } from '../helpers/scratchState';

suite('Configuration changes reach an open sidebar', () => {
  useScratchState();

  teardown(() => {
    sinon.restore();
  });

  function openSidebar(): FakeView {
    const provider = activeViewProvider();
    assert.ok(provider, "the extension's view provider exists");
    return fakeView(provider);
  }

  function configMessages(fake: FakeView): Posted[] {
    return fake.posted.filter((message) => message.type === 'configLoaded');
  }

  function stubNotices(): void {
    sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);
  }

  function scopesOf(message: Posted): string[] {
    return (message.payload?.scopes as { name: string }[]).map((scope) => scope.name);
  }

  test('Configure Project posts the new prefix', async () => {
    stubNotices();
    sinon.stub(vscode.window, 'showInputBox').resolves('/test/new-prefix');
    const fake = openSidebar();

    await vscode.commands.executeCommand('the-seed.configureProject');

    const messages = configMessages(fake);
    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].payload?.prefix, '/test/new-prefix');
  });

  test('Configure Project posts nothing when cancelled', async () => {
    stubNotices();
    sinon.stub(vscode.window, 'showInputBox').resolves(undefined);
    const fake = openSidebar();

    await vscode.commands.executeCommand('the-seed.configureProject');

    assert.strictEqual(configMessages(fake).length, 0);
  });

  test('Add Scope posts the configuration with the new scope', async () => {
    stubNotices();
    const input = sinon.stub(vscode.window, 'showInputBox');
    input.onCall(0).resolves('fresh');
    input.onCall(1).resolves('Fresh Author');
    input.onCall(2).resolves('fresh@example.com');
    input.onCall(3).resolves('https://example.com');
    const fake = openSidebar();

    await vscode.commands.executeCommand('the-seed.addScope');

    const messages = configMessages(fake);
    assert.strictEqual(messages.length, 1);
    assert.deepStrictEqual(scopesOf(messages[0]), ['@fresh']);
  });

  test('Add Scope posts nothing when cancelled', async () => {
    stubNotices();
    sinon.stub(vscode.window, 'showInputBox').resolves(undefined);
    const fake = openSidebar();

    await vscode.commands.executeCommand('the-seed.addScope');

    assert.strictEqual(configMessages(fake).length, 0);
  });

  test('Edit Scope posts the configuration with the edited author', async () => {
    writeScopes({ '@edit-me': 'Old Author' });
    stubNotices();
    sinon.stub(vscode.window, 'showQuickPick').resolves('@edit-me' as unknown as vscode.QuickPickItem);
    sinon.stub(vscode.window, 'showInputBox').callsFake(async (options) => (options?.prompt?.toLowerCase().includes('name') ? 'New Author' : 'x@example.com'));
    const fake = openSidebar();

    await vscode.commands.executeCommand('the-seed.editScope');

    const messages = configMessages(fake);
    assert.strictEqual(messages.length, 1);
    assert.deepStrictEqual(scopesOf(messages[0]), ['@edit-me']);
    assert.ok(JSON.stringify(messages[0].payload).includes('New Author'), 'the edited author is in the message');
  });

  test('Edit Scope posts nothing when cancelled', async () => {
    writeScopes({ '@edit-me': 'Old Author' });
    stubNotices();
    sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);
    const fake = openSidebar();

    await vscode.commands.executeCommand('the-seed.editScope');

    assert.strictEqual(configMessages(fake).length, 0);
  });

  test('Delete Scope posts the configuration without the deleted scope', async () => {
    writeScopes({ '@keep': 'Keeper', '@drop': 'Dropper' });
    sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    sinon.stub(vscode.window, 'showQuickPick').resolves('@drop' as unknown as vscode.QuickPickItem);
    sinon.stub(vscode.window, 'showWarningMessage').callsFake(async (_message, _options, ...items) => items[0] as never);
    const fake = openSidebar();

    await vscode.commands.executeCommand('the-seed.deleteScope');

    const messages = configMessages(fake);
    assert.strictEqual(messages.length, 1);
    assert.deepStrictEqual(scopesOf(messages[0]), ['@keep']);
  });

  test('Delete Scope posts nothing when the confirmation is declined', async () => {
    writeScopes({ '@keep': 'Keeper' });
    sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    sinon.stub(vscode.window, 'showQuickPick').resolves('@keep' as unknown as vscode.QuickPickItem);
    sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);
    const fake = openSidebar();

    await vscode.commands.executeCommand('the-seed.deleteScope');

    assert.strictEqual(configMessages(fake).length, 0);
  });
});
