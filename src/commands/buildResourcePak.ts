import * as vscode from 'vscode';
import { choosePakProject, describeError, isToolRefusal } from '../utils/projectFolder';
import type { ToolApi } from '../tool/toolApi';

export async function buildResourcePak(outputChannel: vscode.OutputChannel, tool: ToolApi): Promise<void> {
  const config = new tool.Config();
  const rp = new tool.ResourcePak(config);

  const packageDir = await choosePakProject(tool);
  if (!packageDir) {
    return;
  }
  outputChannel.appendLine(`[INFO] ResourcePak: ${packageDir}`);

  let pakFilePath: string;
  try {
    pakFilePath = rp.build(packageDir);
  } catch (error) {
    if (isToolRefusal(error)) {
      outputChannel.appendLine(`[ERROR] ${describeError(error)}`);
      vscode.window.showErrorMessage(describeError(error));
      return;
    }
    throw error;
  }

  vscode.window.showInformationMessage(
    `ResourcePak built successfully: ${pakFilePath}`
  );
}
