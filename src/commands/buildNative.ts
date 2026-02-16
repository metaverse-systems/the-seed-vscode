import * as vscode from 'vscode';
import Config from '@metaverse-systems/the-seed/dist/Config';
import Build from '@metaverse-systems/the-seed/dist/Build';
import { runBuildSteps } from '../build/buildRunner';
import { detectBuildableProject } from '../build/projectDetector';
import type { TheSeedViewProvider } from '../panels/TheSeedViewProvider';
import type { BuildStatusPayload } from '../types/messages';
import { acquireOperationLock, releaseOperationLock, getOperationLock } from '../operationLock';

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
 * Creates the buildNative command handler.
 */
export function buildNativeCommand(
  outputChannel: vscode.OutputChannel,
  viewProvider: TheSeedViewProvider
): (oc: vscode.OutputChannel) => Promise<void> {
  return async () => {
    await executeBuild('native', true, outputChannel, viewProvider);
  };
}

/**
 * Creates the buildWindows command handler.
 */
export function buildWindowsCommand(
  outputChannel: vscode.OutputChannel,
  viewProvider: TheSeedViewProvider
): (oc: vscode.OutputChannel) => Promise<void> {
  return async () => {
    await executeBuild('windows', true, outputChannel, viewProvider);
  };
}

/**
 * Creates the buildIncremental command handler.
 */
export function buildIncrementalCommand(
  outputChannel: vscode.OutputChannel,
  viewProvider: TheSeedViewProvider
): (oc: vscode.OutputChannel) => Promise<void> {
  return async () => {
    await executeBuild('native', false, outputChannel, viewProvider);
  };
}

async function executeBuild(
  target: string,
  fullReconfigure: boolean,
  outputChannel: vscode.OutputChannel,
  viewProvider: TheSeedViewProvider
): Promise<void> {
  // Shared operation lock (mutual exclusion with install)
  const lockResult = acquireOperationLock('build');
  if (!lockResult.success) {
    const msg = lockResult.heldBy === 'install'
      ? 'Cannot build while an install operation is in progress.'
      : 'A build is already in progress.';
    vscode.window.showWarningMessage(msg);
    return;
  }
  const activeBuild = lockResult.abortController!;

  // Detect buildable project
  const activeEditor = vscode.window.activeTextEditor;
  let projectPath: string | undefined;

  if (activeEditor) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspaceRoot = workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
      const project = detectBuildableProject(activeEditor.document.uri.fsPath, workspaceRoot);
      if (project) {
        projectPath = project.path;
      }
    }
  }

  if (!projectPath) {
    // QuickPick fallback: try to find buildable projects in workspace
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      const uris = await vscode.workspace.findFiles('**/package.json', '**/node_modules/**', 50);
      const buildableProjects: { label: string; path: string }[] = [];

      for (const uri of uris) {
        try {
          const content = (await vscode.workspace.fs.readFile(uri)).toString();
          const pkg = JSON.parse(content);
          if (pkg.scripts?.build && typeof pkg.scripts.build === 'string' && pkg.scripts.build.includes('the-seed')) {
            const dir = vscode.Uri.joinPath(uri, '..').fsPath;
            buildableProjects.push({
              label: pkg.name || dir,
              path: dir,
            });
          }
        } catch {
          // Skip malformed packages
        }
      }

      if (buildableProjects.length === 1) {
        projectPath = buildableProjects[0].path;
      } else if (buildableProjects.length > 1) {
        const picked = await vscode.window.showQuickPick(
          buildableProjects.map(p => ({ label: p.label, detail: p.path })),
          { placeHolder: 'Select a project to build' }
        );
        if (picked) {
          projectPath = picked.detail;
        }
      }
    }
  }

  if (!projectPath) {
    vscode.window.showErrorMessage('No buildable project found. Open a file in a The Seed project.');
    return;
  }

  // Load config and get build steps
  const config = new Config();
  config.loadConfig();
  const build = new Build(config);
  const steps = build.getSteps(target, fullReconfigure);

  const buildType = fullReconfigure ? target : 'incremental';

  // Show output channel
  outputChannel.show(true);
  const timestamp = new Date().toISOString();
  outputChannel.appendLine(`\n${'═'.repeat(60)}`);
  outputChannel.appendLine(`Build ${buildType} started at ${timestamp}`);
  outputChannel.appendLine(`Project: ${projectPath}`);
  outputChannel.appendLine(`${'═'.repeat(60)}\n`);

  const broadcastStatus = (payload: BuildStatusPayload) => {
    viewProvider.postMessage({ type: 'buildStatus', payload });
  };

  try {
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
          broadcastStatus({
            state: 'running',
            target: buildType,
            currentStep: steps[0]?.label,
            stepIndex: 1,
            totalSteps: steps.length,
            timestamp: new Date().toISOString(),
          });

          const result = await runBuildSteps(steps, {
            cwd: projectPath!,
            onStdout: (data) => outputChannel.append(data),
            onStderr: (data) => outputChannel.append(data),
            onStepStart: (step, index, total) => {
              const increment = index === 0 ? 0 : Math.round(100 / total);
              progress.report({
                message: `[${index + 1}/${total}] ${step.label}...`,
                increment,
              });
              outputChannel.appendLine(`\n── Step ${index + 1}/${total}: ${step.label} ──`);

              broadcastStatus({
                state: 'running',
                target: buildType,
                currentStep: step.label,
                stepIndex: index + 1,
                totalSteps: total,
                timestamp: new Date().toISOString(),
              });
            },
            signal: activeBuild.signal,
          });

          if (!result.success) {
            if (result.cancelledAtStep !== undefined) {
              vscode.window.showWarningMessage('Build cancelled.');
              outputChannel.appendLine('\n── Build cancelled ──');
              broadcastStatus({
                state: 'cancelled',
                target: buildType,
                timestamp: new Date().toISOString(),
              });
            } else {
              vscode.window.showErrorMessage('Build failed. Check output for details.');
              outputChannel.appendLine('\n── Build failed ──');
              outputChannel.show(true);
              broadcastStatus({
                state: 'failed',
                target: buildType,
                errorMessage: 'Build step failed with non-zero exit code',
                timestamp: new Date().toISOString(),
              });
            }
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
