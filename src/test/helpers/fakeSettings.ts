import * as sinon from 'sinon';
import * as vscode from 'vscode';

export interface FakeBuildSettings {
  /** Values at workspace level, by key ('parallel', 'jobs'). */
  workspace: Record<string, unknown>;
  /** Values at user level, by key. */
  user: Record<string, unknown>;
  /** Each update: key, value and target. */
  updates: { key: string; value: unknown; target: vscode.ConfigurationTarget | boolean | null | undefined }[];
}

/**
 * Stands in for the 'the-seed.build' settings until sinon is restored. The editor the tests run in has no
 * workspace open, so workspace-level values cannot be written for real; this keeps both levels in memory.
 * Every other section is read from the editor as usual.
 */
export function fakeBuildSettings(initial: { workspace?: Record<string, unknown>; user?: Record<string, unknown> } = {}): FakeBuildSettings {
  const settings: FakeBuildSettings = {
    workspace: { ...(initial.workspace ?? {}) },
    user: { ...(initial.user ?? {}) },
    updates: [],
  };
  const original = vscode.workspace.getConfiguration.bind(vscode.workspace);
  sinon.stub(vscode.workspace, 'getConfiguration').callsFake(((section?: string, scope?: vscode.ConfigurationScope) => {
    if (section !== 'the-seed.build') {
      return original(section, scope);
    }
    const fake = {
      get: (key: string, fallback?: unknown) => (key in settings.workspace ? settings.workspace[key] : key in settings.user ? settings.user[key] : fallback),
      has: (key: string) => key in settings.workspace || key in settings.user,
      inspect: (key: string) => ({
        key: `the-seed.build.${key}`,
        defaultValue: null,
        globalValue: settings.user[key],
        workspaceValue: settings.workspace[key],
      }),
      update: async (key: string, value: unknown, target?: vscode.ConfigurationTarget | boolean | null) => {
        settings.updates.push({ key, value, target });
        const level = target === vscode.ConfigurationTarget.Workspace ? settings.workspace : settings.user;
        if (value === undefined) {
          delete level[key];
        } else {
          level[key] = value;
        }
      },
    };
    return fake as unknown as vscode.WorkspaceConfiguration;
  }) as never);
  return settings;
}
