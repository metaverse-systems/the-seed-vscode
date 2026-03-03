import * as vscode from 'vscode';
import Signing from '@metaverse-systems/the-seed/dist/Signing';

export async function signFile(outputChannel: vscode.OutputChannel, uri?: vscode.Uri): Promise<void> {
  const signing = new Signing();

  // Check if cert exists
  if (!signing.hasCert()) {
    const action = await vscode.window.showErrorMessage(
      'No signing certificate found.',
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

  const result = await signing.signFile(targetPath);
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
}
