import * as vscode from 'vscode';
import Config from '@metaverse-systems/the-seed/dist/Config';
import Package from '@metaverse-systems/the-seed/dist/Package';
import { removeSync } from 'fs-extra';
import * as path from 'path';
import { acquireOperationLock, releaseOperationLock } from '../operationLock';
import type { TheSeedViewProvider } from '../panels/TheSeedViewProvider';
import type { PackageStatusPayload } from '../types/messages';

/**
 * Creates the packageProject command handler.
 * Factory function returning a command handler compatible with wrapCommand.
 */
export function packageProjectCommand(
  outputChannel: vscode.OutputChannel,
  viewProvider: TheSeedViewProvider
): (oc: vscode.OutputChannel) => Promise<void> {
  return async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage('No workspace folder open. Open a project folder first.');
      return;
    }
    const projectDir = workspaceFolders[0].uri.fsPath;

    // Validate Config is loaded with a non-default prefix
    const config = new Config();
    config.loadConfig();
    if (!config.config.prefix || config.config.prefix === '') {
      vscode.window.showErrorMessage(
        'No prefix configured. Run "The Seed: Configure Project" first.'
      );
      return;
    }

    // Acquire operation lock ('package') — mutual exclusion with build/install
    const lockResult = acquireOperationLock('package');
    if (!lockResult.success) {
      const msg = lockResult.heldBy === 'build'
        ? 'Cannot package while a build operation is in progress.'
        : lockResult.heldBy === 'install'
          ? 'Cannot package while an install operation is in progress.'
          : 'A package operation is already in progress.';
      vscode.window.showWarningMessage(msg);
      return;
    }

    // Remove existing dist/ directory
    const outputDir = path.join(projectDir, 'dist');
    try {
      removeSync(outputDir);
    } catch {
      // Directory may not exist — that's fine
    }

    // Broadcast running status
    const runningStatus: PackageStatusPayload = {
      state: 'running',
      timestamp: new Date().toISOString(),
    };
    viewProvider.postMessage({ type: 'packageStatus', payload: runningStatus });

    // Show output channel with timestamped separator header
    outputChannel.show(true);
    const timestamp = new Date().toISOString();
    outputChannel.appendLine(`\n${'═'.repeat(60)}`);
    outputChannel.appendLine(`Package started at ${timestamp}`);
    outputChannel.appendLine(`Project: ${projectDir}`);
    outputChannel.appendLine(`${'═'.repeat(60)}\n`);

    // Monkey-patch console.log/console.error to capture per-file output
    const originalLog = console.log;
    const originalError = console.error;
    let filesCopied = 0;

    try {
      console.log = (...args: unknown[]) => {
        const line = args.map(String).join(' ');
        outputChannel.appendLine(line);
        filesCopied++;
        // Update running status with current file info
        const currentStatus: PackageStatusPayload = {
          state: 'running',
          currentFile: line,
          filesCopied,
          timestamp: new Date().toISOString(),
        };
        viewProvider.postMessage({ type: 'packageStatus', payload: currentStatus });
      };

      console.error = (...args: unknown[]) => {
        const line = args.map(String).join(' ');
        outputChannel.appendLine(`[ERROR] ${line}`);
      };

      // Wrap Package.run() in withProgress for notification-level spinner
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Packaging project...',
          cancellable: false,
        },
        async () => {
          const pkg = new Package(config);
          pkg.run(outputDir, [projectDir]);
        }
      );

      // Add summary line
      outputChannel.appendLine(`\n── Packaged ${filesCopied} files into dist/ ──`);

      // Broadcast completed status
      const completedStatus: PackageStatusPayload = {
        state: 'completed',
        filesCopied,
        totalFiles: filesCopied,
        timestamp: new Date().toISOString(),
      };
      viewProvider.postMessage({ type: 'packageStatus', payload: completedStatus });

      // Show success notification
      vscode.window.showInformationMessage(
        `Packaged ${filesCopied} files into dist/`
      );
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      outputChannel.appendLine(`\n── Packaging failed: ${errorMessage} ──`);
      outputChannel.show(true);

      // Broadcast failed status
      const failedStatus: PackageStatusPayload = {
        state: 'failed',
        errorMessage,
        filesCopied,
        timestamp: new Date().toISOString(),
      };
      viewProvider.postMessage({ type: 'packageStatus', payload: failedStatus });

      // Show error notification
      vscode.window.showErrorMessage(`Packaging failed: ${errorMessage}`);
    } finally {
      // Restore console methods
      console.log = originalLog;
      console.error = originalError;

      // Always release the operation lock
      releaseOperationLock();
    }
  };
}
