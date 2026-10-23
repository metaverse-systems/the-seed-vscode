import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { findCandidates, type LookupEnvironment, type LookupReport, type ToolCandidate } from './resolveTool';
import { firstLineOf, LoadFailure, loadInstallation } from './loadTool';
import { TOOL_SETTING } from './requiredVersion';
import { describeToolStatus, statusKey, type ToolState, type ToolStatus } from './toolStatus';
import type { ToolApi } from './toolApi';

export type CheckReason = 'activate' | 'setting' | 'checkAgain' | 'operation';

export type Acquired =
  | { ok: true; api: ToolApi; installation: ToolCandidate }
  | { ok: false; status: ToolStatus };

/** Puts a status in front of the user. */
export interface ToolNotifier {
  showNotice(status: ToolStatus): Promise<void> | void;
  showRefusal(status: ToolStatus): Promise<void> | void;
}

export interface ToolServiceDeps {
  lookup: LookupEnvironment;
  readSetting(): string | undefined;
  load(packageDir: string): ToolApi;
  notifier: ToolNotifier;
}

interface InUse {
  installation: ToolCandidate;
  api: ToolApi;
}

interface Flight {
  promise: Promise<ToolStatus>;
  checkAgain: boolean;
  operation: boolean;
  restart: boolean;
}

const emptyReport = (): LookupReport => ({ looked: [], candidates: [], settingValue: undefined, settingProblem: undefined });

function buildStatus(state: ToolState, parts: Partial<ToolStatus> = {}): ToolStatus {
  const status: ToolStatus = {
    state,
    installation: undefined,
    others: [],
    report: emptyReport(),
    loadError: undefined,
    previousVersion: undefined,
    message: '',
    key: '',
    ...parts,
  };
  status.message = describeToolStatus(status);
  status.key = statusKey(state, status.installation, status.report);
  return status;
}

function readVersionOf(packageDir: string): string | undefined {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof manifest.version === 'string' ? manifest.version : undefined;
  } catch {
    return undefined;
  }
}

/** Reports a problem without letting it reach the caller. */
function attempt(action: () => Promise<void> | void): Promise<void> {
  try {
    return Promise.resolve(action()).catch(() => undefined);
  } catch {
    return Promise.resolve();
  }
}

/**
 * Finds, checks and loads the user's installation of the tool, and says what it found. A check never
 * rejects: whatever goes wrong becomes an unusable status.
 */
export class ToolService implements vscode.Disposable {
  private current: ToolStatus = buildStatus('checking');
  private inUse: InUse | undefined;
  private flight: Flight | undefined;
  private checked = false;
  private readonly firstCheck: Promise<ToolStatus>;
  private resolveFirstCheck: (status: ToolStatus) => void = () => undefined;
  private readonly shownKeys = new Set<string>();
  // The version first loaded from each directory; Node keeps those modules for the whole session.
  private readonly loadedVersions = new Map<string, string>();
  private readonly changed = new vscode.EventEmitter<ToolStatus>();

  readonly onDidChangeStatus: vscode.Event<ToolStatus> = this.changed.event;

  constructor(private readonly deps: ToolServiceDeps) {
    this.firstCheck = new Promise<ToolStatus>((resolve) => {
      this.resolveFirstCheck = resolve;
    });
  }

  get status(): ToolStatus {
    return this.current;
  }

  /** The API of the installation in use, when the status is usable. */
  loadedApi(): ToolApi | undefined {
    return this.current.state === 'usable' ? this.inUse?.api : undefined;
  }

  whenChecked(): Promise<ToolStatus> {
    return this.firstCheck;
  }

  showRefusal(status: ToolStatus): Promise<void> {
    return attempt(() => this.deps.notifier.showRefusal(status));
  }

  check(reason: CheckReason): Promise<ToolStatus> {
    const running = this.flight;
    if (running) {
      running.checkAgain = running.checkAgain || reason === 'checkAgain';
      running.operation = running.operation || reason === 'operation';
      // A change of the setting during a check may not have been read by it.
      running.restart = running.restart || reason === 'setting';
      return running.promise;
    }
    const flight: Flight = {
      promise: Promise.resolve(this.current),
      checkAgain: reason === 'checkAgain',
      operation: reason === 'operation',
      restart: false,
    };
    this.flight = flight;
    flight.promise = this.run(flight);
    return flight.promise;
  }

  async acquire(): Promise<Acquired> {
    const inUse = this.inUse;
    if (this.current.state === 'usable' && inUse) {
      const version = readVersionOf(inUse.installation.packageDir);
      if (version === inUse.installation.version) {
        return { ok: true, api: inUse.api, installation: inUse.installation };
      }
      const status = buildStatus('reloadRequired', {
        installation: { ...inUse.installation, version, verdict: 'unreadable' },
        others: this.current.others,
        report: this.current.report,
        previousVersion: inUse.installation.version,
      });
      this.inUse = undefined;
      this.apply(status);
      return { ok: false, status };
    }
    const status = await this.check('operation');
    const api = this.loadedApi();
    if (status.state === 'usable' && api && this.inUse) {
      return { ok: true, api, installation: this.inUse.installation };
    }
    return { ok: false, status };
  }

  dispose(): void {
    this.changed.dispose();
  }

  private async run(flight: Flight): Promise<ToolStatus> {
    let status: ToolStatus;
    try {
      do {
        flight.restart = false;
        status = await this.compute();
      } while (flight.restart);
    } catch (error) {
      status = buildStatus('notFound', {
        report: { ...emptyReport(), looked: [`the lookup failed: ${firstLineOf(error)}`] },
      });
      this.inUse = undefined;
    }
    this.flight = undefined;
    this.apply(status);
    this.announce(status, flight);
    if (!this.checked) {
      this.checked = true;
      this.resolveFirstCheck(status);
    }
    return status;
  }

  private async compute(): Promise<ToolStatus> {
    const report = await findCandidates(this.deps.readSetting(), this.deps.lookup);
    this.inUse = undefined;
    if (report.settingProblem !== undefined) {
      return buildStatus('notTheTool', { report });
    }
    const [first, ...others] = report.candidates;
    if (!first) {
      return buildStatus('notFound', { report });
    }
    const parts = { installation: first, others, report };

    const earlier = this.loadedVersions.get(first.packageDir);
    if (first.verdict === 'tooOld' || first.verdict === 'tooNew') {
      return buildStatus(first.verdict, parts);
    }
    if (earlier !== undefined && earlier !== first.version) {
      return buildStatus('reloadRequired', { ...parts, previousVersion: earlier });
    }
    if (first.verdict === 'unreadable' || first.version === undefined) {
      const loadError = first.version === undefined
        ? 'its package information could not be read'
        : `its version "${first.version}" is not a version number`;
      return buildStatus('notLoadable', { ...parts, loadError });
    }

    let api: ToolApi;
    try {
      api = this.deps.load(first.packageDir);
    } catch (error) {
      const loadError = error instanceof LoadFailure ? error.firstLine : firstLineOf(error);
      return buildStatus('notLoadable', { ...parts, loadError });
    }
    this.loadedVersions.set(first.packageDir, first.version);
    this.inUse = { installation: first, api };
    return buildStatus('usable', parts);
  }

  private apply(status: ToolStatus): void {
    const keyChanged = status.key !== this.current.key;
    this.current = status;
    if (keyChanged) {
      this.changed.fire(status);
    }
  }

  /**
   * Shows the notice for an unusable status once per key. An operation waiting on the check shows the
   * refusal instead, so that key counts as shown without a notice; a check the user asked for always
   * shows it.
   */
  private announce(status: ToolStatus, flight: Flight): void {
    if (status.state === 'usable' || status.state === 'checking') {
      return;
    }
    const firstTime = !this.shownKeys.has(status.key);
    this.shownKeys.add(status.key);
    if (flight.checkAgain || (firstTime && !flight.operation)) {
      void attempt(() => this.deps.notifier.showNotice(status));
    }
  }
}

/** A notifier that shows the status in the editor with the actions that can fix it. */
export function createVscodeNotifier(checkAgain: () => unknown): ToolNotifier {
  const show = async (refusal: boolean, status: ToolStatus): Promise<void> => {
    const actions = ['Open Setting', 'Check Again'];
    if (status.state === 'reloadRequired') {
      actions.push('Reload Window');
    }
    const text = `The Seed: ${status.message}`;
    const choice = refusal
      ? await vscode.window.showErrorMessage(text, ...actions)
      : await vscode.window.showWarningMessage(text, ...actions);
    if (choice === 'Open Setting') {
      await vscode.commands.executeCommand('workbench.action.openSettings', TOOL_SETTING);
    } else if (choice === 'Check Again') {
      await checkAgain();
    } else if (choice === 'Reload Window') {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  };
  return {
    showNotice: (status) => show(false, status),
    showRefusal: (status) => show(true, status),
  };
}

function runNpmRoot(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const onWindows = process.platform === 'win32';
    try {
      execFile(onWindows ? 'npm.cmd' : 'npm', ['root', '-g'], { timeout: 5000, shell: onWindows, windowsHide: true }, (error, stdout) => {
        const root = error ? '' : String(stdout).trim();
        resolve(root.length > 0 ? root : undefined);
      });
    } catch {
      resolve(undefined);
    }
  });
}

function defaultRootsFor(platform: NodeJS.Platform, env: Record<string, string | undefined>): string[] {
  if (platform === 'win32') {
    return env.APPDATA ? [path.join(env.APPDATA, 'npm', 'node_modules')] : [];
  }
  return ['/usr/local/lib/node_modules', '/usr/lib/node_modules', '/opt/homebrew/lib/node_modules'];
}

/** The lookup environment of this machine. */
export function createLookupEnvironment(): LookupEnvironment {
  return {
    platform: process.platform,
    env: process.env,
    homedir: os.homedir(),
    runNpmRoot,
    defaultRoots: defaultRootsFor(process.platform, process.env),
  };
}

/** The service the extension runs: this machine's environment, the editor's setting and notices. */
export function createToolService(): ToolService {
  const service: ToolService = new ToolService({
    lookup: createLookupEnvironment(),
    readSetting: () => vscode.workspace.getConfiguration('the-seed').get<string>('toolPath'),
    load: loadInstallation,
    notifier: createVscodeNotifier(() => service.check('checkAgain')),
  });
  return service;
}

let active: ToolService | undefined;

/** Makes `service` the one the rest of the extension and its tests reach through `activeToolService`. */
export function setActiveToolService(service: ToolService | undefined): void {
  active = service;
}

export function activeToolService(): ToolService {
  if (!active) {
    throw new Error('the tool service has not been created: the extension is not active');
  }
  return active;
}
