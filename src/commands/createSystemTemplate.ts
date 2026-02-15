import * as vscode from 'vscode';
import { scaffoldTemplate } from './scaffoldTemplate';

export async function createSystemTemplate(
  outputChannel: vscode.OutputChannel
): Promise<void> {
  await scaffoldTemplate('system', outputChannel);
}
