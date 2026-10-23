import * as vscode from 'vscode';
import { detectBuildableProject } from './projectDetector';
import { acquireOperationLock, getOperationLock, lockRefusal } from '../operationLock';
import type { OperationType } from '../operationLock';

export const NO_BUILDABLE_PROJECT = 'No buildable project found. Open a file in a The Seed project.';

/** The refusal shown when a build is started while `holder` holds the operation lock. */
export function buildRefusal(holder: OperationType): string {
  return lockRefusal('build', holder);
}

export type BuildProjectChoice =
  | { kind: 'found'; path: string }
  | { kind: 'none' }
  | { kind: 'dismissed' };

/**
 * The project to build: the project of the active editor's file, else the only buildable
 * package.json in the workspace, else the one the user picks among several.
 */
export async function chooseBuildProject(placeHolder: string): Promise<BuildProjectChoice> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const activeEditor = vscode.window.activeTextEditor;
  const workspaceRoot = workspaceFolders?.[0]?.uri.fsPath;
  if (activeEditor && workspaceRoot) {
    const project = detectBuildableProject(activeEditor.document.uri.fsPath, workspaceRoot);
    if (project) {
      return { kind: 'found', path: project.path };
    }
  }

  if (!workspaceFolders || workspaceFolders.length === 0) {
    return { kind: 'none' };
  }

  const uris = await vscode.workspace.findFiles('**/package.json', '**/node_modules/**', 50);
  const buildableProjects: { label: string; path: string }[] = [];
  for (const uri of uris) {
    try {
      const content = (await vscode.workspace.fs.readFile(uri)).toString();
      const pkg = JSON.parse(content);
      if (typeof pkg.scripts?.build === 'string' && pkg.scripts.build.includes('the-seed')) {
        const dir = vscode.Uri.joinPath(uri, '..').fsPath;
        buildableProjects.push({ label: pkg.name || dir, path: dir });
      }
    } catch {
      // Skip unreadable or malformed packages
    }
  }

  if (buildableProjects.length === 0) {
    return { kind: 'none' };
  }
  if (buildableProjects.length === 1) {
    return { kind: 'found', path: buildableProjects[0].path };
  }

  const picked = await vscode.window.showQuickPick(
    buildableProjects.map((p) => ({ label: p.label, detail: p.path })),
    { placeHolder }
  );
  if (!picked || !picked.detail) {
    return { kind: 'dismissed' };
  }
  return { kind: 'found', path: picked.detail };
}

export interface BuildStartOptions {
  /** The description of the "Release" item in the build-mode choice. */
  releaseDescription: string;
  /** The placeholder of the project choice. */
  projectPlaceHolder: string;
}

export interface BuildStart {
  release: boolean;
  projectPath: string;
  abortController: AbortController;
}

/**
 * Everything before a build's first step. Resolves to a BuildStart only when the lock was taken for this
 * build; the caller then owns the lock and releases it in a finally. Resolves to undefined, with the lock
 * exactly as it was, on every other path.
 */
export async function startBuild(options: BuildStartOptions): Promise<BuildStart | undefined> {
  // Refuse before asking anything when another operation already holds the lock.
  const lock = getOperationLock();
  if (lock.active && lock.type) {
    vscode.window.showWarningMessage(buildRefusal(lock.type));
    return undefined;
  }

  const buildModeItems: vscode.QuickPickItem[] = [
    { label: 'Debug', description: 'Standard build with debug symbols' },
    { label: 'Release', description: options.releaseDescription },
  ];
  const selectedMode = await vscode.window.showQuickPick(buildModeItems, {
    placeHolder: 'Select build mode',
  });
  if (!selectedMode) {
    return undefined;
  }
  const release = selectedMode.label === 'Release';

  const choice = await chooseBuildProject(options.projectPlaceHolder);
  if (choice.kind === 'none') {
    vscode.window.showErrorMessage(NO_BUILDABLE_PROJECT);
    return undefined;
  }
  if (choice.kind === 'dismissed') {
    return undefined;
  }

  // The lock is taken only now, so a build that never starts leaves it as it was.
  const lockResult = acquireOperationLock('build');
  if (!lockResult.success || !lockResult.abortController) {
    vscode.window.showWarningMessage(buildRefusal(lockResult.heldBy ?? 'build'));
    return undefined;
  }

  return { release, projectPath: choice.path, abortController: lockResult.abortController };
}
