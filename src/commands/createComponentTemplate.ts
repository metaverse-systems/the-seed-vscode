import * as vscode from 'vscode';
import { scaffoldTemplate } from './scaffoldTemplate';

export async function createComponentTemplate(
  outputChannel: vscode.OutputChannel
): Promise<void> {
  await scaffoldTemplate('component', outputChannel);
}
