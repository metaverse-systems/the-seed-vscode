import * as path from 'path';
import * as vscode from 'vscode';
import { bundlePath } from './useBundle';
import { activeToolService } from '../../tool/toolService';

const SETTINGS_SECTION = 'the-seed';
const TOOL_PATH = 'toolPath';

/**
 * Mocha global setup: points the test editor at the tool named by THE_SEED_TEST_TOOL, activates the
 * extension once, before any case, checks that the editor activated the bundle the tests run against
 * and that the tool is usable. Any problem stops the run.
 */
export async function mochaGlobalSetup(): Promise<void> {
  const tool = process.env.THE_SEED_TEST_TOOL;
  if (!tool) {
    throw new Error('THE_SEED_TEST_TOOL is not set');
  }
  await vscode.workspace.getConfiguration(SETTINGS_SECTION).update(TOOL_PATH, tool, vscode.ConfigurationTarget.Global);

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
  let activated = path.resolve(extension.extensionPath, (extension.packageJSON as { main: string }).main);
  if (!activated.endsWith('.js')) {
    activated += '.js';
  }
  if (activated !== bundlePath) {
    throw new Error(`the editor activated ${activated}, not the bundle the tests use`);
  }
  const status = await activeToolService().whenChecked();
  if (status.state !== 'usable') {
    throw new Error(`the test tool is not usable: ${status.message}`);
  }
}

/** Mocha global teardown: removes the setting the setup wrote. */
export async function mochaGlobalTeardown(): Promise<void> {
  await vscode.workspace.getConfiguration(SETTINGS_SECTION).update(TOOL_PATH, undefined, vscode.ConfigurationTarget.Global);
}
