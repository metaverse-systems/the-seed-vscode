import * as vscode from 'vscode';
import { scaffoldTemplate } from './scaffoldTemplate';

export async function createProgramTemplate(
  outputChannel: vscode.OutputChannel
): Promise<void> {
  await scaffoldTemplate('program', outputChannel);
}
