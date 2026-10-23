import * as vscode from 'vscode';
import type { ToolApi } from '../tool/toolApi';
import { detectResourcePak } from './detectResourcePak';

/** An error the tool raises to refuse a request: `name` is `ProjectError`, with a `code` and, often, a `hint`. */
export type ToolRefusal = Error & { code?: string; hint?: string };

/**
 * Whether `error` is a refusal by the tool. It is recognised by its shape (the name `ProjectError`),
 * because the class belongs to the installation the tool was loaded from.
 */
export function isToolRefusal(error: unknown): error is ToolRefusal {
  return error instanceof Error && error.name === 'ProjectError';
}

/** The text shown for a refusal by the tool: its message, then its hint when it has one. */
export function describeError(error: unknown): string {
  if (isToolRefusal(error) && typeof error.hint === 'string' && error.hint) {
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

/** Where a new project goes and whether the window switches to it afterwards. */
export interface CreationFolder {
  /** Where the new project is created: the first workspace folder, else the folder the user chose. */
  folder: string;
  /** True exactly when the window had zero workspace folders when the creation was asked for. */
  openAfterCreate: boolean;
}

/**
 * The folder a new project is created in and whether to open it afterwards. The new project is opened
 * only when no folder was open, so an open workspace (one folder or several) is never replaced.
 * Resolves to undefined when the folder chooser is dismissed; nothing should be created then.
 */
export async function chooseCreationFolder(): Promise<CreationFolder | undefined> {
  const openAfterCreate = (vscode.workspace.workspaceFolders?.length ?? 0) === 0;
  const folder = await chooseProjectFolder();
  if (!folder) {
    return undefined;
  }
  return { folder, openAfterCreate };
}

/** Switches the window to a newly created project. */
export function openCreatedProject(projectDir: string): Thenable<unknown> {
  return vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectDir));
}

/**
 * The resource pak project to work on: the one in the first workspace folder, else a folder the user chooses
 * and the tool accepts as a resource pak project. Resolves to undefined when the user cancels or the chosen
 * folder is refused (the refusal is shown).
 */
export async function choosePakProject(tool: ToolApi): Promise<string | undefined> {
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
    new tool.ResourcePak(new tool.Config()).readProject(chosen);
  } catch (error) {
    if (isToolRefusal(error)) {
      vscode.window.showErrorMessage(describeError(error));
      return undefined;
    }
    throw error;
  }
  return chosen;
}
