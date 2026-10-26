import * as vscode from 'vscode';
import { askQuestions } from '../askQuestions';
import type { ToolApi } from '../tool/toolApi';
import { activeViewProvider } from '../panels/TheSeedViewProvider';

export async function configureProject(outputChannel: vscode.OutputChannel, tool: ToolApi): Promise<void> {
  const config = new tool.Config();
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
  await activeViewProvider()?.refreshConfig();
}
