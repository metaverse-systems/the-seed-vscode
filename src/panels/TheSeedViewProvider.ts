import * as vscode from 'vscode';
import { handleMessage } from './messageHandler';
import type { ToolService } from '../tool/toolService';
import { toToolStatusPayload } from '../tool/toolStatus';
import { openCreatedProject } from '../utils/projectFolder';
import type { ExtensionToWebviewMessage, BuildStatusPayload, DependencyStatusPayload, InstallProgressPayload, PackageStatusPayload, InstallerStatusPayload, SigningStatusPayload, RecursiveBuildProgressPayload, RecursiveBuildCompletePayload } from '../types/messages';

export class TheSeedViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'the-seed.mainView';

  private readonly _statusSubscription: vscode.Disposable;
  private _view?: vscode.WebviewView;
  private _readyReceived = false;
  private _currentBuildStatus: BuildStatusPayload | null = null;
  // The last dependency status of each target, replayed to a page that has just loaded or been shown.
  private dependencyStatuses: { native?: DependencyStatusPayload; windows?: DependencyStatusPayload } = {};
  // The running check of the targets that have no status yet, so that two triggers start only one.
  private dependencyCheck: Promise<void> | undefined;
  private _currentInstallProgress: InstallProgressPayload | null = null;
  private _currentPackageStatus: PackageStatusPayload | null = null;
  private _currentInstallerStatus: InstallerStatusPayload | null = null;
  private _currentSigningStatus: SigningStatusPayload | null = null;
  private _currentRecursiveBuildProgress: RecursiveBuildProgressPayload | null = null;
  private _currentRecursiveBuildComplete: RecursiveBuildCompletePayload | null = null;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _service: ToolService
  ) {
    this._statusSubscription = this._service.onDidChangeStatus(() => {
      this._postToolStatus();
      // A tool that becomes usable after the page loaded checks what the page has not been told yet.
      if (this._readyReceived && this._service.status.state === 'usable') {
        void this.checkMissingDependencies();
      }
    });
  }

  public dispose(): void {
    this._statusSubscription.dispose();
  }

  private _postToolStatus(): void {
    this.postMessage({ type: 'toolStatus', payload: toToolStatusPayload(this._service.status) });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;
    this._readyReceived = false;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview'),
      ],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.command === 'ready') {
        this._readyReceived = true;
      }
      const response = await handleMessage(message, (pushMsg) => {
        webviewView.webview.postMessage(pushMsg);
      }, this._service);
      if (response) {
        webviewView.webview.postMessage(response);
        if (message.command === 'checkDependencies' && response.type === 'dependencyStatus') {
          this.dependencyStatuses[response.payload.target] = response.payload;
        }

        // A created project is opened only when no folder was open when it was asked for.
        if (
          response.type === 'templateCreated' &&
          response.payload.openFolder &&
          response.payload.projectPath
        ) {
          void openCreatedProject(response.payload.projectPath);
        }
        if (
          response.type === 'resourcePakCreated' &&
          response.payload.openFolder &&
          response.payload.packageDir
        ) {
          void openCreatedProject(response.payload.packageDir);
        }
      }
      // A page that has just loaded catches up on what is running, whichever place started it.
      if (message.command === 'ready') {
        this._replayTrackedState();
        if (response?.type === 'configLoaded' && response.payload.prefix !== '') {
          await this.checkMissingDependencies();
        }
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible && this._readyReceived) {
        this._postToolStatus();
        if (this._service.status.state === 'usable') {
          void this._refreshConfig();
        }
        this._replayTrackedState();
      }
    });
  }

  /** Posts every tracked state so a page that has just loaded or been shown catches up. */
  private _replayTrackedState(): void {
    // Push current build state so the webview catches up
    if (this._currentBuildStatus) {
      this.postMessage({ type: 'buildStatus', payload: this._currentBuildStatus });
    }
    // Push the dependency status of each target that has one so the webview catches up
    for (const status of [this.dependencyStatuses.native, this.dependencyStatuses.windows]) {
      if (status) {
        this.postMessage({ type: 'dependencyStatus', payload: status });
      }
    }
    // Push current install progress if install is running
    if (this._currentInstallProgress) {
      this.postMessage({ type: 'installDependenciesProgress', payload: this._currentInstallProgress });
    }
    // Push current package status so the webview catches up
    if (this._currentPackageStatus) {
      this.postMessage({ type: 'packageStatus', payload: this._currentPackageStatus });
    }
    // Push current installer status so the webview catches up
    if (this._currentInstallerStatus) {
      this.postMessage({ type: 'installerStatus', payload: this._currentInstallerStatus });
    }
    // Push current signing status so the webview catches up
    if (this._currentSigningStatus) {
      this.postMessage({ type: 'signingStatus', payload: this._currentSigningStatus });
    }
    // Push current recursive build progress so the webview catches up
    if (this._currentRecursiveBuildProgress) {
      this.postMessage({ type: 'recursiveBuildProgress', payload: this._currentRecursiveBuildProgress });
    }
    if (this._currentRecursiveBuildComplete) {
      this.postMessage({ type: 'recursiveBuildComplete', payload: this._currentRecursiveBuildComplete });
    }
  }

  /**
   * Push a message to the webview without a preceding request.
   * Silently drops the message if the webview is not visible.
   * Tracks build status for late-joining webview.
   */
  public postMessage(message: ExtensionToWebviewMessage): void {
    if (message.type === 'buildStatus') {
      this._currentBuildStatus = message.payload;
    }
    if (message.type === 'dependencyStatus') {
      this.dependencyStatuses[message.payload.target] = message.payload;
    }
    if (message.type === 'installDependenciesProgress') {
      this._currentInstallProgress = message.payload;
      // Clear progress on terminal states
      if (message.payload.state === 'completed' || message.payload.state === 'failed' || message.payload.state === 'cancelled') {
        this._currentInstallProgress = null;
      }
    }
    if (message.type === 'packageStatus') {
      this._currentPackageStatus = message.payload;
      // Clear on terminal states
      if (message.payload.state === 'completed' || message.payload.state === 'failed') {
        this._currentPackageStatus = null;
      }
    }
    if (message.type === 'installerStatus') {
      this._currentInstallerStatus = message.payload;
      // Clear on terminal states
      if (message.payload.state === 'completed' || message.payload.state === 'failed') {
        this._currentInstallerStatus = null;
      }
    }
    if (message.type === 'signingStatus') {
      this._currentSigningStatus = message.payload;
    }
    if (message.type === 'recursiveBuildProgress') {
      this._currentRecursiveBuildProgress = message.payload;
    }
    if (message.type === 'recursiveBuildComplete') {
      this._currentRecursiveBuildComplete = message.payload;
      this._currentRecursiveBuildProgress = null; // Clear progress on completion
    }
    if (this._view?.visible) {
      this._view.webview.postMessage(message);
    }
  }

  /**
   * Checks the dependencies of each target that has no status yet, through the sidebar's own check, and
   * posts the results. Nothing is checked unless the tool is usable and a prefix is configured.
   */
  private checkMissingDependencies(): Promise<void> {
    if (!this.dependencyCheck) {
      this.dependencyCheck = this.runMissingDependencyChecks().finally(() => {
        this.dependencyCheck = undefined;
      });
    }
    return this.dependencyCheck;
  }

  private async runMissingDependencyChecks(): Promise<void> {
    const missing = (['native', 'windows'] as const).filter((target) => !this.dependencyStatuses[target]);
    if (missing.length === 0 || this._service.status.state !== 'usable') {
      return;
    }
    try {
      const acquired = await this._service.acquire();
      if (!acquired.ok) {
        return;
      }
      const config = new acquired.api.Config();
      config.loadConfig();
      if (!config.config.prefix) {
        return;
      }
      for (const target of missing) {
        const response = await handleMessage(
          { command: 'checkDependencies', requestId: `__open__${target}`, data: { target } },
          undefined,
          this._service
        );
        if (response?.type === 'dependencyStatus') {
          this.postMessage(response);
        }
      }
    } catch {
      // The page's Check buttons remain; an automatic check that fails shows nothing.
    }
  }

  private async _refreshConfig(): Promise<void> {
    if (!this._view) {
      return;
    }
    try {
      const response = await handleMessage({ command: 'getConfig', requestId: '__visibility__' }, undefined, this._service);
      if (response) {
        this._view.webview.postMessage(response);
      }
    } catch {
      // Silently fail on refresh - user can re-open panel
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'assets', 'index.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'assets', 'index.css')
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
  <link rel="stylesheet" href="${styleUri}">
  <title>The Seed</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

let active: TheSeedViewProvider | undefined;

/** Makes `provider` the one the rest of the extension and its tests reach through `activeViewProvider`. */
export function setActiveViewProvider(provider: TheSeedViewProvider | undefined): void {
  active = provider;
}

/** The view provider `activate` registered, while the extension is active. */
export function activeViewProvider(): TheSeedViewProvider | undefined {
  return active;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
