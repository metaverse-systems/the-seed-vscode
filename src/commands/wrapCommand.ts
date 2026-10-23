import * as vscode from 'vscode';
import { describeError } from '../utils/projectFolder';
import type { ToolApi } from '../tool/toolApi';
import type { ToolService } from '../tool/toolService';

export type ToolHandler = (outputChannel: vscode.OutputChannel, tool: ToolApi) => Promise<void>;

/**
 * Wraps a command handler: the handler runs only when the tool is usable, and receives the tool the
 * service loaded. When it is not, the reason is written to the output channel and shown to the user,
 * and nothing else happens.
 */
export function wrapCommand(
  handler: ToolHandler,
  outputChannel: vscode.OutputChannel,
  service: ToolService
): () => Promise<void> {
  return async () => {
    const acquired = await service.acquire();
    if (!acquired.ok) {
      outputChannel.appendLine(`[${new Date().toISOString()}] ERROR: ${acquired.status.message}`);
      await service.showRefusal(acquired.status);
      return;
    }
    try {
      await handler(outputChannel, acquired.api);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const timestamp = new Date().toISOString();
      outputChannel.appendLine(`[${timestamp}] ERROR: ${message}`);
      if (error instanceof Error && error.stack) {
        outputChannel.appendLine(error.stack);
      }
      outputChannel.show(true);
      vscode.window.showErrorMessage(`The Seed: ${describeError(error)}`);
    }
  };
}
