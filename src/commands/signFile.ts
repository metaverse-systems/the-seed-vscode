import * as vscode from 'vscode';
import { chooseScope } from '../signing/chooseScope';
import { describeSignFailure } from '../signing/signFailure';
import type { ToolApi } from '../tool/toolApi';

export async function signFile(outputChannel: vscode.OutputChannel, tool: ToolApi, uri?: vscode.Uri): Promise<void> {
  const signing = new tool.Signing();

  const scope = await chooseScope(signing, 'sign files', tool);
  if (!scope) {
    return;
  }

  if (!signing.hasCert(scope)) {
    const action = await vscode.window.showErrorMessage(
      `No signing certificate for scope ${scope}.`,
      'Create Certificate'
    );
    if (action === 'Create Certificate') {
      await vscode.commands.executeCommand('the-seed.createSigningCert');
    }
    return;
  }

  // Determine target file
  let targetPath: string | undefined;

  if (uri) {
    targetPath = uri.fsPath;
  } else {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      targetPath = activeEditor.document.uri.fsPath;
    }
  }

  if (!targetPath) {
    vscode.window.showErrorMessage('No file selected. Open a file or use the context menu.');
    return;
  }

  // Check if file is binary
  const isBin = await signing.isBinaryFile(targetPath);
  if (!isBin) {
    vscode.window.showWarningMessage('Only binary files can be signed.');
    return;
  }

  try {
    const result = await signing.signFile(targetPath, { scope });
    const fileName = targetPath.split('/').pop() || targetPath;

    const timestamp = new Date().toISOString();

    if (result.signatureType === 'embedded') {
      outputChannel.appendLine(`[${timestamp}] Signed (embedded): ${result.filePath}`);
      vscode.window.showInformationMessage(`Embedded signature applied to ${fileName}`);
    } else {
      const sigName = result.signaturePath?.split('/').pop() || result.signaturePath;
      outputChannel.appendLine(`[${timestamp}] Signed (detached): ${result.filePath} → ${result.signaturePath}`);
      vscode.window.showInformationMessage(`Detached signature saved to ${sigName}`);
    }

    // Display any warnings
    for (const warning of result.warnings) {
      outputChannel.appendLine(`  Warning: ${warning}`);
      vscode.window.showWarningMessage(warning);
    }
  } catch (err: unknown) {
    const failure = describeSignFailure(err, new Date().toISOString());
    outputChannel.appendLine(failure.logLine);
    vscode.window.showErrorMessage(failure.notification);
  }
}
