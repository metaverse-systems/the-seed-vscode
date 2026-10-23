import * as vscode from 'vscode';
import { chooseScope } from '../signing/chooseScope';
import type { ToolApi } from '../tool/toolApi';

export async function exportSigningCert(outputChannel: vscode.OutputChannel, tool: ToolApi): Promise<void> {
  const signing = new tool.Signing();
  const scope = await chooseScope(signing, 'export the certificate', tool);
  if (!scope) {
    return;
  }

  if (!signing.hasCert(scope)) {
    vscode.window.showErrorMessage(`No signing certificate for scope ${scope}.`);
    return;
  }

  const saveUri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file('signing-cert.pem'),
    filters: { 'PEM Files': ['pem'] },
  });
  if (!saveUri) {return;}

  await signing.exportCert(saveUri.fsPath, scope);
  vscode.window.showInformationMessage(`Certificate exported to ${saveUri.fsPath}`);
}
