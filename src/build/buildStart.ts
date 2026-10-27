import * as vscode from 'vscode';
import { detectBuildableProject } from './projectDetector';
import { acquireOperationLock, getOperationLock, lockRefusal } from '../operationLock';
import type { OperationType } from '../operationLock';
import { limitLabel, parseLimitText, SETTING_NAMES } from './buildLimits';
import type { BuildLimitRequest, LimitName, RequestedLimit } from './buildLimits';
import { canSaveWorkspaceDefaults, limitNames, readWorkspaceDefaults, saveWorkspaceDefaults } from './limitSettings';
import type { SettingProblem } from './limitSettings';

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
  /** Whether the build is recursive, so the project count applies. */
  recursive: boolean;
}

export interface BuildStart {
  release: boolean;
  projectPath: string;
  abortController: AbortController;
  /** The limits asked for, before the tool reduces anything. */
  limits: BuildLimitRequest;
  /** Saved defaults that were not used because they are invalid; the caller reports them. */
  settingProblems: SettingProblem[];
}

export const LIMITS_ITEM_PREFIX = 'Build limits: ';
export const THIS_BUILD_ONLY = 'Use for this build only';
export const SAVE_AS_DEFAULT = 'Use and save as workspace default';

const PROMPTS: Record<LimitName, string> = {
  parallel: 'Most projects to build at once. Leave empty for the workspace default, or one at a time.',
  jobs: 'Most compile jobs at once. Leave empty for the workspace default, or the processor count.',
};

/** The limits in the build-mode choice, in a few words. */
export function limitsSummary(limits: BuildLimitRequest, recursive: boolean): string {
  const jobs = limits.jobs
    ? `${limits.jobs.value} compile ${limits.jobs.value === 1 ? 'job' : 'jobs'}`
    : 'compile jobs: processor count';
  if (!recursive) {
    return jobs;
  }
  const parallel = limits.parallel && limits.parallel.value > 1
    ? `up to ${limits.parallel.value} projects at once`
    : '1 project at a time';
  return `${parallel}, ${jobs}`;
}

/**
 * Asks for the limits of one build, each box filled with the value in effect, then whether to save them
 * as the workspace defaults. An empty box means the workspace default, or the standard behaviour (when
 * saving, it removes the default). Resolves to undefined when any prompt is dismissed; nothing is saved then.
 */
async function chooseLimits(
  current: BuildLimitRequest,
  defaults: BuildLimitRequest,
  recursive: boolean
): Promise<{ limits: BuildLimitRequest; saved: boolean } | undefined> {
  const entered: Partial<Record<LimitName, number | undefined>> = {};
  for (const name of limitNames(recursive)) {
    const text = await vscode.window.showInputBox({
      title: `Build limits: ${limitLabel(name)}`,
      prompt: PROMPTS[name],
      value: current[name] ? String(current[name]!.value) : '',
      validateInput: (value) => {
        if (value.trim() === '') {
          return undefined;
        }
        const parsed = parseLimitText(value, name);
        return parsed.ok ? undefined : parsed.message;
      },
    });
    if (text === undefined) {
      return undefined;
    }
    if (text.trim() === '') {
      entered[name] = undefined;
    } else {
      const parsed = parseLimitText(text, name);
      if (!parsed.ok) {
        // The box does not accept invalid text; an editor that skips the check still gets nothing invalid
        vscode.window.showErrorMessage(parsed.message);
        return undefined;
      }
      entered[name] = parsed.value;
    }
  }

  const choices = [THIS_BUILD_ONLY, ...(canSaveWorkspaceDefaults() ? [SAVE_AS_DEFAULT] : [])];
  const use = await vscode.window.showQuickPick(choices, { placeHolder: 'Use these build limits' });
  if (use === undefined) {
    return undefined;
  }

  const next: BuildLimitRequest = {};
  if (use === SAVE_AS_DEFAULT) {
    await saveWorkspaceDefaults(entered);
    for (const name of limitNames(recursive)) {
      const value = entered[name];
      if (value !== undefined) {
        next[name] = { value, source: 'workspace default' };
      }
    }
    return { limits: next, saved: true };
  }
  for (const name of limitNames(recursive)) {
    const value = entered[name];
    const limit: RequestedLimit | undefined = value === undefined
      ? defaults[name]
      : { value, source: current[name]?.value === value ? current[name]!.source : 'this build' };
    if (limit) {
      next[name] = limit;
    }
  }
  return { limits: next, saved: false };
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

  // Read once, so a later change to the settings does not reach this build
  const defaults = readWorkspaceDefaults(options.recursive);
  let limits: BuildLimitRequest = { ...defaults.limits };
  const replaced = new Set<string>();

  let release: boolean | undefined;
  while (release === undefined) {
    const buildModeItems: vscode.QuickPickItem[] = [
      { label: 'Debug', description: 'Standard build with debug symbols' },
      { label: 'Release', description: options.releaseDescription },
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      { label: `${LIMITS_ITEM_PREFIX}${limitsSummary(limits, options.recursive)}`, detail: 'Change for this build…' },
    ];
    const selectedMode = await vscode.window.showQuickPick(buildModeItems, {
      placeHolder: 'Select build mode',
    });
    if (!selectedMode) {
      return undefined;
    }
    if (selectedMode.label.startsWith(LIMITS_ITEM_PREFIX)) {
      const chosen = await chooseLimits(limits, defaults.limits, options.recursive);
      if (!chosen) {
        return undefined;
      }
      limits = chosen.limits;
      for (const name of limitNames(options.recursive)) {
        if (chosen.saved || limits[name]?.source === 'this build') {
          replaced.add(SETTING_NAMES[name]);
        }
      }
      continue;
    }
    release = selectedMode.label === 'Release';
  }

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

  // An invalid saved value that this build replaced, or that was just saved over, is not reported
  const settingProblems = defaults.problems.filter((problem) => !replaced.has(problem.setting));

  return {
    release,
    projectPath: choice.path,
    abortController: lockResult.abortController,
    limits,
    settingProblems,
  };
}
