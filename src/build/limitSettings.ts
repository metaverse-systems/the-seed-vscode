// The workspace defaults for the build limits, kept in the editor's settings
// (the-seed.build.parallel and the-seed.build.jobs). Only the workspace's own
// values are used, so a value in the user's settings applies nowhere.
import * as vscode from 'vscode';
import { parseLimitSetting, SETTING_NAMES } from './buildLimits';
import type { BuildLimitRequest, LimitName } from './buildLimits';

/** A saved value that is not a positive whole number. The build uses the standard behaviour for it. */
export interface SettingProblem {
  setting: 'the-seed.build.parallel' | 'the-seed.build.jobs';
  value: unknown;
  message: string;
}

export interface WorkspaceDefaults {
  limits: BuildLimitRequest;
  problems: SettingProblem[];
}

/** The limits a build of this kind reads: the project count applies to recursive builds only. */
export function limitNames(recursive: boolean): LimitName[] {
  return recursive ? ['parallel', 'jobs'] : ['jobs'];
}

/** The workspace's saved defaults, read once when a build starts. */
export function readWorkspaceDefaults(recursive: boolean): WorkspaceDefaults {
  const configuration = vscode.workspace.getConfiguration('the-seed.build');
  const limits: BuildLimitRequest = {};
  const problems: SettingProblem[] = [];
  for (const name of limitNames(recursive)) {
    const raw = configuration.inspect<unknown>(name)?.workspaceValue;
    const parsed = parseLimitSetting(raw, name);
    if (!parsed.ok) {
      problems.push({ setting: SETTING_NAMES[name], value: raw, message: parsed.message });
    } else if (parsed.value !== undefined) {
      limits[name] = { value: parsed.value, source: 'workspace default' };
    }
  }
  return { limits, problems };
}

/** Whether there is a workspace to save defaults in. */
export function canSaveWorkspaceDefaults(): boolean {
  return (vscode.workspace.workspaceFolders?.length ?? 0) > 0 || vscode.workspace.workspaceFile !== undefined;
}

/** Saves each given limit as the workspace default; a key given as undefined removes that default. */
export async function saveWorkspaceDefaults(values: Partial<Record<LimitName, number | undefined>>): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('the-seed.build');
  for (const name of Object.keys(values) as LimitName[]) {
    await configuration.update(name, values[name], vscode.ConfigurationTarget.Workspace);
  }
}
