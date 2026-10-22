import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

const manifest = require(path.resolve(__dirname, '..', '..', 'package.json')) as {
  contributes: {
    commands: Array<{ command: string }>;
    views: Record<string, Array<{ id: string }>>;
  };
};
const contributed: string[] = manifest.contributes.commands.map((entry) => entry.command);
// The editor registers open, focus and similar commands for every contributed view.
const viewIds: string[] = Object.values(manifest.contributes.views).flat().map((view) => view.id);

suite('Command Registration', () => {
  for (const commandId of contributed) {
    test(`registers ${commandId}`, async () => {
      const commands = await vscode.commands.getCommands(true);
      assert.ok(commands.includes(commandId), `Command '${commandId}' is contributed by the manifest but not registered`);
    });
  }

  test('every registered the-seed command is contributed by the manifest', async () => {
    const registered = (await vscode.commands.getCommands(true)).filter(
      (id) => id.startsWith('the-seed.') && !viewIds.some((viewId) => id.startsWith(`${viewId}.`))
    );
    const missing = registered.filter((id) => !contributed.includes(id));
    assert.deepStrictEqual(missing, [], `registered but not contributed: ${missing.join(', ')}`);
  });
});
