import * as vscode from 'vscode';
import { scaffoldTemplate } from './scaffoldTemplate';
import type { ToolApi } from '../tool/toolApi';

export async function createSystemTemplate(
  outputChannel: vscode.OutputChannel,
  tool: ToolApi
): Promise<void> {
  await scaffoldTemplate('system', outputChannel, tool);
}
