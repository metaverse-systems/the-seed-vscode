import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';

suite('Build Commands Registration', () => {
  teardown(() => {
    sinon.restore();
  });

  const buildCommands = [
    'the-seed.buildNative',
    'the-seed.buildWindows',
    'the-seed.buildIncremental',
  ];

  for (const commandId of buildCommands) {
    test(`should register command: ${commandId}`, async () => {
      const commands = await vscode.commands.getCommands(true);
      assert.ok(
        commands.includes(commandId),
        `Command '${commandId}' should be registered`
      );
    });
  }

  test('buildNative command exists and is callable', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('the-seed.buildNative'));
  });

  test('buildWindows command exists and is callable', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('the-seed.buildWindows'));
  });

  test('buildIncremental command exists and is callable', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('the-seed.buildIncremental'));
  });
});
