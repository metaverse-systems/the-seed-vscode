import * as vscode from 'vscode';
import { chooseScope } from '../signing/chooseScope';
import type { ToolApi } from '../tool/toolApi';

export async function createSigningCert(outputChannel: vscode.OutputChannel, tool: ToolApi): Promise<void> {
  const config = new tool.Config();
  config.loadConfig();
  const signing = new tool.Signing();

  const scope = await chooseScope(signing, 'create the certificate', tool);
  if (!scope) {
    return;
  }

  const authorName = config.config.scopes[scope]?.author?.name;
  if (!authorName) {
    const action = await vscode.window.showErrorMessage(
      `Scope ${scope} has no author name.`,
      'Edit Scope'
    );
    if (action === 'Edit Scope') {
      await vscode.commands.executeCommand('the-seed.editScope');
    }
    return;
  }

  const validityStr = await vscode.window.showInputBox({
    prompt: 'Certificate validity (days)',
    value: String(tool.DEFAULT_VALIDITY_DAYS),
    validateInput: (value) => {
      if (!/^[1-9][0-9]*$/.test(value) || parseInt(value, 10) > tool.MAX_VALIDITY_DAYS) {
        return `A whole number of days from 1 to ${tool.MAX_VALIDITY_DAYS}`;
      }
      return null;
    },
  });

  if (!validityStr) {
    return; // User cancelled
  }
  const validityDays = parseInt(validityStr, 10);

  // Check for existing certificate
  if (signing.hasCert(scope)) {
    const overwrite = await vscode.window.showWarningMessage(
      'A signing certificate already exists. Overwrite?',
      'Overwrite',
      'Cancel'
    );
    if (overwrite !== 'Overwrite') {
      return;
    }
  }

  const certInfo = await signing.createCert({ scope, validityDays });
  const timestamp = new Date().toISOString();
  outputChannel.appendLine(`[${timestamp}] Signing certificate created: ${certInfo.fingerprint}`);
  vscode.window.showInformationMessage(`Signing certificate created. Fingerprint: ${certInfo.fingerprint}`);
}
