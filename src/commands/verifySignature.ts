import * as vscode from 'vscode';
import Signing from '@metaverse-systems/the-seed/Signing';
import { describeVerification } from '../signing/verificationMessage';

/**
 * Verify the signature(s) of one file and show the outcome.
 *
 * The file's embedded signature and its detached `.sig` are both checked when present. The report keeps
 * integrity (is the file unchanged since it was signed) apart from trust (is the signer one of the
 * certificates of the configured scopes): a file that is intact but signed by someone else is a warning,
 * an altered or partly signed file an error, and a signature that could not be checked is a warning.
 * One notification is shown; the details (integrity, trust, signer, slices, warnings and what was not
 * checked) go to the output channel. A file that cannot be verified at all (not found, a signature file
 * or manifest chosen) is shown as a failure.
 */
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

  const timestamp = new Date().toISOString();
  try {
    const result = await signing.verifyFile(targetPath);
    const message = describeVerification(result, (subject) => signing._formatSubject(subject));

    outputChannel.appendLine(`[${timestamp}] Verify ${targetPath}: ${result.status}`);
    for (const line of message.details) {
      outputChannel.appendLine(`  ${line}`);
    }

    if (message.severity === 'error') {
      vscode.window.showErrorMessage(message.summary);
    } else if (message.severity === 'warning') {
      vscode.window.showWarningMessage(message.summary);
    } else {
      vscode.window.showInformationMessage(message.summary);
    }
  } catch (err) {
    const text = `Verification failed: ${err instanceof Error ? err.message : String(err)}`;
    outputChannel.appendLine(`[${timestamp}] Verify ${targetPath}: ${text}`);
    vscode.window.showErrorMessage(text);
  }
}
