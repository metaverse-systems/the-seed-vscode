import * as vscode from 'vscode';
import Signing from '@metaverse-systems/the-seed/dist/Signing';
import * as fs from 'fs';

export async function verifySignature(outputChannel: vscode.OutputChannel, uri?: vscode.Uri): Promise<void> {
  const signing = new Signing();

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

  // Check if .sig file exists
  const sigPath = targetPath + '.sig';
  if (!fs.existsSync(sigPath)) {
    vscode.window.showInformationMessage('No signature found for this file.');
    return;
  }

  const result = await signing.verifyFile(targetPath);

  const timestamp = new Date().toISOString();
  outputChannel.appendLine(`[${timestamp}] Verify ${targetPath}: ${result.status}`);

  if (result.status === 'VALID') {
    const subject = result.signer ? signing._formatSubject(result.signer.subject) : 'Unknown';
    const fingerprint = result.signer?.fingerprint || 'Unknown';
    vscode.window.showInformationMessage(
      `Verification: VALID ✓ | Signer: ${subject} | Fingerprint: ${fingerprint}`
    );
  } else if (result.status === 'INVALID') {
    vscode.window.showWarningMessage(
      `Verification: INVALID ✗ | Reason: ${result.reason || 'Unknown'}`
    );
  } else {
    vscode.window.showInformationMessage('No signature found for this file.');
  }
}
