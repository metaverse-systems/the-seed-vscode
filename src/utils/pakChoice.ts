import * as vscode from 'vscode';
import type { ResourcePakStatusPayload } from '../types/messages';
import { detectResourcePak, findResourcePaks } from './detectResourcePak';

// The resource pak the user chose or created, kept for the sidebar's ResourcePaks section and the commands.
let remembered: string | undefined;

/** Keeps `packageDir` as the resource pak to work on, for as long as it stays a resource pak. */
export function rememberPak(packageDir: string): void {
  remembered = packageDir;
}

/** Forgets the remembered resource pak. */
export function forgetPak(): void {
  remembered = undefined;
}

/** The resource paks in the first open folder and its immediate subfolders. */
export function paksInOpenFolder(): ResourcePakStatusPayload[] {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? findResourcePaks(folders[0].uri.fsPath) : [];
}

/**
 * The resource pak to work on without asking: the remembered one, else the only one in the open folder.
 * Undefined when there is none or there are several to choose from.
 */
export function currentPak(): ResourcePakStatusPayload | undefined {
  if (remembered) {
    const pak = detectResourcePak(remembered);
    if (pak) {
      return pak;
    }
  }
  const found = paksInOpenFolder();
  return found.length === 1 ? found[0] : undefined;
}

/** What the ResourcePaks section shows: the pak in use, and how many paks the open folder holds to choose from. */
export function resourcePakStatus(): ResourcePakStatusPayload {
  const choices = paksInOpenFolder().length;
  const pak = currentPak();
  return pak ? { ...pak, choices } : { detected: false, choices };
}
