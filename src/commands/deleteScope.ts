import * as vscode from 'vscode';
import Config from '@metaverse-systems/the-seed/dist/Config';
import Scopes from '@metaverse-systems/the-seed/dist/Scopes';

export async function deleteScope(outputChannel: vscode.OutputChannel): Promise<void> {
  const config = new Config();
  const scopes = new Scopes(config);

  const scopeNames = scopes.getScopes();

  if (scopeNames.length === 0) {
    vscode.window.showInformationMessage('No scopes to delete.');
    return;
  }

  const selectedScope = await vscode.window.showQuickPick(scopeNames, {
    placeHolder: 'Select a scope to delete',
  });

  if (!selectedScope) {
    return; // User cancelled
  }

  const deleteBtn: vscode.MessageItem = { title: 'Delete' };
  const cancelBtn: vscode.MessageItem = { title: 'Cancel', isCloseAffordance: true };
  const result = await vscode.window.showWarningMessage(
    `Delete scope "${selectedScope}"?`,
    { modal: true, detail: 'This action cannot be undone.' },
    deleteBtn,
    cancelBtn
  );

  if (result !== deleteBtn) {
    return; // User cancelled
  }

  scopes.deleteScope(selectedScope);
  config.saveConfig();

  outputChannel.appendLine(`Scope '${selectedScope}' deleted.`);
  vscode.window.showInformationMessage(`Scope '${selectedScope}' deleted.`);
}
