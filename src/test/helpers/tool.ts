import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { activeToolService } from '../../tool/toolService';
import type { ToolApi } from '../../tool/toolApi';

/** The tool the extension has loaded for this run; throws with the status message when it is not usable. */
export function testTool(): ToolApi {
  const service = activeToolService();
  const api = service.loadedApi();
  if (!api) {
    throw new Error(service.status.message);
  }
  return api;
}

/**
 * Makes every operation of the running extension use `api` in place of the loaded tool, until sinon
 * is restored. The installation reported with it is the one in use.
 */
export async function useToolApi(api: ToolApi): Promise<void> {
  const service = activeToolService();
  const acquired = await service.acquire();
  if (!acquired.ok) {
    throw new Error(acquired.status.message);
  }
  sinon.stub(service, 'acquire').resolves({ ok: true, api, installation: acquired.installation });
}

const SETTING_TIMEOUT_MS = 4000;

async function setToolPath(value: string): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('the-seed');
  if (configuration.inspect<string>('toolPath')?.globalValue === value) {
    return;
  }
  const service = activeToolService();
  const rechecks: Promise<unknown>[] = [];
  const original = service.check.bind(service);
  const spy = sinon.stub(service, 'check').callsFake((reason) => {
    const result = original(reason);
    if (reason === 'setting') {
      rechecks.push(result);
    }
    return result;
  });
  try {
    await configuration.update('toolPath', value, vscode.ConfigurationTarget.Global);
    const deadline = Date.now() + SETTING_TIMEOUT_MS;
    while (rechecks.length === 0) {
      if (Date.now() > deadline) {
        throw new Error(`changing the-seed.toolPath to "${value}" did not recheck the tool`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await Promise.all(rechecks);
  } finally {
    spy.restore();
  }
}

/**
 * Sets `the-seed.toolPath` for the whole editor, waits for the extension to recheck the tool, runs
 * `fn`, then puts the test tool back and waits for that recheck too, also when `fn` fails.
 */
export async function withToolSetting<T>(value: string, fn: () => Promise<T> | T): Promise<T> {
  const original = process.env.THE_SEED_TEST_TOOL;
  if (!original) {
    throw new Error('THE_SEED_TEST_TOOL is not set');
  }
  await setToolPath(value);
  let result: T;
  try {
    result = await fn();
  } catch (error) {
    // The case's own failure is the one to report; the restore still has to happen.
    await setToolPath(original).catch(() => undefined);
    throw error;
  }
  await setToolPath(original);
  return result;
}
