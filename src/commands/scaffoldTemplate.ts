import * as vscode from 'vscode';
import { askQuestions } from '../askQuestions';
import Config from '@metaverse-systems/the-seed/Config';
import Template from '@metaverse-systems/the-seed/Template';
import { ProjectError } from '@metaverse-systems/the-seed/ProjectError';
import { chooseProjectFolder, describeError } from '../utils/projectFolder';

export async function scaffoldTemplate(
  templateType: 'component' | 'system' | 'program',
  outputChannel: vscode.OutputChannel
): Promise<void> {
  const config = new Config();
  config.loadConfig();

  const template = new Template(config);
  template.type = templateType;

  const questions = template.askName();
  const answers = await askQuestions(questions);

  // User cancelled at any prompt
  if (!answers.scopeName || !answers.templateName) {
    return;
  }

  const scopeName = answers.scopeName;
  const templateName = answers.templateName;

  // Check if scopes exist
  const scopeList = template.scopes.getScopes();
  if (scopeList.length === 0) {
    vscode.window.showInformationMessage('Configure a scope first');
    return;
  }

  const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
  const folder = await chooseProjectFolder();
  if (!folder) {
    return;
  }

  let projectPath: string;
  try {
    projectPath = template.createPackage(scopeName, templateName, folder);
  } catch (error) {
    if (error instanceof ProjectError) {
      outputChannel.appendLine(`[ERROR] ${describeError(error)}`);
      vscode.window.showErrorMessage(describeError(error));
      return;
    }
    throw error;
  }

  const label = templateType.charAt(0).toUpperCase() + templateType.slice(1);
  outputChannel.appendLine(
    `${label} '${templateName}' created at ${projectPath}`
  );
  vscode.window.showInformationMessage(
    `${label} '${templateName}' created at ${projectPath}`
  );

  // If no workspace was open, open the new folder
  if (!hasWorkspace) {
    const folderUri = vscode.Uri.file(projectPath);
    vscode.commands.executeCommand('vscode.openFolder', folderUri);
  }
}
