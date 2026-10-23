import * as vscode from 'vscode';
import { choosePakProject, describeError, isToolRefusal } from '../utils/projectFolder';
import { addResourceFile } from '../utils/addResourceFile';
import type { ToolApi } from '../tool/toolApi';

export async function addResource(outputChannel: vscode.OutputChannel, tool: ToolApi): Promise<void> {
  const config = new tool.Config();
  const rp = new tool.ResourcePak(config);

  const packageDir = await choosePakProject(tool);
  if (!packageDir) {
    return;
  }
  outputChannel.appendLine(`[INFO] ResourcePak: ${packageDir}`);

  // Open file picker
  const fileResult = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectMany: false,
    openLabel: "Select Resource File",
  });
  if (!fileResult || fileResult.length === 0) {
    return;
  }
  const selectedFile = fileResult[0].fsPath;

  // Prompt for resource name
  const resourceName = await vscode.window.showInputBox({
    prompt: "Enter a name for this resource",
    placeHolder: "my-resource",
    validateInput: (value) => (value === "" ? "Name is required" : null),
  });
  if (!resourceName) {
    return;
  }

  try {
    addResourceFile(rp, packageDir, resourceName, selectedFile, tool);
  } catch (error) {
    if (isToolRefusal(error)) {
      outputChannel.appendLine(`[ERROR] ${describeError(error)}`);
      vscode.window.showErrorMessage(describeError(error));
      return;
    }
    throw error;
  }
  vscode.window.showInformationMessage(
    `Resource '${resourceName}' added to ResourcePak`
  );
}
