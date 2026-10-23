import * as vscode from 'vscode';
import { scaffoldTemplate } from './scaffoldTemplate';
import type { ToolApi } from '../tool/toolApi';

export async function createComponentTemplate(
  outputChannel: vscode.OutputChannel,
  tool: ToolApi
): Promise<void> {
  await scaffoldTemplate('component', outputChannel, tool);
}
