import * as vscode from 'vscode';
import { buildRecursive } from '@metaverse-systems/the-seed/dist/RecursiveBuild';
import type { BuildableProject, BuildStep } from '@metaverse-systems/the-seed/dist/types';
import { detectBuildableProject } from '../build/projectDetector';
import type { TheSeedViewProvider } from '../panels/TheSeedViewProvider';
import type { BuildStatusPayload, RecursiveBuildProgressPayload, RecursiveBuildCompletePayload } from '../types/messages';
import { acquireOperationLock, releaseOperationLock, getOperationLock } from '../operationLock';

export function getActiveRecursiveBuild(): AbortController | null {
  const lock = getOperationLock();
  if (lock.active && lock.type === 'build') {
    return lock.abortController;
  }
  return null;
}

export function cancelActiveRecursiveBuild(): boolean {
  const lock = getOperationLock();
  if (lock.active && lock.type === 'build' && lock.abortController) {
    lock.abortController.abort();
    return true;
  }
  return false;
}

/**
 * Creates the buildNativeRecursive command handler.
 */
export function buildNativeRecursiveCommand(
  outputChannel: vscode.OutputChannel,
  viewProvider: TheSeedViewProvider
): (oc: vscode.OutputChannel) => Promise<void> {
  return async () => {
    await executeRecursiveBuild('native', outputChannel, viewProvider);
  };
}

/**
 * Creates the buildWindowsRecursive command handler.
 */
export function buildWindowsRecursiveCommand(
  outputChannel: vscode.OutputChannel,
  viewProvider: TheSeedViewProvider
): (oc: vscode.OutputChannel) => Promise<void> {
  return async () => {
    await executeRecursiveBuild('windows', outputChannel, viewProvider);
  };
}

async function executeRecursiveBuild(
  target: 'native' | 'windows',
  outputChannel: vscode.OutputChannel,
  viewProvider: TheSeedViewProvider
): Promise<void> {
  // Prompt for build mode before acquiring lock
  const buildModeItems: vscode.QuickPickItem[] = [
    { label: 'Debug', description: 'Standard build with debug symbols' },
    { label: 'Release', description: 'Strip debug symbols for production' },
  ];
  const selectedMode = await vscode.window.showQuickPick(buildModeItems, {
    placeHolder: 'Select build mode',
  });
  if (!selectedMode) {
    return; // User dismissed — cancel build
  }
  const release = selectedMode.label === 'Release';

  // Acquire operation lock (mutual exclusion with other builds and install)
  const lockResult = acquireOperationLock('build');
  if (!lockResult.success) {
    const msg = lockResult.heldBy === 'install'
      ? 'Cannot build while an install operation is in progress.'
      : 'A build is already in progress.';
    vscode.window.showWarningMessage(msg);
    return;
  }
  const abortController = lockResult.abortController!;

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
    // QuickPick fallback
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
          { placeHolder: 'Select a project to build recursively' }
        );
        if (picked) {
          projectPath = picked.detail;
        }
      }
    }
  }

  if (!projectPath) {
    vscode.window.showErrorMessage('No buildable project found. Open a file in a The Seed project.');
    releaseOperationLock();
    return;
  }

  // Show output channel
  const buildLabel = release ? `${target} (release)` : target;
  outputChannel.show(true);
  const timestamp = new Date().toISOString();
  outputChannel.appendLine(`\n${'═'.repeat(60)}`);
  outputChannel.appendLine(`Recursive build ${buildLabel} started at ${timestamp}`);
  outputChannel.appendLine(`Project: ${projectPath}`);
  outputChannel.appendLine(`${'═'.repeat(60)}\n`);

  const broadcastBuildStatus = (payload: BuildStatusPayload) => {
    viewProvider.postMessage({ type: 'buildStatus', payload });
  };

  const broadcastRecursiveProgress = (payload: RecursiveBuildProgressPayload) => {
    viewProvider.postMessage({ type: 'recursiveBuildProgress', payload });
  };

  const broadcastRecursiveComplete = (payload: RecursiveBuildCompletePayload) => {
    viewProvider.postMessage({ type: 'recursiveBuildComplete', payload });
  };

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Recursive Build (${target})`,
        cancellable: true,
      },
      async (progress, token) => {
        // Bridge VS Code CancellationToken → AbortSignal
        const cancelListener = token.onCancellationRequested(() => {
          abortController.abort();
          cancelListener.dispose();
        });

        try {
          broadcastBuildStatus({
            state: 'running',
            target: `${target} (recursive)`,
            currentStep: 'Scanning dependencies...',
            timestamp: new Date().toISOString(),
          });

          progress.report({ message: 'Scanning dependencies...' });

          const result = await buildRecursive({
            target,
            fullReconfigure: true,
            projectDir: projectPath!,
            signal: abortController.signal,
            release,
            callbacks: {
              onProjectStart: (project: BuildableProject, index: number, total: number) => {
                const msg = `Building ${project.name} (${index + 1}/${total})`;
                progress.report({
                  message: msg,
                  increment: index === 0 ? 0 : Math.round(100 / total),
                });
                outputChannel.appendLine(`\n── [${index + 1}/${total}] ${project.name} ──`);

                broadcastBuildStatus({
                  state: 'running',
                  target: `${target} (recursive)`,
                  currentStep: `${project.name} (${index + 1}/${total})`,
                  stepIndex: index + 1,
                  totalSteps: total,
                  timestamp: new Date().toISOString(),
                });

                broadcastRecursiveProgress({
                  currentProject: project.name,
                  projectIndex: index,
                  totalProjects: total,
                  currentStep: 'starting',
                });
              },
              onStepComplete: (project: BuildableProject, step: BuildStep) => {
                outputChannel.appendLine(`  ${step.label}: done`);
              },
              onProjectComplete: (project: BuildableProject, index: number, total: number) => {
                outputChannel.appendLine(`  ✓ ${project.name} built successfully`);
              },
            },
          });

          if (result.cancelled) {
            vscode.window.showWarningMessage(
              `Recursive build cancelled. ${result.completed.length}/${result.completed.length + result.remaining.length + (result.failed ? 1 : 0)} complete.`
            );
            outputChannel.appendLine('\n── Recursive build cancelled ──');
            broadcastBuildStatus({
              state: 'cancelled',
              target: `${target} (recursive)`,
              timestamp: new Date().toISOString(),
            });
            broadcastRecursiveComplete({
              success: false,
              completedCount: result.completed.length,
              totalCount: result.completed.length + result.remaining.length + (result.failed ? 1 : 0),
              cancelled: true,
            });
          } else if (!result.success) {
            vscode.window.showErrorMessage(
              `Recursive build failed on ${result.failed?.name}. Check output for details.`
            );
            outputChannel.appendLine(`\n── Recursive build failed on ${result.failed?.name} ──`);
            if (result.failureOutput) {
              outputChannel.appendLine(result.failureOutput);
            }
            outputChannel.show(true);
            broadcastBuildStatus({
              state: 'failed',
              target: `${target} (recursive)`,
              errorMessage: `Build failed on ${result.failed?.name}`,
              timestamp: new Date().toISOString(),
            });
            broadcastRecursiveComplete({
              success: false,
              completedCount: result.completed.length,
              totalCount: result.completed.length + result.remaining.length + 1,
              failedProject: result.failed?.name,
            });
          } else {
            progress.report({ increment: 100, message: 'Complete' });
            vscode.window.showInformationMessage(
              `Recursive build complete: ${result.completed.length} projects built.`
            );
            outputChannel.appendLine(
              `\n── Recursive build complete: ${result.completed.length} projects built successfully ──`
            );
            broadcastBuildStatus({
              state: 'completed',
              target: `${target} (recursive)`,
              timestamp: new Date().toISOString(),
            });
            broadcastRecursiveComplete({
              success: true,
              completedCount: result.completed.length,
              totalCount: result.completed.length,
            });
          }
        } finally {
          cancelListener.dispose();
        }
      }
    );
  } finally {
    releaseOperationLock();
  }
}
