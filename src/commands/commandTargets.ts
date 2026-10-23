import * as fs from 'fs';
import * as vscode from 'vscode';

/** The file-system path of a `file:` uri naming an existing regular file, or undefined for anything else. */
function regularFilePath(value: unknown): string | undefined {
  if (!(value instanceof vscode.Uri) || value.scheme !== 'file') {
    return undefined;
  }
  try {
    return fs.statSync(value.fsPath).isFile() ? value.fsPath : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The files a context-menu command was started on, or undefined for a palette start.
 *
 * The explorer passes the right-clicked file first and, as the second argument, every selected item in
 * the explorer's order. The selection is used only when it contains the right-clicked file; folders,
 * missing paths and non-`file:` items in it are left out, and a file listed twice is kept once at its
 * first position. Any other first argument (none, a folder, a missing path, another scheme, or something
 * that is not a uri) means the command was not started on a file.
 */
export function chosenFiles(args: readonly unknown[]): string[] | undefined {
  const first = regularFilePath(args[0]);
  if (first === undefined) {
    return undefined;
  }

  const selection = args[1];
  if (!Array.isArray(selection)) {
    return [first];
  }

  const containsFirst = selection.some((item) => item instanceof vscode.Uri && item.fsPath === first);
  if (!containsFirst) {
    return [first];
  }

  const files: string[] = [];
  for (const item of selection) {
    const file = regularFilePath(item);
    if (file !== undefined && !files.includes(file)) {
      files.push(file);
    }
  }
  return files;
}

/**
 * The files a file command acts on: the chosen files for a context-menu start, else the active editor's
 * file, else undefined (nothing to act on).
 */
export function commandTargets(args: readonly unknown[]): string[] | undefined {
  const chosen = chosenFiles(args);
  if (chosen) {
    return chosen;
  }
  const activeEditor = vscode.window.activeTextEditor;
  return activeEditor ? [activeEditor.document.uri.fsPath] : undefined;
}

/** The text shown when a file command has nothing to act on. */
export const NO_FILE_SELECTED = 'No file selected. Open a file or use the context menu.';
