import * as vscode from 'vscode';
import Config from '@metaverse-systems/the-seed/dist/Config';
import Scopes from '@metaverse-systems/the-seed/dist/Scopes';

export async function listScopes(outputChannel: vscode.OutputChannel): Promise<void> {
  const config = new Config();
  const scopes = new Scopes(config);

  const scopeNames = scopes.getScopes();

  if (scopeNames.length === 0) {
    vscode.window.showInformationMessage('No scopes configured.');
    return;
  }

  outputChannel.clear();
  outputChannel.appendLine('=== Scopes ===');
  outputChannel.appendLine('');

  for (const name of scopeNames) {
    const scope = scopes.getScope(name);
    outputChannel.appendLine(`Scope: ${name}`);
    outputChannel.appendLine(`  Author: ${scope.author.name}`);
    outputChannel.appendLine(`  Email:  ${scope.author.email}`);
    outputChannel.appendLine(`  URL:    ${scope.author.url}`);
    outputChannel.appendLine('');
  }

  outputChannel.show(true);
}
