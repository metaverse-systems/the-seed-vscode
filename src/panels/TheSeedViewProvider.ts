import * as vscode from 'vscode';
import { handleMessage } from './messageHandler';
import type { ExtensionToWebviewMessage, BuildStatusPayload } from '../types/messages';

export class TheSeedViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'the-seed.mainView';

  private _view?: vscode.WebviewView;
  private _readyReceived = false;
  private _currentBuildStatus: BuildStatusPayload | null = null;

  constructor(private readonly _extensionUri: vscode.Uri) {}

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
        vscode.Uri.joinPath(this._extensionUri, 'out', 'webview'),
      ],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.command === 'ready') {
        this._readyReceived = true;
      }
      const response = await handleMessage(message);
      if (response) {
        webviewView.webview.postMessage(response);

        // If template was created and openFolder flag is set, open the new folder
        if (
          response.type === 'templateCreated' &&
          response.payload.openFolder &&
          response.payload.projectPath
        ) {
          const folderUri = vscode.Uri.file(response.payload.projectPath);
          vscode.commands.executeCommand('vscode.openFolder', folderUri);
        }
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible && this._readyReceived) {
        this._refreshConfig();
        // Push current build state so the webview catches up
        if (this._currentBuildStatus) {
          this.postMessage({ type: 'buildStatus', payload: this._currentBuildStatus });
        }
      }
    });
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
    if (this._view?.visible) {
      this._view.webview.postMessage(message);
    }
  }

  private async _refreshConfig(): Promise<void> {
    if (!this._view) {
      return;
    }
    try {
      const response = await handleMessage({ command: 'getConfig', requestId: '__visibility__' });
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
      vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'assets', 'index.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'assets', 'index.css')
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

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
