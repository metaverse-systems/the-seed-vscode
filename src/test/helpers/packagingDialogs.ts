import * as fs from 'fs';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import type { ToolApi } from '../../tool/toolApi';
import { testTool, useToolApi } from './tool';

export const PROJECTS_LABEL = 'Package these projects';
export const OUTPUT_LABEL = 'Package into this directory';

export interface PackagingAnswers {
  /** The directories chosen in the project dialog; undefined dismisses it. */
  projects?: string[];
  /** The directory chosen in the output dialog; undefined dismisses it. */
  output?: string;
}

/**
 * Answers Package's two folder dialogs until sinon is restored, and returns the options of every
 * dialog shown, in order.
 */
export function answerPackagingDialogs(answers: PackagingAnswers): vscode.OpenDialogOptions[] {
  const shown: vscode.OpenDialogOptions[] = [];
  sinon.stub(vscode.window, 'showOpenDialog').callsFake(async (options?: vscode.OpenDialogOptions) => {
    shown.push(options ?? {});
    if (options?.openLabel === PROJECTS_LABEL) {
      return answers.projects?.map((dir) => vscode.Uri.file(dir));
    }
    if (options?.openLabel === OUTPUT_LABEL) {
      return answers.output === undefined ? undefined : [vscode.Uri.file(answers.output)];
    }
    return undefined;
  });
  return shown;
}

/** Writes a directory the tool accepts as a project (its src/Makefile.am names a program) and returns its real path. */
export function writePackagingProject(parent: string, name: string, makefileAm = 'bin_PROGRAMS = app\n'): string {
  const dir = path.join(parent, name);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'Makefile.am'), makefileAm);
  return fs.realpathSync(dir);
}

/**
 * Makes packaging find the native component until sinon is restored, so cases about the packaging flow
 * also run where the tool has none (Windows). Package itself is the loaded tool's, so its stubs apply.
 */
export async function packageWithoutNativeCheck(): Promise<void> {
  await useToolApi({ ...testTool(), requireNativeComponent: () => undefined } as ToolApi);
}

/** A project in the first workspace folder and an output beside it, both answered by the dialogs. */
export function answerWithNewProject(workspaceFolder: string): { project: string; output: string } {
  const root = fs.realpathSync(workspaceFolder);
  const project = writePackagingProject(root, 'game');
  const output = path.join(root, 'release');
  answerPackagingDialogs({ projects: [project], output });
  return { project, output };
}
