import * as vscode from 'vscode';
import { askQuestions } from '../askQuestions';
import { chooseCreationFolder, describeError, openCreatedProject } from '../utils/projectFolder';
import type { ToolApi } from '../tool/toolApi';

export async function scaffoldTemplate(
  templateType: 'component' | 'system' | 'program',
  outputChannel: vscode.OutputChannel,
  tool: ToolApi
): Promise<void> {
  const config = new tool.Config();
  config.loadConfig();

  const template = new tool.Template(config);
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

  const creation = await chooseCreationFolder();
  if (!creation) {
    return;
  }

  let projectPath: string;
  try {
    projectPath = template.createPackage(scopeName, templateName, creation.folder);
  } catch (error) {
    if (error instanceof tool.ProjectError) {
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

  if (creation.openAfterCreate) {
    void openCreatedProject(projectPath);
  }
}
