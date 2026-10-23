import * as vscode from 'vscode';
import { askQuestions } from '../askQuestions';
import type { ScopeAnswersType } from '@metaverse-systems/the-seed/types';
import type { ToolApi } from '../tool/toolApi';

export async function editScope(outputChannel: vscode.OutputChannel, tool: ToolApi): Promise<void> {
  const config = new tool.Config();
  const scopes = new tool.Scopes(config);

  const scopeNames = scopes.getScopes();

  if (scopeNames.length === 0) {
    vscode.window.showInformationMessage('No scopes to edit.');
    return;
  }

  const selectedScope = await vscode.window.showQuickPick(scopeNames, {
    placeHolder: 'Select a scope to edit',
  });

  if (!selectedScope) {
    return; // User cancelled
  }

  const scope = scopes.getScope(selectedScope);
  const questions = scopes.askEditScope({
    name: scope.author.name,
    email: scope.author.email,
    url: scope.author.url,
  });

  const answers = await askQuestions(questions);

  // User cancelled
  if (Object.keys(answers).length === 0) {
    return;
  }

  scopes.createOrEditScope({ scopeName: selectedScope, ...answers } as unknown as ScopeAnswersType);
  config.saveConfig();

  outputChannel.appendLine(`Scope '${selectedScope}' updated.`);
  vscode.window.showInformationMessage(`Scope '${selectedScope}' updated.`);
}
