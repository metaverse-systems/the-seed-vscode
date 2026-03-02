import * as vscode from 'vscode';
import Signing from '@metaverse-systems/the-seed/dist/Signing';
import Config from '@metaverse-systems/the-seed/dist/Config';

export async function createSigningCert(outputChannel: vscode.OutputChannel): Promise<void> {
  const config = new Config();
  const signing = new Signing();

  // Check if name is configured
  if (!config.config.name) {
    vscode.window.showErrorMessage("Set your name in config.json first. Run 'The Seed: Configure Project' to set name, email, and org.");
    return;
  }

  // Show validity days input
  const validityStr = await vscode.window.showInputBox({
    prompt: 'Certificate validity (days)',
    value: '365',
    validateInput: (value) => {
      const num = parseInt(value, 10);
      if (isNaN(num) || num <= 0) {
        return 'Must be a positive integer';
      }
      return null;
    },
  });

  if (!validityStr) {
    return; // User cancelled
  }
  const validityDays = parseInt(validityStr, 10);

  // Check for existing certificate
  if (signing.hasCert()) {
    const overwrite = await vscode.window.showWarningMessage(
      'A signing certificate already exists. Overwrite?',
      'Overwrite',
      'Cancel'
    );
    if (overwrite !== 'Overwrite') {
      return;
    }
  }

  const certInfo = await signing.createCert({ validityDays });
  const timestamp = new Date().toISOString();
  outputChannel.appendLine(`[${timestamp}] Signing certificate created: ${certInfo.fingerprint}`);
  vscode.window.showInformationMessage(`Signing certificate created. Fingerprint: ${certInfo.fingerprint}`);
}
