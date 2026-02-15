import * as vscode from 'vscode';
import { askQuestions } from '../askQuestions';
import Config from '@metaverse-systems/the-seed/dist/Config';
import Scopes from '@metaverse-systems/the-seed/dist/Scopes';

export async function addScope(outputChannel: vscode.OutputChannel): Promise<void> {
  const config = new Config();
  const scopes = new Scopes(config);

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

  scopes.createOrEditScope(answers);
  config.saveConfig();

  outputChannel.appendLine(`Scope '${scopeName}' added.`);
  vscode.window.showInformationMessage(`Scope '${scopeName}' added.`);
}
