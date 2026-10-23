import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { testTool } from './tool';

/**
 * Makes vscode.workspace.workspaceFolders report the given folders (none for
 * an empty list) until the returned function is called.
 */
export function stubWorkspaceFolders(folders: string[]): () => void {
  const original = Object.getOwnPropertyDescriptor(vscode.workspace, 'workspaceFolders');
  const value = folders.length === 0
    ? undefined
    : folders.map((fsPath, index) => ({ uri: vscode.Uri.file(fsPath), name: path.basename(fsPath), index }));
  Object.defineProperty(vscode.workspace, 'workspaceFolders', {
    configurable: true,
    enumerable: true,
    get: () => value,
  });
  return (): void => {
    if (original) {
      Object.defineProperty(vscode.workspace, 'workspaceFolders', original);
    } else {
      delete (vscode.workspace as unknown as Record<string, unknown>).workspaceFolders;
    }
  };
}

/** Creates an empty scratch directory (removed by the caller). */
export function makeScratchDir(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `the-seed-ext-${label}-`));
}

/** Points the configured prefix at a fresh empty directory and returns it. */
export function useScratchPrefix(): string {
  const prefix = makeScratchDir('prefix');
  const config = new (testTool().Config)();
  config.loadConfig();
  config.config.prefix = prefix;
  config.saveConfig();
  return prefix;
}

/** Every file and directory under a root, as relative paths with mode and bytes (files only). */
export function readTree(root: string): Map<string, { mode: number; bytes: string | null }> {
  const tree = new Map<string, { mode: number; bytes: string | null }>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full);
      const mode = fs.lstatSync(full).mode & 0o7777;
      if (entry.isDirectory()) {
        tree.set(relative, { mode, bytes: null });
        walk(full);
      } else {
        tree.set(relative, { mode, bytes: fs.readFileSync(full).toString('base64') });
      }
    }
  };
  walk(root);
  return tree;
}
