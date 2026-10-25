import * as vscode from 'vscode';
import type { ToolApi } from '../tool/toolApi';
import * as path from 'path';
import { currentPak, paksInOpenFolder, rememberPak } from './pakChoice';

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

const OTHER_FOLDER = 'Choose another folder...';

/**
 * Asks for a resource pak project: one of the resource paks found in the open folder when there are several
 * to choose from (or another folder), else a folder the tool accepts as a resource pak project. Resolves to
 * undefined when the user cancels or the chosen folder is refused (the refusal is shown).
 */
export async function pickPakProject(tool: ToolApi): Promise<string | undefined> {
  const found = paksInOpenFolder();
  if (found.length > 1) {
    const folders = vscode.workspace.workspaceFolders;
    const base = folders && folders.length > 0 ? folders[0].uri.fsPath : '';
    const items = found.map((pak) => ({
      label: pak.pakName || path.basename(pak.packageDir ?? ''),
      description: path.relative(base, pak.packageDir ?? '') || '.',
      packageDir: pak.packageDir,
    }));
    const picked = await vscode.window.showQuickPick(
      [...items, { label: OTHER_FOLDER, description: '', packageDir: undefined }],
      { placeHolder: 'Select the resource pak' }
    );
    if (!picked) {
      return undefined;
    }
    if (picked.packageDir) {
      return picked.packageDir;
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

/**
 * The resource pak project to work on: the one chosen or created before, else the only one in the open folder
 * (or in a folder directly inside it), else one the user picks. Resolves to undefined when the user cancels or
 * the chosen folder is refused (the refusal is shown).
 */
export async function choosePakProject(tool: ToolApi): Promise<string | undefined> {
  const known = currentPak();
  if (known?.packageDir) {
    return known.packageDir;
  }
  return pickPakProject(tool);
}

/** Asks for a resource pak project and remembers it for the sidebar and the commands. */
export async function chooseAndRememberPak(tool: ToolApi): Promise<string | undefined> {
  const chosen = await pickPakProject(tool);
  if (chosen) {
    rememberPak(chosen);
  }
  return chosen;
}
