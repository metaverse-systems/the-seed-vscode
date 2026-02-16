import * as vscode from 'vscode';
import { askQuestions } from '../askQuestions';
import Config from '@metaverse-systems/the-seed/dist/Config';

export async function configureProject(outputChannel: vscode.OutputChannel): Promise<void> {
  const config = new Config();
  const questions = config.getQuestions();
  const answers = await askQuestions(questions);

  if (!answers.prefix && answers.prefix !== '') {
    return; // User cancelled
  }

  // If answers is empty object (cancel), exit
  if (Object.keys(answers).length === 0) {
    return;
  }

  config.parseAnswers(answers as { prefix: string });
  config.saveConfig();

  outputChannel.appendLine(`Configuration saved. Prefix: ${config.config.prefix}`);
  vscode.window.showInformationMessage('Configuration saved.');
}
