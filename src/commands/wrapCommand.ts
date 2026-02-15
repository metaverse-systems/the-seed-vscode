import * as vscode from 'vscode';

export function wrapCommand(
  handler: (outputChannel: vscode.OutputChannel) => Promise<void>,
  outputChannel: vscode.OutputChannel
): () => Promise<void> {
  return async () => {
    try {
      await handler(outputChannel);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const timestamp = new Date().toISOString();
      outputChannel.appendLine(`[${timestamp}] ERROR: ${message}`);
      if (error instanceof Error && error.stack) {
        outputChannel.appendLine(error.stack);
      }
      outputChannel.show(true);
      vscode.window.showErrorMessage(`The Seed: ${message}`);
    }
  };
}
