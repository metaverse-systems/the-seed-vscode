import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

export function createOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('The Seed');
  }
  return outputChannel;
}

export function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    throw new Error('Output channel not initialized. Call createOutputChannel() first.');
  }
  return outputChannel;
}
