import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { askQuestions } from '../askQuestions';
import Config from '@metaverse-systems/the-seed/dist/Config';
import Template from '@metaverse-systems/the-seed/dist/Template';
import { createTemplatePackage } from '../templateRuntime';

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

  // Check if a workspace folder is open
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const hasWorkspace = workspaceFolders && workspaceFolders.length > 0;

  // Determine target path based on workspace state
  let projectPath: string;
  if (hasWorkspace) {
    // Create in the first workspace folder
    projectPath = path.join(workspaceFolders[0].uri.fsPath, templateName);
  } else {
    // Use default prefix-based path
    projectPath = path.join(
      config.config.prefix,
      'projects',
      scopeName,
      templateName
    );
  }

  if (fs.existsSync(projectPath)) {
    vscode.window.showWarningMessage(
      `Directory already exists: ${projectPath}`
    );
    return;
  }

  createTemplatePackage(template, scopeName, templateName, projectPath);

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
