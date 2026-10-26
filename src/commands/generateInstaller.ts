import * as vscode from 'vscode';
import { acquireOperationLock, releaseOperationLock, lockRefusal } from '../operationLock';
import type { TheSeedViewProvider } from '../panels/TheSeedViewProvider';
import type { InstallerStatusPayload } from '../types/messages';
import type { ToolApi } from '../tool/toolApi';
import type { InstallerRunOptions, ToolLogLevel } from '@metaverse-systems/the-seed/types';
import { levelLine } from './packageProject';
import type { ToolHandler } from './wrapCommand';

/**
 * Creates the generateInstaller command handler.
 * Factory function returning a command handler compatible with wrapCommand.
 */
export function generateInstallerCommand(
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

    // Validate Config is loaded with a non-default prefix; the same configuration drives the installer
    const config = new tool.Config();
    config.loadConfig();
    if (!config.config.prefix || config.config.prefix === '') {
      vscode.window.showErrorMessage(
        'No prefix configured. Run "The Seed: Configure Project" first.'
      );
      return;
    }

    // Acquire operation lock ('installer') — mutual exclusion with the other long operations
    const lockResult = acquireOperationLock('installer');
    if (!lockResult.success) {
      vscode.window.showWarningMessage(lockRefusal('installer', lockResult.heldBy ?? 'installer'));
      return;
    }

    // Set in finally: the tool's reports after the run has ended go nowhere
    let ended = false;
    // Each line the tool reports goes to the panel and becomes the current step, for this run only;
    // the files its packaging step writes are shown by those lines alone
    const options: InstallerRunOptions = {
      log: (line: string, level: ToolLogLevel) => {
        if (ended) {
          return;
        }
        outputChannel.appendLine(levelLine(line, level));
        const stepStatus: InstallerStatusPayload = {
          state: 'running',
          currentStep: line,
          timestamp: new Date().toISOString(),
        };
        viewProvider.postMessage({ type: 'installerStatus', payload: stepStatus });
      },
    };

    try {
      // Broadcast running status
      const runningStatus: InstallerStatusPayload = {
        state: 'running',
        currentStep: 'Initializing...',
        timestamp: new Date().toISOString(),
      };
      viewProvider.postMessage({ type: 'installerStatus', payload: runningStatus });

      // Show output channel with timestamped separator header
      outputChannel.show(true);
      const timestamp = new Date().toISOString();
      outputChannel.appendLine(`\n${'═'.repeat(60)}`);
      outputChannel.appendLine(`Installer generation started at ${timestamp}`);
      outputChannel.appendLine(`Project: ${projectDir}`);
      outputChannel.appendLine(`${'═'.repeat(60)}\n`);

      // Wrap Installer.run() in withProgress for notification-level spinner
      let success = false;
      let failureMessage: string | undefined;
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Generating Windows installer...',
          cancellable: false,
        },
        async () => {
          const installer = new tool.Installer(config);
          const result = await installer.run(projectDir, options);
          success = result.ok;
          if (!result.ok) {
            failureMessage = result.message;
          }
        }
      );

      if (success) {
        outputChannel.appendLine('\n── Installer generation completed ──');

        // Broadcast completed status
        const completedStatus: InstallerStatusPayload = {
          state: 'completed',
          currentStep: 'Done',
          timestamp: new Date().toISOString(),
        };
        viewProvider.postMessage({ type: 'installerStatus', payload: completedStatus });

        vscode.window.showInformationMessage('Windows installer generated successfully.');
      } else {
        outputChannel.appendLine('\n── Installer generation failed ──');

        // Broadcast failed status
        const failedStatus: InstallerStatusPayload = {
          state: 'failed',
          errorMessage: failureMessage ?? 'Installer generation failed. Check output for details.',
          timestamp: new Date().toISOString(),
        };
        viewProvider.postMessage({ type: 'installerStatus', payload: failedStatus });

        vscode.window.showErrorMessage(failureMessage ?? 'Installer generation failed. Check the output channel for details.');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      outputChannel.appendLine(`\n── Installer generation failed: ${errorMessage} ──`);
      outputChannel.show(true);

      // Broadcast failed status
      const failedStatus: InstallerStatusPayload = {
        state: 'failed',
        errorMessage,
        timestamp: new Date().toISOString(),
      };
      viewProvider.postMessage({ type: 'installerStatus', payload: failedStatus });

      vscode.window.showErrorMessage(`Installer generation failed: ${errorMessage}`);
    } finally {
      ended = true;

      // Always release the operation lock
      releaseOperationLock();
    }
  };
}
