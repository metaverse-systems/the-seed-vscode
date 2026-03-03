import * as vscode from 'vscode';
import Config from '@metaverse-systems/the-seed/dist/Config';
import Installer from '@metaverse-systems/the-seed/dist/Installer';
import type { TheSeedViewProvider } from '../panels/TheSeedViewProvider';
import type { InstallerStatusPayload } from '../types/messages';

/**
 * Creates the generateInstaller command handler.
 * Factory function returning a command handler compatible with wrapCommand.
 */
export function generateInstallerCommand(
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

    // Monkey-patch console.log/console.error to capture output
    const originalLog = console.log;
    const originalError = console.error;

    try {
      console.log = (...args: unknown[]) => {
        const line = args.map(String).join(' ');
        outputChannel.appendLine(line);
        // Update running status with current step
        const stepStatus: InstallerStatusPayload = {
          state: 'running',
          currentStep: line,
          timestamp: new Date().toISOString(),
        };
        viewProvider.postMessage({ type: 'installerStatus', payload: stepStatus });
      };

      console.error = (...args: unknown[]) => {
        const line = args.map(String).join(' ');
        outputChannel.appendLine(`[ERROR] ${line}`);
      };

      // Wrap Installer.run() in withProgress for notification-level spinner
      let success = false;
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Generating Windows installer...',
          cancellable: false,
        },
        async () => {
          const config = new Config();
          config.loadConfig();
          const installer = new Installer(config);
          success = installer.run(projectDir);
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
          errorMessage: 'Installer generation failed. Check output for details.',
          timestamp: new Date().toISOString(),
        };
        viewProvider.postMessage({ type: 'installerStatus', payload: failedStatus });

        vscode.window.showErrorMessage('Installer generation failed. Check the output channel for details.');
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
      // Restore console methods
      console.log = originalLog;
      console.error = originalError;
    }
  };
}
