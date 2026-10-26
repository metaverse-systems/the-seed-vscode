import * as os from 'os';
import * as path from 'path';
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

  // Offer the first workspace folder, or the home directory when no folder is open.
  const folders = vscode.workspace.workspaceFolders;
  const defaultUri = folders && folders.length > 0
    ? vscode.Uri.joinPath(folders[0].uri, 'signing-cert.pem')
    : vscode.Uri.file(path.join(os.homedir(), 'signing-cert.pem'));
  const saveUri = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { 'PEM Files': ['pem'] },
  });
  if (!saveUri) {return;}

  await signing.exportCert(saveUri.fsPath, scope);
  vscode.window.showInformationMessage(`Certificate exported to ${saveUri.fsPath}`);
}
