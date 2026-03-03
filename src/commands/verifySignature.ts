import * as vscode from 'vscode';
import Signing from '@metaverse-systems/the-seed/dist/Signing';

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

  // Use verifyFile which auto-detects embedded vs detached signatures
  const result = await signing.verifyFile(targetPath);

  const timestamp = new Date().toISOString();
  const sigTypeLabel = result.signatureType ? ` (${result.signatureType})` : '';
  outputChannel.appendLine(`[${timestamp}] Verify ${targetPath}: ${result.status}${sigTypeLabel}`);

  if (result.status === 'VALID') {
    const subject = result.signer ? signing._formatSubject(result.signer.subject) : 'Unknown';
    const fingerprint = result.signer?.fingerprint || 'Unknown';
    vscode.window.showInformationMessage(
      `Verification: VALID ✓${sigTypeLabel} | Signer: ${subject} | Fingerprint: ${fingerprint}`
    );
  } else if (result.status === 'INVALID') {
    vscode.window.showWarningMessage(
      `Verification: INVALID ✗${sigTypeLabel} | Reason: ${result.reason || 'Unknown'}`
    );
  } else {
    vscode.window.showInformationMessage('No signature found for this file.');
  }

  // Display any warnings
  if (result.warnings) {
    for (const warning of result.warnings) {
      outputChannel.appendLine(`  Warning: ${warning}`);
      vscode.window.showWarningMessage(warning);
    }
  }
}
