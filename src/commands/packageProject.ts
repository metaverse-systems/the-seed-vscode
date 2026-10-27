import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { acquireOperationLock, getOperationLock, releaseOperationLock, lockRefusal } from '../operationLock';
import type { TheSeedViewProvider } from '../panels/TheSeedViewProvider';
import type { PackageStatusPayload } from '../types/messages';
import { packageStatusFrom, packageNotification } from '../build/packageOutcome';
import type { PackageCopyEvent, PackageResult, PackageRunOptions, ToolLogLevel } from '@metaverse-systems/the-seed/types';
import type { ToolApi } from '../tool/toolApi';
import type { ToolHandler } from './wrapCommand';
import { canonical, outputConflict } from '../utils/pathSafety';

export const NO_PROJECT_CHOSEN = 'Choose at least one project directory to package.';
export const REPLACE_CONTENTS = 'Replace contents';

/** The warning shown before packaging into a directory that already holds files. */
export function replaceWarning(outputDir: string): string {
  return `"${outputDir}" already holds files. Packaging will replace everything in it with the new result; if packaging fails, the current contents are put back.`;
}

/** The workspace folder the dialogs open in: the active file's, else the first. */
function dialogFolder(folders: readonly vscode.WorkspaceFolder[]): vscode.Uri {
  const active = vscode.window.activeTextEditor?.document.uri;
  const folder = active ? vscode.workspace.getWorkspaceFolder(active) : undefined;
  return (folder ?? folders[0]).uri;
}

/** The chosen directories, canonical and each once. */
function uniqueProjects(chosen: readonly vscode.Uri[]): string[] {
  const seen = new Set<string>();
  const projects: string[] = [];
  for (const uri of chosen) {
    const dir = canonical(uri.fsPath);
    const key = process.platform === 'win32' ? dir.toLowerCase() : dir;
    if (!seen.has(key)) {
      seen.add(key);
      projects.push(dir);
    }
  }
  return projects;
}

/** Why the tool cannot package `dir`, or null when it can find what the project builds. */
function notAProject(pkg: InstanceType<ToolApi['Package']>, dir: string): string | null {
  const reasons: string[] = [];
  if (pkg.parseMakefileAm(dir, (line: string) => reasons.push(line.replace(/^Error:\s*/, '')))) {
    return null;
  }
  return `"${dir}" is not a buildable project: ${reasons.join(' ') || 'src/Makefile.am names no program or library'}`;
}

/** A line the tool reported, as the output panel shows it: warnings and errors carry their level. */
export function levelLine(line: string, level: ToolLogLevel): string {
  if (level === 'warn') {
    return `[WARNING] ${line}`;
  }
  if (level === 'error') {
    return `[ERROR] ${line}`;
  }
  return line;
}

/**
 * Creates the packageProject command handler.
 * Factory function returning a command handler compatible with wrapCommand.
 */
export function packageProjectCommand(
  outputChannel: vscode.OutputChannel,
  viewProvider: TheSeedViewProvider
): ToolHandler {
  return async (_oc, tool) => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage('No workspace folder open. Open a project folder first.');
      return;
    }

    // Validate Config is loaded with a non-default prefix
    const config = new tool.Config();
    config.loadConfig();
    if (!config.config.prefix || config.config.prefix === '') {
      vscode.window.showErrorMessage(
        'No prefix configured. Run "The Seed: Configure Project" first.'
      );
      return;
    }

    // Refuse before asking anything while another long operation runs
    const held = getOperationLock();
    if (held.active && held.type) {
      vscode.window.showWarningMessage(lockRefusal('package', held.type));
      return;
    }

    // Packaging signs what it copies, so a missing native component is refused before any prompt,
    // with the same message a run gives
    try {
      tool.requireNativeComponent();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      outputChannel.appendLine(`\n── Packaging failed: ${errorMessage} ──`);
      outputChannel.show(true);
      vscode.window.showErrorMessage(`Packaging failed: ${errorMessage}`);
      return;
    }

    // Nothing below writes, moves or deletes anything until the lock is taken
    const defaultUri = dialogFolder(workspaceFolders);
    const chosen = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: true,
      defaultUri,
      openLabel: 'Package these projects',
      title: 'Choose the projects to package',
    });
    if (chosen === undefined) {
      return;
    }
    if (chosen.length === 0) {
      vscode.window.showErrorMessage(NO_PROJECT_CHOSEN);
      return;
    }
    const projects = uniqueProjects(chosen);
    const pkg = new tool.Package(config);
    for (const dir of projects) {
      const refusal = notAProject(pkg, dir);
      if (refusal) {
        vscode.window.showErrorMessage(refusal);
        return;
      }
    }

    const outputChoice = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri,
      openLabel: 'Package into this directory',
      title: 'Choose the output directory',
    });
    if (!outputChoice || outputChoice.length === 0) {
      return;
    }
    const outputDir = canonical(outputChoice[0].fsPath);
    const conflict = outputConflict(outputDir, projects, workspaceFolders.map((folder) => canonical(folder.uri.fsPath)));
    if (conflict) {
      vscode.window.showErrorMessage(conflict);
      return;
    }

    // An existing directory with files in it is replaced only when the user says so
    if (fs.existsSync(outputDir) && fs.readdirSync(outputDir).length > 0) {
      const answer = await vscode.window.showWarningMessage(replaceWarning(outputDir), { modal: true }, REPLACE_CONTENTS);
      if (answer !== REPLACE_CONTENTS) {
        return;
      }
    }

    // Acquire operation lock ('package') — mutual exclusion with the other long operations
    const lockResult = acquireOperationLock('package');
    if (!lockResult.success) {
      vscode.window.showWarningMessage(lockRefusal('package', lockResult.heldBy ?? 'package'));
      return;
    }

    // Where the previous output waits while the tool runs, until it is dropped or put back
    let aside: string | null = null;
    const asideName = path.basename(outputDir);
    // Whether the run produced a new result to keep
    let succeeded = false;
    // Whether there was no output directory before the run, so nothing of the user's can be at its path
    let absentBefore = false;
    // Set in finally: the tool's reports after the run has ended go nowhere
    let ended = false;
    let result: PackageResult | undefined;

    try {
      // Move the previous output aside next to it, on the same file system, so the tool gets
      // a free output directory and a refused or failed run can put the last result back
      absentBefore = !fs.existsSync(outputDir);
      if (!absentBefore) {
        try {
          aside = fs.mkdtempSync(path.join(path.dirname(outputDir), `.${asideName}-previous-`));
          fs.renameSync(outputDir, path.join(aside, asideName));
        } catch (err: unknown) {
          // The output is still in place: only the empty directory made for it is removed
          const madeAside = aside;
          aside = null;
          if (madeAside !== null) {
            try {
              fs.rmSync(madeAside, { recursive: true, force: true });
            } catch {
              // Nothing was moved into it; an empty directory left behind holds no output
            }
          }
          const reason = err instanceof Error ? err.message : String(err);
          const errorMessage = `could not move the previous output aside: ${reason}`;
          outputChannel.appendLine(`\n── Packaging failed: ${errorMessage} ──`);
          outputChannel.show(true);
          const failedStatus: PackageStatusPayload = {
            state: 'failed',
            errorMessage,
            filesCopied: 0,
            timestamp: new Date().toISOString(),
          };
          viewProvider.postMessage({ type: 'packageStatus', payload: failedStatus });
          vscode.window.showErrorMessage(`Packaging failed: ${errorMessage}`);
          return;
        }
      }

      // Broadcast running status
      const runningStatus: PackageStatusPayload = {
        state: 'running',
        outputDir,
        timestamp: new Date().toISOString(),
      };
      viewProvider.postMessage({ type: 'packageStatus', payload: runningStatus });

      // Show output channel with timestamped separator header
      outputChannel.show(true);
      const timestamp = new Date().toISOString();
      outputChannel.appendLine(`\n${'═'.repeat(60)}`);
      outputChannel.appendLine(`Package started at ${timestamp}`);
      outputChannel.appendLine('Projects:');
      for (const dir of projects) {
        outputChannel.appendLine(`  ${dir}`);
      }
      outputChannel.appendLine(`Output: ${outputDir}`);
      outputChannel.appendLine(`${'═'.repeat(60)}\n`);

      // The tool's lines go to the panel and each file it writes to the sidebar, for this run only
      const options: PackageRunOptions = {
        log: (line: string, level: ToolLogLevel) => {
          if (!ended) {
            outputChannel.appendLine(levelLine(line, level));
          }
        },
        onCopy: (event: PackageCopyEvent) => {
          if (ended) {
            return;
          }
          const currentStatus: PackageStatusPayload = {
            state: 'running',
            currentFile: `Copying ${event.name}...`,
            filesCopied: event.index,
            totalFiles: event.total,
            timestamp: new Date().toISOString(),
          };
          viewProvider.postMessage({ type: 'packageStatus', payload: currentStatus });
        },
      };

      try {
        // Wrap Package.run() in withProgress for notification-level spinner
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Packaging project...',
            cancellable: false,
          },
          async () => {
            result = await pkg.run(outputDir, projects, options);
          }
        );

        const packaged = result!;
        succeeded = packaged.success;
        if (packaged.success) {
          outputChannel.appendLine(`\n── Packaged ${packaged.fileCount} files into ${outputDir} ──`);
        } else {
          outputChannel.appendLine('\n── Packaging failed ──');
          if (packaged.message) {
            outputChannel.appendLine(packaged.message);
          }
          outputChannel.show(true);
        }

        viewProvider.postMessage({
          type: 'packageStatus',
          payload: packageStatusFrom(packaged, new Date().toISOString(), outputDir),
        });

        const notification = packageNotification(packaged, outputDir);
        if (notification.kind === 'info') {
          vscode.window.showInformationMessage(notification.text);
        } else {
          vscode.window.showErrorMessage(notification.text);
        }

        // The new result replaces the previous output
        if (packaged.success && aside !== null) {
          const previous = aside;
          aside = null;
          try {
            fs.rmSync(previous, { recursive: true, force: true });
          } catch (err: unknown) {
            const reason = err instanceof Error ? err.message : String(err);
            outputChannel.appendLine(`[WARNING] Could not remove the previous output at ${previous}: ${reason}`);
          }
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);

        outputChannel.appendLine(`\n── Packaging failed: ${errorMessage} ──`);
        outputChannel.show(true);

        // Broadcast failed status
        const failedStatus: PackageStatusPayload = {
          state: 'failed',
          errorMessage,
          filesCopied: 0,
          timestamp: new Date().toISOString(),
        };
        viewProvider.postMessage({ type: 'packageStatus', payload: failedStatus });

        // Show error notification
        vscode.window.showErrorMessage(`Packaging failed: ${errorMessage}`);
      }
    } finally {
      ended = true;

      // Unless the run succeeded, drop what it left in the output directory and put the previous output back
      if (aside !== null) {
        try {
          fs.rmSync(outputDir, { recursive: true, force: true });
          fs.renameSync(path.join(aside, asideName), outputDir);
          fs.rmSync(aside, { recursive: true, force: true });
        } catch (err: unknown) {
          const reason = err instanceof Error ? err.message : String(err);
          const message = `Packaging failed: the previous output is in ${path.join(aside, asideName)}: ${reason}`;
          outputChannel.appendLine(message);
          outputChannel.show(true);
          vscode.window.showErrorMessage(message);
        }
      } else if (!succeeded && absentBefore) {
        // There was no previous output: whatever an unsuccessful run left is removed
        try {
          fs.rmSync(outputDir, { recursive: true, force: true });
        } catch {
          // Left for the user; the failure has already been reported
        }
      }

      // Always release the operation lock
      releaseOperationLock();
    }
  };
}
