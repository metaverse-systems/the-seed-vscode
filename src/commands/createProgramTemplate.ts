import * as vscode from 'vscode';
import { scaffoldTemplate } from './scaffoldTemplate';
import type { ToolApi } from '../tool/toolApi';

export async function createProgramTemplate(
  outputChannel: vscode.OutputChannel,
  tool: ToolApi
): Promise<void> {
  await scaffoldTemplate('program', outputChannel, tool);
}
