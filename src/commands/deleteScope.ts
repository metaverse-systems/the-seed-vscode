import * as vscode from 'vscode';
import type { ToolApi } from '../tool/toolApi';
import { activeViewProvider } from '../panels/TheSeedViewProvider';

export async function deleteScope(outputChannel: vscode.OutputChannel, tool: ToolApi): Promise<void> {
  const config = new tool.Config();
  const scopes = new tool.Scopes(config);

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
  await activeViewProvider()?.refreshConfig();
}
