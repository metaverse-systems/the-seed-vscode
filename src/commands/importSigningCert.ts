import * as vscode from 'vscode';
import { chooseScope } from '../signing/chooseScope';
import type { ToolApi } from '../tool/toolApi';

export async function importSigningCert(outputChannel: vscode.OutputChannel, tool: ToolApi): Promise<void> {
  const signing = new tool.Signing();
  const scope = await chooseScope(signing, 'import the certificate', tool);
  if (!scope) {
    return;
  }
  const certResult = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectMany: false,
    openLabel: "Select Certificate File",
    filters: { 'PEM Files': ['pem', 'crt'] },
  });
  if (!certResult || certResult.length === 0) {return;}

  // Show file picker for private key
  const keyResult = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectMany: false,
    openLabel: "Select Private Key File",
    filters: { 'Key Files': ['pem', 'key'] },
  });
  if (!keyResult || keyResult.length === 0) {return;}

  // Check for existing cert
  if (signing.hasCert(scope)) {
    const overwrite = await vscode.window.showWarningMessage(
      'A signing certificate already exists. Overwrite?',
      'Overwrite',
      'Cancel'
    );
    if (overwrite !== 'Overwrite') {return;}
  }

  try {
    const certInfo = await signing.importCert(certResult[0].fsPath, keyResult[0].fsPath, scope);
    vscode.window.showInformationMessage(
      `Certificate imported. Subject: ${signing.formatSubject(certInfo.subject)} | Fingerprint: ${certInfo.fingerprint}`
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Import failed: ${message}`);
  }
}
