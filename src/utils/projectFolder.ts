import * as vscode from 'vscode';
import ResourcePak from '@metaverse-systems/the-seed/dist/ResourcePak';
import Config from '@metaverse-systems/the-seed/dist/Config';
import { ProjectError } from '@metaverse-systems/the-seed/dist/ProjectError';
import { detectResourcePak } from './detectResourcePak';

/** The text shown for a refusal by the tool: its message, then its hint when it has one. */
export function describeError(error: unknown): string {
  if (error instanceof ProjectError && error.hint) {
    return `${error.message} ${error.hint}`;
  }
  return error instanceof Error ? error.message : String(error);
}

async function askForFolder(openLabel: string): Promise<string | undefined> {
  const chosen = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel,
  });
  if (!chosen || chosen.length === 0) {
    return undefined;
  }
  return chosen[0].fsPath;
}

/**
 * The folder a new project is created in: the first workspace folder, else a folder the user chooses.
 * Resolves to undefined when the user cancels; nothing should be created then.
 */
export async function chooseProjectFolder(): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return folders[0].uri.fsPath;
  }
  return askForFolder('Create Here');
}

/**
 * The resource pak project to work on: the one in the first workspace folder, else a folder the user chooses
 * and the tool accepts as a resource pak project. Resolves to undefined when the user cancels or the chosen
 * folder is refused (the refusal is shown).
 */
export async function choosePakProject(): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    const detected = detectResourcePak(folders[0].uri.fsPath);
    if (detected) {
      return detected.packageDir;
    }
  }

  const chosen = await askForFolder('Select Resource Pak');
  if (!chosen) {
    return undefined;
  }
  try {
    new ResourcePak(new Config()).readProject(chosen);
  } catch (error) {
    if (error instanceof ProjectError) {
      vscode.window.showErrorMessage(describeError(error));
      return undefined;
    }
    throw error;
  }
  return chosen;
}
