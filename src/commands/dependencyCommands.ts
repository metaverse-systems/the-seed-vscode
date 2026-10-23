import * as vscode from 'vscode';
import { runBuildSteps } from '../build/buildRunner';
import { acquireOperationLock, releaseOperationLock, getOperationLock, lockRefusal } from '../operationLock';
import { execSync } from 'child_process';
import type { ToolApi } from '../tool/toolApi';
import type { ToolHandler } from './wrapCommand';
import { updateDependencyStatus } from '../panels/messageHandler';
import type { DependencyStatusPayload, ExtensionToWebviewMessage } from '../types/messages';

/**
 * Check Dependencies command handler.
 * Validates config, shows QuickPick for target, checks libraries, displays notification.
 */
export function checkDependenciesCommand(
  outputChannel: vscode.OutputChannel
): ToolHandler {
  return async (_oc, tool) => {
    // Validate config exists (prefix configured)
    const config = new tool.Config();
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
    const ecsInstalled = tool.checkLibEcs(config, target.label);
    const seedInstalled = tool.checkLibTheSeed(config, target.label);

    const ecsStatus = ecsInstalled ? '✓' : '✗';
    const seedStatus = seedInstalled ? '✓' : '✗';

    vscode.window.showInformationMessage(
      `Dependencies (${target.label}): libecs-cpp ${ecsStatus} | libthe-seed ${seedStatus}`
    );
  };
}

type InstallTarget = 'native' | 'windows';

/** Where the install command posts its states; the sidebar's provider tracks them for replay. */
export interface InstallMessageSink {
  postMessage: (message: ExtensionToWebviewMessage) => void;
}

/** Asks for the target, or takes the one given; `null` when the pick is dismissed or the value is refused. */
async function chooseInstallTarget(given: unknown): Promise<InstallTarget | null> {
  if (given === 'native' || given === 'windows') {
    return given;
  }
  if (given !== undefined) {
    vscode.window.showErrorMessage(`Unknown dependency target: ${String(given)}.`);
    return null;
  }
  const picked = await vscode.window.showQuickPick(
    [
      { label: 'native', description: 'Install for the current platform' },
      { label: 'windows', description: 'Install for Windows cross-compilation' },
    ],
    { placeHolder: 'Select target platform' }
  );
  if (!picked) {
    return null;
  }
  return picked.label as InstallTarget;
}

/**
 * Install Dependencies command handler, used by the command palette and the sidebar.
 * Takes the target as its argument (asking for it when none is given), installs the
 * missing libraries with streaming output and posts each state to the sidebar.
 */
export function installDependenciesCommand(
  outputChannel: vscode.OutputChannel,
  viewProvider?: InstallMessageSink
): ToolHandler {
  const post = (message: ExtensionToWebviewMessage): void => {
    viewProvider?.postMessage(message);
  };

  return async (_oc, tool, given?: unknown) => {
    // Validate config exists
    const config = new tool.Config();
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

    // Check operation lock (mutual exclusion with the other long operations)
    const currentLock = getOperationLock();
    if (currentLock.active && currentLock.type) {
      vscode.window.showWarningMessage(lockRefusal('install', currentLock.type));
      return;
    }

    const target = await chooseInstallTarget(given);
    if (!target) {
      return;
    }

    // Check which libraries are missing
    const steps = tool.getInstallSteps(config, target);
    if (steps.length === 0) {
      vscode.window.showInformationMessage(
        `All dependencies are already installed for ${target}.`
      );
      return;
    }

    // Acquire operation lock
    const lockResult = acquireOperationLock('install');
    if (!lockResult.success) {
      vscode.window.showWarningMessage(lockRefusal('install', lockResult.heldBy ?? 'install'));
      return;
    }

    const abortController = lockResult.abortController!;

    try {
      post({ type: 'installDependenciesStarted' });

      // Show output channel with timestamped separator
      outputChannel.show(true);
      const timestamp = new Date().toISOString();
      outputChannel.appendLine(`\n${'═'.repeat(60)}`);
      outputChannel.appendLine(`Install dependencies (${target}) started at ${timestamp}`);
      outputChannel.appendLine(`${'═'.repeat(60)}\n`);

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Installing dependencies (${target})`,
          cancellable: true,
        },
        async (progress, token) => {
          // Bridge VS Code CancellationToken → AbortSignal
          const cancelListener = token.onCancellationRequested(() => {
            abortController.abort();
          });
          let currentStep = '';

          try {
            const result = await runBuildSteps(steps, {
              cwd: config.config.prefix,
              onStdout: (data) => outputChannel.append(data),
              onStderr: (data) => outputChannel.append(data),
              onStepStart: (step, index, total) => {
                currentStep = step.label;
                const increment = index === 0 ? 0 : Math.round(100 / total);
                progress.report({
                  message: `[${index + 1}/${total}] ${step.label}...`,
                  increment,
                });
                outputChannel.appendLine(`\n── Step ${index + 1}/${total}: ${step.label} ──`);
                post({
                  type: 'installDependenciesProgress',
                  payload: {
                    state: 'running',
                    target,
                    currentLibrary: step.label.split(' ')[1] || step.label,
                    currentStep: step.label,
                    stepIndex: index + 1,
                    totalSteps: total,
                    timestamp: new Date().toISOString(),
                  },
                });
              },
              signal: abortController.signal,
            });

            if (!result.success) {
              if (result.cancelledAtStep !== undefined) {
                vscode.window.showWarningMessage('Dependency installation cancelled.');
                outputChannel.appendLine('\n── Installation cancelled ──');
                post({
                  type: 'installDependenciesProgress',
                  payload: { state: 'cancelled', target, timestamp: new Date().toISOString() },
                });
              } else {
                const failure = `Dependency installation failed at ${currentStep}. Check output for details.`;
                vscode.window.showErrorMessage(failure);
                outputChannel.appendLine(`\n── Installation failed at ${currentStep}: a step exited with a non-zero status ──`);
                outputChannel.show(true);
                post({
                  type: 'installDependenciesProgress',
                  payload: { state: 'failed', target, errorMessage: failure, timestamp: new Date().toISOString() },
                });
              }
            } else {
              progress.report({ increment: 100, message: 'Complete' });
              vscode.window.showInformationMessage('Dependencies installed successfully.');
              outputChannel.appendLine('\n── Installation completed successfully ──');
              post({
                type: 'installDependenciesProgress',
                payload: { state: 'completed', target, timestamp: new Date().toISOString() },
              });
            }
          } finally {
            cancelListener.dispose();
          }
        }
      );

      // Check both libraries again so the sidebar shows what is installed now
      const status: DependencyStatusPayload = {
        target,
        libraries: [
          { name: 'libecs-cpp', installed: tool.checkLibEcs(config, target) },
          { name: 'libthe-seed', installed: tool.checkLibTheSeed(config, target) },
        ],
        checking: false,
        timestamp: new Date().toISOString(),
      };
      updateDependencyStatus(status);
      post({ type: 'dependencyStatus', payload: status });
    } finally {
      releaseOperationLock();
    }
  };
}
