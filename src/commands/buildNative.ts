import * as vscode from 'vscode';
import { runProjectBuild } from '../build/projectBuild';
import { describeBuildRejection, describeFailedStep } from '../build/buildFailure';
import { startBuild } from '../build/buildStart';
import type { BuildStart } from '../build/buildStart';
import { effectiveLimits, limitsLine, processorCount } from '../build/buildLimits';
import type { TheSeedViewProvider } from '../panels/TheSeedViewProvider';
import type { BuildStatusPayload } from '../types/messages';
import { releaseOperationLock, getOperationLock } from '../operationLock';
import type { ToolApi } from '../tool/toolApi';
import type { ToolHandler } from './wrapCommand';

export function getActiveBuild(): AbortController | null {
  const lock = getOperationLock();
  if (lock.active && lock.type === 'build') {
    return lock.abortController;
  }
  return null;
}

export function cancelActiveBuild(): boolean {
  const lock = getOperationLock();
  if (lock.active && lock.type === 'build' && lock.abortController) {
    lock.abortController.abort();
    return true;
  }
  return false;
}

/**
 * Writes what a starting build uses to the output panel: first each saved default that was invalid (also
 * shown once as a warning), then the build limits, with any reduction the tool makes.
 */
export function reportLimits(start: BuildStart, recursive: boolean, outputChannel: vscode.OutputChannel): void {
  for (const problem of start.settingProblems) {
    outputChannel.appendLine(problem.message);
    vscode.window.showWarningMessage(problem.message);
  }
  outputChannel.appendLine(limitsLine(effectiveLimits(start.limits, recursive, processorCount())));
}

/**
 * Creates the buildNative command handler.
 */
export function buildNativeCommand(
  outputChannel: vscode.OutputChannel,
  viewProvider: TheSeedViewProvider
): ToolHandler {
  return async (_oc, tool) => {
    await executeBuild('native', true, outputChannel, viewProvider, tool);
  };
}

/**
 * Creates the buildWindows command handler.
 */
export function buildWindowsCommand(
  outputChannel: vscode.OutputChannel,
  viewProvider: TheSeedViewProvider
): ToolHandler {
  return async (_oc, tool) => {
    await executeBuild('windows', true, outputChannel, viewProvider, tool);
  };
}

/**
 * Creates the buildIncremental command handler.
 */
export function buildIncrementalCommand(
  outputChannel: vscode.OutputChannel,
  viewProvider: TheSeedViewProvider
): ToolHandler {
  return async (_oc, tool) => {
    await executeBuild('native', false, outputChannel, viewProvider, tool);
  };
}

async function executeBuild(
  target: string,
  fullReconfigure: boolean,
  outputChannel: vscode.OutputChannel,
  viewProvider: TheSeedViewProvider,
  tool: ToolApi
): Promise<void> {
  const start = await startBuild({
    releaseDescription: 'Strip and sign the installed programs and libraries',
    projectPlaceHolder: 'Select a project to build',
    recursive: false,
  });
  if (!start) {
    return;
  }
  const { release, projectPath, abortController: activeBuild } = start;

  try {
    // Load config and get build steps
    const config = new tool.Config();
    config.loadConfig();
    const build = new tool.Build(config);

    const buildType = fullReconfigure ? target : 'incremental';
    const buildLabel = release ? `${buildType} (release)` : buildType;

    // Show output channel
    outputChannel.show(true);
    const timestamp = new Date().toISOString();
    outputChannel.appendLine(`\n${'═'.repeat(60)}`);
    outputChannel.appendLine(`Build ${buildLabel} started at ${timestamp}`);
    outputChannel.appendLine(`Project: ${projectPath}`);
    outputChannel.appendLine(`${'═'.repeat(60)}\n`);
    reportLimits(start, false, outputChannel);

    const broadcastStatus = (payload: BuildStatusPayload) => {
      viewProvider.postMessage({ type: 'buildStatus', payload });
    };

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Building ${buildType}`,
        cancellable: true,
      },
      async (progress, token) => {
        // Bridge VS Code CancellationToken → AbortSignal
        const cancelListener = token.onCancellationRequested(() => {
          activeBuild.abort();
          cancelListener.dispose();
        });

        try {
          let result;
          try {
            result = await runProjectBuild(
              build,
              {
                projectDir: projectPath,
                target: fullReconfigure ? (target as 'native' | 'windows') : undefined,
                release,
                configDir: config.configDir,
                signal: activeBuild.signal,
                jobs: start.limits.jobs?.value,
              },
              {
                append: (text) => outputChannel.append(text),
                appendLine: (text) => outputChannel.appendLine(text),
                stepStarted: (label, index, total) => {
                  const increment = index === 0 ? 0 : Math.round(100 / total);
                  progress.report({
                    message: `[${index + 1}/${total}] ${label}...`,
                    increment,
                  });
                  outputChannel.appendLine(`\n── Step ${index + 1}/${total}: ${label} ──`);

                  broadcastStatus({
                    state: 'running',
                    target: buildType,
                    currentStep: label,
                    stepIndex: index + 1,
                    totalSteps: total,
                    timestamp: new Date().toISOString(),
                  });
                },
              }
            );
          } catch (err: unknown) {
            const failure = describeBuildRejection(err, buildType, new Date().toISOString());
            vscode.window.showErrorMessage(failure.notification);
            outputChannel.appendLine(failure.outputLine);
            outputChannel.show(true);
            broadcastStatus(failure.status);
            return;
          }

          if (result.status === 'cancelled') {
            const cancelledText = result.installed ? 'Build cancelled after installing.' : 'Build cancelled.';
            vscode.window.showWarningMessage(cancelledText);
            outputChannel.appendLine(`\n── ${cancelledText} ──`);
            broadcastStatus({
              state: 'cancelled',
              target: buildType,
              timestamp: new Date().toISOString(),
            });
            return;
          }

          if (result.status === 'failed') {
            const message = describeFailedStep(result.step, result.message);
            vscode.window.showErrorMessage(`${message}.`);
            outputChannel.appendLine(`\n── ${message}. ──`);
            outputChannel.show(true);
            broadcastStatus({
              state: 'failed',
              target: buildType,
              errorMessage: message,
              timestamp: new Date().toISOString(),
            });
            return;
          }

          progress.report({ increment: 100, message: 'Complete' });
          vscode.window.showInformationMessage('Build succeeded.');
          outputChannel.appendLine('\n── Build completed successfully ──');
          broadcastStatus({
            state: 'completed',
            target: buildType,
            timestamp: new Date().toISOString(),
          });
        } finally {
          cancelListener.dispose();
        }
      }
    );
  } finally {
    releaseOperationLock();
  }
}
