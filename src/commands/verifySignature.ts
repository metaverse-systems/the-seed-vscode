import * as vscode from 'vscode';
import { describeVerification, type VerificationMessage } from '../signing/verificationMessage';
import type { ToolApi } from '../tool/toolApi';
import { commandTargets, NO_FILE_SELECTED } from './commandTargets';

type Severity = VerificationMessage['severity'];

/** Verifies one file, writes its output lines and gives the severity and summary of the outcome. */
async function verifyOne(
  outputChannel: vscode.OutputChannel,
  signing: InstanceType<ToolApi['Signing']>,
  targetPath: string
): Promise<{ severity: Severity; summary: string }> {
  const timestamp = new Date().toISOString();
  try {
    const result = await signing.verifyFile(targetPath);
    const message = describeVerification(result, (subject) => signing._formatSubject(subject));

    outputChannel.appendLine(`[${timestamp}] Verify ${targetPath}: ${result.status}`);
    for (const line of message.details) {
      outputChannel.appendLine(`  ${line}`);
    }
    return { severity: message.severity, summary: message.summary };
  } catch (err) {
    const text = `Verification failed: ${err instanceof Error ? err.message : String(err)}`;
    outputChannel.appendLine(`[${timestamp}] Verify ${targetPath}: ${text}`);
    return { severity: 'error', summary: text };
  }
}

function notify(severity: Severity, text: string): void {
  if (severity === 'error') {
    vscode.window.showErrorMessage(text);
  } else if (severity === 'warning') {
    vscode.window.showWarningMessage(text);
  } else {
    vscode.window.showInformationMessage(text);
  }
}

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
 *
 * The file is the one the command was started on, else the active editor's file. When the command was
 * started on an explorer selection of several files, each is verified in turn with the same output lines,
 * a failure does not stop the rest, and one summary notification at the worst severity seen ends the run.
 */
export async function verifySignature(outputChannel: vscode.OutputChannel, tool: ToolApi, ...args: unknown[]): Promise<void> {
  const targets = commandTargets(args);
  if (!targets) {
    vscode.window.showErrorMessage(NO_FILE_SELECTED);
    return;
  }

  const signing = new tool.Signing();

  if (targets.length === 1) {
    const outcome = await verifyOne(outputChannel, signing, targets[0]);
    notify(outcome.severity, outcome.summary);
    return;
  }

  const counts: Record<Severity, number> = { information: 0, warning: 0, error: 0 };
  for (const target of targets) {
    counts[(await verifyOne(outputChannel, signing, target)).severity]++;
  }

  const worst: Severity = counts.error > 0 ? 'error' : counts.warning > 0 ? 'warning' : 'information';
  notify(
    worst,
    `Verified ${targets.length} files: ${counts.information} passed, ${counts.warning} with warnings, ${counts.error} failed. See the output for details.`
  );
}
