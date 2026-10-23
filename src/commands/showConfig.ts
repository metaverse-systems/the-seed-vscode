import * as vscode from 'vscode';
import type { ToolApi } from '../tool/toolApi';

export async function showConfig(outputChannel: vscode.OutputChannel, tool: ToolApi): Promise<void> {
  const config = new tool.Config();
  const scopes = new tool.Scopes(config);

  outputChannel.clear();
  outputChannel.appendLine('=== The Seed Configuration ===');
  outputChannel.appendLine('');
  outputChannel.appendLine(`Prefix: ${config.config.prefix}`);
  outputChannel.appendLine('');

  const scopeNames = scopes.getScopes();

  if (scopeNames.length === 0) {
    outputChannel.appendLine('No scopes configured.');
  } else {
    outputChannel.appendLine('--- Scopes ---');
    outputChannel.appendLine('');

    for (const name of scopeNames) {
      const scope = scopes.getScope(name);
      outputChannel.appendLine(`Scope: ${name}`);
      outputChannel.appendLine(`  Author: ${scope.author.name}`);
      outputChannel.appendLine(`  Email:  ${scope.author.email}`);
      outputChannel.appendLine(`  URL:    ${scope.author.url}`);
      outputChannel.appendLine('');
    }
  }

  outputChannel.show(true);
}
