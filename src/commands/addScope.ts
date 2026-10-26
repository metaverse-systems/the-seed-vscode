import * as vscode from 'vscode';
import { askQuestions } from '../askQuestions';
import type { ScopeAnswersType } from '@metaverse-systems/the-seed/types';
import type { ToolApi } from '../tool/toolApi';
import { activeViewProvider } from '../panels/TheSeedViewProvider';

export async function addScope(outputChannel: vscode.OutputChannel, tool: ToolApi): Promise<void> {
  const config = new tool.Config();
  const scopes = new tool.Scopes(config);

  const questions = scopes.askNewScope();
  const answers = await askQuestions(questions);

  // User cancelled
  if (Object.keys(answers).length === 0) {
    return;
  }

  // Normalize scope name: prepend @ if missing
  let scopeName = answers.scopeName || '';
  if (scopeName && !scopeName.startsWith('@')) {
    scopeName = `@${scopeName}`;
    answers.scopeName = scopeName;
  }

  const invalid = tool.validateScopeName(scopeName);
  if (invalid !== null) {
    vscode.window.showErrorMessage(invalid);
    return;
  }

  // Check for duplicate scope
  const existingScopes = scopes.getScopes();
  if (existingScopes.includes(scopeName)) {
    const overwrite = await vscode.window.showWarningMessage(
      `Scope "${scopeName}" already exists. Overwrite?`,
      { modal: false },
      'Yes',
      'No'
    );
    if (overwrite !== 'Yes') {
      return;
    }
  }

  scopes.createOrEditScope(answers as unknown as ScopeAnswersType);
  config.saveConfig();

  outputChannel.appendLine(`Scope '${scopeName}' added.`);
  vscode.window.showInformationMessage(`Scope '${scopeName}' added.`);
  await activeViewProvider()?.refreshConfig();
}
