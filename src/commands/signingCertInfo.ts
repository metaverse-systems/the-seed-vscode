import * as vscode from 'vscode';
import { chooseScope } from '../signing/chooseScope';
import type { ToolApi } from '../tool/toolApi';

export async function signingCertInfo(outputChannel: vscode.OutputChannel, tool: ToolApi): Promise<void> {
  const signing = new tool.Signing();
  const scope = await chooseScope(signing, 'show the certificate', tool);
  if (!scope) {
    return;
  }
  const certInfo = signing.getCertInfo(scope);

  if (!certInfo) {
    const action = await vscode.window.showInformationMessage(
      'No signing certificate found.',
      'Create',
      'Import'
    );
    if (action === 'Create') {
      await vscode.commands.executeCommand('the-seed.createSigningCert');
    } else if (action === 'Import') {
      await vscode.commands.executeCommand('the-seed.importSigningCert');
    }
    return;
  }

  const subject = signing.formatSubject(certInfo.subject);
  const status = certInfo.isExpired ? 'Expired' : 'Active';
  vscode.window.showInformationMessage(
    `Certificate: ${subject} | Issuer: ${certInfo.issuer} | Status: ${status} | Fingerprint: ${certInfo.fingerprint}`
  );
}
