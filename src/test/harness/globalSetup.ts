import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Mocha global setup: activates the extension once, before any case. Any
 * problem stops the run.
 */
export async function mochaGlobalSetup(): Promise<void> {
  const manifest = require(path.resolve(__dirname, '..', '..', '..', 'package.json')) as { publisher: string; name: string };
  const id = `${manifest.publisher}.${manifest.name}`;
  const extension = vscode.extensions.getExtension(id);
  if (!extension) {
    throw new Error(`extension ${id} is not loaded in the test host`);
  }
  try {
    await extension.activate();
  } catch (error) {
    throw new Error(`activation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!extension.isActive) {
    throw new Error(`extension ${id} did not become active`);
  }
}
