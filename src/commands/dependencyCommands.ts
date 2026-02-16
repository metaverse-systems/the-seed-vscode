import * as vscode from 'vscode';
import Config from '@metaverse-systems/the-seed/dist/Config';
import { checkLibEcs, checkLibTheSeed, getInstallSteps } from '@metaverse-systems/the-seed/dist/Dependencies';
import { runBuildSteps } from '../build/buildRunner';
import { acquireOperationLock, releaseOperationLock, getOperationLock } from '../operationLock';
import { execSync } from 'child_process';

/**
 * Check Dependencies command handler.
 * Validates config, shows QuickPick for target, checks libraries, displays notification.
 */
export function checkDependenciesCommand(
  outputChannel: vscode.OutputChannel
): (oc: vscode.OutputChannel) => Promise<void> {
  return async () => {
    // Validate config exists (prefix configured)
    const config = new Config();
    config.loadConfig();

    if (!config.config.prefix || config.config.prefix === '') {
      vscode.window.showErrorMessage(
        'No prefix configured. Run "The Seed: Configure Project" first.'
      );
      return;
    }

    // Detect missing pkg-config
    try {
      execSync('which pkg-config', { stdio: 'pipe' });
    } catch {
      vscode.window.showErrorMessage(
        'pkg-config not found. Please install pkg-config to check dependencies.'
      );
      return;
    }

    // Show QuickPick for target
    const target = await vscode.window.showQuickPick(
      [
        { label: 'native', description: 'Build for the current platform' },
        { label: 'windows', description: 'Cross-compile for Windows' },
      ],
      { placeHolder: 'Select target platform' }
    );

    if (!target) {
      return; // User cancelled
    }

    // Check libraries synchronously
    const ecsInstalled = checkLibEcs(config, target.label);
    const seedInstalled = checkLibTheSeed(config, target.label);

    const ecsStatus = ecsInstalled ? '✓' : '✗';
    const seedStatus = seedInstalled ? '✓' : '✗';

    vscode.window.showInformationMessage(
      `Dependencies (${target.label}): libecs-cpp ${ecsStatus} | libthe-seed ${seedStatus}`
    );
  };
}

/**
 * Install Dependencies command handler.
 * Validates config, checks lock, shows QuickPick, installs missing libraries with streaming output.
 */
export function installDependenciesCommand(
  outputChannel: vscode.OutputChannel,
  viewProvider?: { postMessage: (msg: any) => void }
): (oc: vscode.OutputChannel) => Promise<void> {
  return async () => {
    // Validate config exists
    const config = new Config();
    config.loadConfig();

    if (!config.config.prefix || config.config.prefix === '') {
      vscode.window.showErrorMessage(
        'No prefix configured. Run "The Seed: Configure Project" first.'
      );
      return;
    }

    // Detect missing git
    try {
      execSync('which git', { stdio: 'pipe' });
    } catch {
      vscode.window.showErrorMessage(
        'git not found. Please install git to install dependencies.'
      );
      return;
    }

    // Check operation lock (mutual exclusion with builds)
    const currentLock = getOperationLock();
    if (currentLock.active) {
      const opType = currentLock.type === 'build' ? 'build' : 'install';
      vscode.window.showWarningMessage(
        `Cannot install dependencies while a ${opType} operation is in progress.`
      );
      return;
    }

    // Show QuickPick for target
    const target = await vscode.window.showQuickPick(
      [
        { label: 'native', description: 'Install for the current platform' },
        { label: 'windows', description: 'Install for Windows cross-compilation' },
      ],
      { placeHolder: 'Select target platform' }
    );

    if (!target) {
      return; // User cancelled
    }

    // Check which libraries are missing
    const steps = getInstallSteps(config, target.label);
    if (steps.length === 0) {
      vscode.window.showInformationMessage(
        `All dependencies are already installed for ${target.label}.`
      );
      return;
    }

    // Acquire operation lock
    const lockResult = acquireOperationLock('install');
    if (!lockResult.success) {
      const opType = lockResult.heldBy === 'build' ? 'build' : 'install';
      vscode.window.showWarningMessage(
        `Cannot install dependencies while a ${opType} operation is in progress.`
      );
      return;
    }

    const abortController = lockResult.abortController!;

    // Show output channel with timestamped separator
    outputChannel.show(true);
    const timestamp = new Date().toISOString();
    outputChannel.appendLine(`\n${'═'.repeat(60)}`);
    outputChannel.appendLine(`Install dependencies (${target.label}) started at ${timestamp}`);
    outputChannel.appendLine(`${'═'.repeat(60)}\n`);

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Installing dependencies (${target.label})`,
          cancellable: true,
        },
        async (progress, token) => {
          // Bridge VS Code CancellationToken → AbortSignal
          const cancelListener = token.onCancellationRequested(() => {
            abortController.abort();
            cancelListener.dispose();
          });

          try {
            const result = await runBuildSteps(steps, {
              cwd: config.config.prefix,
              onStdout: (data) => outputChannel.append(data),
              onStderr: (data) => outputChannel.append(data),
              onStepStart: (step, index, total) => {
                const increment = index === 0 ? 0 : Math.round(100 / total);
                progress.report({
                  message: `[${index + 1}/${total}] ${step.label}...`,
                  increment,
                });
                outputChannel.appendLine(`\n── Step ${index + 1}/${total}: ${step.label} ──`);
              },
              signal: abortController.signal,
            });

            if (!result.success) {
              if (result.cancelledAtStep !== undefined) {
                vscode.window.showWarningMessage('Dependency installation cancelled.');
                outputChannel.appendLine('\n── Installation cancelled ──');
              } else {
                vscode.window.showErrorMessage(
                  'Dependency installation failed. Check output for details.'
                );
                outputChannel.appendLine('\n── Installation failed ──');
                outputChannel.show(true);
              }
              return;
            }

            progress.report({ increment: 100, message: 'Complete' });
            vscode.window.showInformationMessage('Dependencies installed successfully.');
            outputChannel.appendLine('\n── Installation completed successfully ──');
          } finally {
            cancelListener.dispose();
          }
        }
      );
    } finally {
      releaseOperationLock();
    }
  };
}
