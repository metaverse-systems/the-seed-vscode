import * as vscode from 'vscode';
import { askQuestions } from '../askQuestions';
import { chooseCreationFolder, openCreatedProject } from '../utils/projectFolder';
import { rememberPak, resourcePakStatus } from '../utils/pakChoice';
import { activeViewProvider } from '../panels/TheSeedViewProvider';
import type { ToolApi } from '../tool/toolApi';

export async function createResourcePak(outputChannel: vscode.OutputChannel, tool: ToolApi): Promise<void> {
  const config = new tool.Config();
  const rp = new tool.ResourcePak(config);

  const questions = rp.askName();
  const answers = await askQuestions(questions);

  if (!answers.scopeName || !answers.pakName) {
    return;
  }

  const creation = await chooseCreationFolder();
  if (!creation) {
    return;
  }
  const packageDir = rp.createPackage(answers.scopeName, answers.pakName, creation.folder);
  rememberPak(packageDir);
  outputChannel.appendLine(`[INFO] ResourcePak '${answers.pakName}' created at ${packageDir}`);
  vscode.window.showInformationMessage(`ResourcePak '${answers.pakName}' created at ${packageDir}`);
  // The sidebar shows the new pak without being asked
  activeViewProvider()?.postMessage({ type: 'resourcePakStatus', requestId: '', payload: resourcePakStatus() });
  if (creation.openAfterCreate) {
    void openCreatedProject(packageDir);
  }
}
