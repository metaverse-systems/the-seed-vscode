import * as path from 'path';
import * as vscode from 'vscode';
import { chooseScope } from '../signing/chooseScope';
import { describeSignFailure } from '../signing/signFailure';
import type { ToolApi } from '../tool/toolApi';
import { commandTargets, NO_FILE_SELECTED } from './commandTargets';

type Signing = InstanceType<ToolApi['Signing']>;
type SignResult = Awaited<ReturnType<Signing['signFile']>>;

/**
 * The file name at the end of `p`. A path with backslashes and no forward slash is a Windows path, whose
 * name is found the Windows way on every host.
 */
function displayName(p: string): string {
  if (p.includes('\\') && !p.includes('/')) {
    return path.win32.basename(p);
  }
  return path.basename(p);
}

/** Writes the output lines for one signed file. */
function logSigned(outputChannel: vscode.OutputChannel, result: SignResult): void {
  const timestamp = new Date().toISOString();
  if (result.signatureType === 'embedded') {
    outputChannel.appendLine(`[${timestamp}] Signed (embedded): ${result.filePath}`);
  } else {
    outputChannel.appendLine(`[${timestamp}] Signed (detached): ${result.filePath} → ${result.signaturePath}`);
  }
  for (const warning of result.warnings) {
    outputChannel.appendLine(`  Warning: ${warning}`);
  }
}

/** Signs one file and shows the outcome in notifications, as for a single chosen or open file. */
async function signOne(outputChannel: vscode.OutputChannel, signing: Signing, targetPath: string, scope: string): Promise<void> {
  try {
    const result = await signing.signFile(targetPath, { scope });
    const fileName = displayName(targetPath);
    logSigned(outputChannel, result);

    if (result.signatureType === 'embedded') {
      vscode.window.showInformationMessage(`Embedded signature applied to ${fileName}`);
    } else {
      const sigName = result.signaturePath ? displayName(result.signaturePath) : result.signaturePath;
      vscode.window.showInformationMessage(`Detached signature saved to ${sigName}`);
    }

    for (const warning of result.warnings) {
      vscode.window.showWarningMessage(warning);
    }
  } catch (err: unknown) {
    const failure = describeSignFailure(err, new Date().toISOString());
    outputChannel.appendLine(failure.logLine);
    vscode.window.showErrorMessage(failure.notification);
  }
}

/**
 * Sign the file the command was started on, every file of the explorer selection, or the active editor's
 * file. Only binaries are signed; the scope is chosen and its certificate checked once for all of them.
 * One file shows its outcome in notifications; several files write each outcome to the output channel,
 * carry on after a failure, and end with one summary notification.
 */
export async function signFile(outputChannel: vscode.OutputChannel, tool: ToolApi, ...args: unknown[]): Promise<void> {
  const targets = commandTargets(args);
  if (!targets) {
    vscode.window.showErrorMessage(NO_FILE_SELECTED);
    return;
  }

  const signing = new tool.Signing();

  const binaries: string[] = [];
  const skipped: string[] = [];
  for (const target of targets) {
    if (await signing.isBinaryFile(target)) {
      binaries.push(target);
    } else {
      skipped.push(path.basename(target));
    }
  }

  if (binaries.length === 0) {
    if (skipped.length === 1) {
      vscode.window.showWarningMessage(`Only binary files can be signed: ${skipped[0]}.`);
    } else {
      vscode.window.showWarningMessage(`Only binary files can be signed; skipped: ${skipped.join(', ')}.`);
    }
    return;
  }

  const scope = await chooseScope(signing, 'sign files', tool);
  if (!scope) {
    return;
  }

  if (!signing.hasCert(scope)) {
    const action = await vscode.window.showErrorMessage(
      `No signing certificate for scope ${scope}.`,
      'Create Certificate'
    );
    if (action === 'Create Certificate') {
      await vscode.commands.executeCommand('the-seed.createSigningCert');
    }
    return;
  }

  if (targets.length === 1) {
    await signOne(outputChannel, signing, binaries[0], scope);
    return;
  }

  let signed = 0;
  let failed = 0;
  for (const target of binaries) {
    try {
      logSigned(outputChannel, await signing.signFile(target, { scope }));
      signed++;
    } catch (err: unknown) {
      outputChannel.appendLine(describeSignFailure(err, new Date().toISOString()).logLine);
      failed++;
    }
  }

  if (skipped.length > 0) {
    vscode.window.showWarningMessage(`Only binary files can be signed; skipped: ${skipped.join(', ')}.`);
  }

  if (signed === targets.length) {
    vscode.window.showInformationMessage(`Signed ${signed} files.`);
    return;
  }
  const summary = `Signed ${signed} of ${targets.length} files: ${skipped.length} skipped, ${failed} failed. See the output for details.`;
  if (failed > 0) {
    vscode.window.showErrorMessage(summary);
  } else {
    vscode.window.showWarningMessage(summary);
  }
}
