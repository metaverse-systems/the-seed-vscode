import * as sinon from 'sinon';
import * as vscode from 'vscode';
import type { TheSeedViewProvider } from '../../panels/TheSeedViewProvider';

export interface Posted {
  type: string;
  requestId?: string;
  payload?: Record<string, unknown>;
}

export interface FakeView {
  view: vscode.WebviewView;
  posted: Posted[];
  receive(message: object): Promise<void>;
  setVisible(visible: boolean): void;
  /**
   * Closes and reopens the sidebar as the editor does: hidden, shown, then the
   * page's `ready`. Resolves to what was posted from the moment `ready` was sent
   * until the provider had finished handling it.
   */
  reopen(): Promise<Posted[]>;
}

/** A webview view that records what is posted to it and lets a case send messages and change visibility. */
export function fakeView(provider: TheSeedViewProvider): FakeView {
  const posted: Posted[] = [];
  let received: (message: object) => Promise<void> = async () => undefined;
  let visibility: () => void = () => undefined;
  const webview = {
    options: {},
    html: '',
    cspSource: 'test',
    asWebviewUri: (uri: vscode.Uri) => uri,
    postMessage: async (message: Posted) => {
      posted.push(message);
      return true;
    },
    onDidReceiveMessage: (callback: (message: object) => Promise<void>) => {
      received = callback;
      return { dispose: () => undefined };
    },
  };
  const view = {
    webview,
    visible: true,
    onDidChangeVisibility: (callback: () => void) => {
      visibility = callback;
      return { dispose: () => undefined };
    },
  };
  provider.resolveWebviewView(
    view as unknown as vscode.WebviewView,
    {} as vscode.WebviewViewResolveContext,
    { isCancellationRequested: false, onCancellationRequested: sinon.stub() },
  );
  const setVisible = (visible: boolean): void => {
    view.visible = visible;
    visibility();
  };
  return {
    view: view as unknown as vscode.WebviewView,
    posted,
    receive: (message) => received(message),
    setVisible,
    reopen: async () => {
      setVisible(false);
      setVisible(true);
      const start = posted.length;
      await received({ command: 'ready' });
      return posted.slice(start);
    },
  };
}

/** Waits, polling, until `condition` holds; fails after five seconds naming `what`. */
export async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
