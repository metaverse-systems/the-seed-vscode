import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { acquireOperationLock, releaseOperationLock, lockRefusal } from '../operationLock';
import type { TheSeedViewProvider } from '../panels/TheSeedViewProvider';
import type { PackageStatusPayload } from '../types/messages';
import { packageStatusFrom, packageNotification } from '../build/packageOutcome';
import type { PackageCopyEvent, PackageResult, PackageRunOptions, ToolLogLevel } from '@metaverse-systems/the-seed/types';
import type { ToolApi } from '../tool/toolApi';
import type { ToolHandler } from './wrapCommand';

/** A line the tool reported, as the output panel shows it: warnings and errors carry their level. */
export function levelLine(line: string, level: ToolLogLevel): string {
  if (level === 'warn') {
    return `[WARNING] ${line}`;
  }
  if (level === 'error') {
    return `[ERROR] ${line}`;
  }
  return line;
}

/**
 * Creates the packageProject command handler.
 * Factory function returning a command handler compatible with wrapCommand.
 */
export function packageProjectCommand(
  outputChannel: vscode.OutputChannel,
  viewProvider: TheSeedViewProvider
): ToolHandler {
  return async (_oc, tool) => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage('No workspace folder open. Open a project folder first.');
      return;
    }
    const projectDir = workspaceFolders[0].uri.fsPath;

    // Validate Config is loaded with a non-default prefix
    const config = new tool.Config();
    config.loadConfig();
    if (!config.config.prefix || config.config.prefix === '') {
      vscode.window.showErrorMessage(
        'No prefix configured. Run "The Seed: Configure Project" first.'
      );
      return;
    }

    // Acquire operation lock ('package') — mutual exclusion with the other long operations
    const lockResult = acquireOperationLock('package');
    if (!lockResult.success) {
      vscode.window.showWarningMessage(lockRefusal('package', lockResult.heldBy ?? 'package'));
      return;
    }

    const outputDir = path.join(projectDir, 'dist');
    // Where the previous output waits while the tool runs, until it is dropped or put back
    let aside: string | null = null;
    // Set in finally: the tool's reports after the run has ended go nowhere
    let ended = false;
    let result: PackageResult | undefined;

    try {
      // Move the previous output aside within the project, so the tool gets a free
      // output directory and a refused or failed run can put the last result back
      if (fs.existsSync(outputDir)) {
        try {
          aside = fs.mkdtempSync(path.join(projectDir, '.dist-previous-'));
          fs.renameSync(outputDir, path.join(aside, 'dist'));
        } catch (err: unknown) {
          // dist/ is still in place: only the empty directory made for it is removed
          const madeAside = aside;
          aside = null;
          if (madeAside !== null) {
            try {
              fs.rmSync(madeAside, { recursive: true, force: true });
            } catch {
              // Nothing was moved into it; an empty directory left behind holds no output
            }
          }
          const reason = err instanceof Error ? err.message : String(err);
          const errorMessage = `could not move the previous output aside: ${reason}`;
          outputChannel.appendLine(`\n── Packaging failed: ${errorMessage} ──`);
          outputChannel.show(true);
          const failedStatus: PackageStatusPayload = {
            state: 'failed',
            errorMessage,
            filesCopied: 0,
            timestamp: new Date().toISOString(),
          };
          viewProvider.postMessage({ type: 'packageStatus', payload: failedStatus });
          vscode.window.showErrorMessage(`Packaging failed: ${errorMessage}`);
          return;
        }
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

      // The tool's lines go to the panel and each file it writes to the sidebar, for this run only
      const options: PackageRunOptions = {
        log: (line: string, level: ToolLogLevel) => {
          if (!ended) {
            outputChannel.appendLine(levelLine(line, level));
          }
        },
        onCopy: (event: PackageCopyEvent) => {
          if (ended) {
            return;
          }
          const currentStatus: PackageStatusPayload = {
            state: 'running',
            currentFile: `Copying ${event.name}...`,
            filesCopied: event.index,
            totalFiles: event.total,
            timestamp: new Date().toISOString(),
          };
          viewProvider.postMessage({ type: 'packageStatus', payload: currentStatus });
        },
      };

      try {
        // Wrap Package.run() in withProgress for notification-level spinner
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Packaging project...',
            cancellable: false,
          },
          async () => {
            const pkg = new tool.Package(config);
            result = await pkg.run(outputDir, [projectDir], options);
          }
        );

        const packaged = result!;
        if (packaged.success) {
          outputChannel.appendLine(`\n── Packaged ${packaged.fileCount} files into dist/ ──`);
        } else {
          outputChannel.appendLine('\n── Packaging failed ──');
          if (packaged.message) {
            outputChannel.appendLine(packaged.message);
          }
          outputChannel.show(true);
        }

        viewProvider.postMessage({
          type: 'packageStatus',
          payload: packageStatusFrom(packaged, new Date().toISOString()),
        });

        const notification = packageNotification(packaged);
        if (notification.kind === 'info') {
          vscode.window.showInformationMessage(notification.text);
        } else {
          vscode.window.showErrorMessage(notification.text);
        }

        // The new result replaces the previous output
        if (packaged.success && aside !== null) {
          const previous = aside;
          aside = null;
          try {
            fs.rmSync(previous, { recursive: true, force: true });
          } catch (err: unknown) {
            const reason = err instanceof Error ? err.message : String(err);
            outputChannel.appendLine(`[WARNING] Could not remove the previous output at ${previous}: ${reason}`);
          }
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);

        outputChannel.appendLine(`\n── Packaging failed: ${errorMessage} ──`);
        outputChannel.show(true);

        // Broadcast failed status
        const failedStatus: PackageStatusPayload = {
          state: 'failed',
          errorMessage,
          filesCopied: 0,
          timestamp: new Date().toISOString(),
        };
        viewProvider.postMessage({ type: 'packageStatus', payload: failedStatus });

        // Show error notification
        vscode.window.showErrorMessage(`Packaging failed: ${errorMessage}`);
      }
    } finally {
      ended = true;

      // Unless the run succeeded, drop what it left at dist/ and put the previous output back
      if (aside !== null) {
        try {
          fs.rmSync(outputDir, { recursive: true, force: true });
          fs.renameSync(path.join(aside, 'dist'), outputDir);
          fs.rmSync(aside, { recursive: true, force: true });
        } catch (err: unknown) {
          const reason = err instanceof Error ? err.message : String(err);
          const message = `Packaging failed: the previous output is in ${path.join(aside, 'dist')}: ${reason}`;
          outputChannel.appendLine(message);
          outputChannel.show(true);
          vscode.window.showErrorMessage(message);
        }
      }

      // Always release the operation lock
      releaseOperationLock();
    }
  };
}
