import * as vscode from 'vscode';
import type { ToolApi } from '../tool/toolApi';

export async function listScopes(outputChannel: vscode.OutputChannel, tool: ToolApi): Promise<void> {
  const config = new tool.Config();
  const scopes = new tool.Scopes(config);

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
