import * as assert from 'assert';
import * as fs from 'fs';
import * as sinon from 'sinon';
import { TheSeedViewProvider } from '../../panels/TheSeedViewProvider';
import * as vscode from 'vscode';
import { activeToolService } from '../../tool/toolService';
import { useScratchState } from '../helpers/scratchState';
import { withToolSetting } from '../helpers/tool';

interface Posted {
  type: string;
  requestId?: string;
  payload?: Record<string, unknown>;
}

interface FakeView {
  view: vscode.WebviewView;
  posted: Posted[];
  receive(message: object): Promise<void>;
  setVisible(visible: boolean): void;
}

/** A webview view that records what is posted to it and lets a case send messages and change visibility. */
function fakeView(provider: TheSeedViewProvider): FakeView {
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
  return {
    view: view as unknown as vscode.WebviewView,
    posted,
    receive: (message) => received(message),
    setVisible: (visible) => {
      view.visible = visible;
      visibility();
    },
  };
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

suite('TheSeedViewProvider', () => {
  let provider: TheSeedViewProvider;
  let extensionUri: vscode.Uri;

  setup(() => {
    extensionUri = vscode.Uri.file('/test/extension');
    provider = new TheSeedViewProvider(extensionUri, activeToolService());
  });

  test('should have the correct view type', () => {
    assert.strictEqual(TheSeedViewProvider.viewType, 'the-seed.mainView');
  });

  test('resolveWebviewView generates HTML with CSP nonce', () => {
    let capturedHtml = '';

    const mockWebview: Partial<vscode.Webview> = {
      options: {} as vscode.WebviewOptions,
      asWebviewUri: (uri: vscode.Uri) => uri,
      cspSource: 'https://test.vscode-resource.vscode-cdn.net',
      set html(value: string) {
        capturedHtml = value;
      },
      get html() {
        return capturedHtml;
      },
      onDidReceiveMessage: sinon.stub().returns({ dispose: () => {} }),
    };

    const mockView: Partial<vscode.WebviewView> = {
      webview: mockWebview as vscode.Webview,
      onDidChangeVisibility: sinon.stub().returns({ dispose: () => {} }),
    };

    const mockContext: vscode.WebviewViewResolveContext = {} as vscode.WebviewViewResolveContext;
    const mockToken: vscode.CancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: sinon.stub(),
    };

    provider.resolveWebviewView(
      mockView as vscode.WebviewView,
      mockContext,
      mockToken
    );

    // Verify HTML contains nonce
    assert.ok(capturedHtml.includes('nonce-'), 'HTML should contain a CSP nonce');
    assert.ok(capturedHtml.includes('<script nonce='), 'Script tag should have nonce attribute');

    // Verify HTML has correct structure
    assert.ok(capturedHtml.includes('<div id="root">'), 'HTML should have root element');
    assert.ok(capturedHtml.includes('Content-Security-Policy'), 'HTML should have CSP meta tag');

    // Verify script/style URIs reference dist/webview/assets
    assert.ok(
      capturedHtml.includes('assets/index.js'),
      'HTML should reference the built JS bundle'
    );
    assert.ok(
      capturedHtml.includes('assets/index.css'),
      'HTML should reference the built CSS bundle'
    );
  });

  test('resolveWebviewView sets localResourceRoots to webview build directory', () => {
    let capturedOptions: vscode.WebviewOptions = {};

    const mockWebview: Partial<vscode.Webview> = {
      get options() {
        return capturedOptions;
      },
      set options(value: vscode.WebviewOptions) {
        capturedOptions = value;
      },
      html: '',
      asWebviewUri: (uri: vscode.Uri) => uri,
      cspSource: 'test',
      onDidReceiveMessage: sinon.stub().returns({ dispose: () => {} }),
    };

    const mockView: Partial<vscode.WebviewView> = {
      webview: mockWebview as vscode.Webview,
      onDidChangeVisibility: sinon.stub().returns({ dispose: () => {} }),
    };

    provider.resolveWebviewView(
      mockView as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      { isCancellationRequested: false, onCancellationRequested: sinon.stub() }
    );

    assert.ok(capturedOptions.enableScripts, 'Scripts should be enabled');
    assert.ok(capturedOptions.localResourceRoots, 'localResourceRoots should be set');
    assert.ok(
      capturedOptions.localResourceRoots!.length > 0,
      'localResourceRoots should have at least one entry'
    );

    const rootPath = capturedOptions.localResourceRoots![0].fsPath;
    assert.ok(
      rootPath.includes('dist') && rootPath.includes('webview'),
      'localResourceRoots should include the webview build directory'
    );
  });

  suite('tool status', function () {
    this.timeout(60000);
    useScratchState();

    setup(() => {
      sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);
      sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
    });

    teardown(() => {
      (provider as unknown as { dispose?: () => void }).dispose?.();
      sinon.restore();
    });

    const statuses = (fake: FakeView): Posted[] => fake.posted.filter((message) => message.type === 'toolStatus');

    test('a resolved view receives toolStatus when the status changes', async () => {
      const fake = fakeView(provider);
      const location = fs.realpathSync(process.env.THE_SEED_TEST_TOOL as string);
      const version = activeToolService().status.installation?.version;

      await withToolSetting('/nonexistent', async () => {
        const unusable = statuses(fake).at(-1);
        assert.ok(unusable, 'a toolStatus was posted for the unusable state');
        assert.deepStrictEqual(unusable.payload, {
          state: 'notTheTool',
          usable: false,
          message: activeToolService().status.message,
          location: undefined,
          version: undefined,
          foundThrough: undefined,
          required: '2.0.0',
          setting: 'the-seed.toolPath',
        });
      });

      const usable = statuses(fake).at(-1);
      assert.ok(usable, 'a toolStatus was posted for the usable state');
      assert.deepStrictEqual(usable.payload, {
        state: 'usable',
        usable: true,
        message: activeToolService().status.message,
        location,
        version,
        foundThrough: 'setting',
        required: '2.0.0',
        setting: 'the-seed.toolPath',
      });
    });

    test('getToolStatus answers with the current status and the request id', async () => {
      const fake = fakeView(provider);
      await fake.receive({ command: 'getToolStatus', requestId: 'status-1' });
      const answer = statuses(fake).at(-1);
      assert.ok(answer);
      assert.strictEqual(answer.requestId, 'status-1');
      assert.strictEqual(answer.payload?.usable, true);
    });

    test('checkTool checks again and answers with the status', async () => {
      const fake = fakeView(provider);
      await withToolSetting('/nonexistent', async () => {
        await fake.receive({ command: 'checkTool', requestId: 'check-1' });
        const answer = statuses(fake).filter((message) => message.requestId === 'check-1');
        assert.strictEqual(answer.length, 1);
        assert.strictEqual(answer[0].payload?.state, 'notTheTool');
      });
    });

    test('openToolSetting opens the settings editor at the tool setting and posts nothing', async () => {
      const execute = sinon.stub(vscode.commands, 'executeCommand').resolves(undefined);
      const fake = fakeView(provider);
      await fake.receive({ command: 'openToolSetting' });
      assert.ok(execute.calledWith('workbench.action.openSettings', 'the-seed.toolPath'));
      assert.strictEqual(fake.posted.length, 0);
    });

    test('becoming visible again posts the status and refreshes the configuration while usable', async () => {
      const fake = fakeView(provider);
      await fake.receive({ command: 'ready' });
      fake.posted.length = 0;

      fake.setVisible(true);

      await until(() => fake.posted.some((message) => message.type === 'configLoaded'), 'the configuration refresh');
      const status = statuses(fake).at(-1);
      assert.ok(status, 'the current status is posted');
      assert.strictEqual(status.payload?.usable, true);
      assert.strictEqual(fake.posted.find((message) => message.type === 'configLoaded')?.requestId, '__visibility__');
    });

    test('becoming visible again while unusable posts the status and no refresh or error', async () => {
      const fake = fakeView(provider);
      await withToolSetting('/nonexistent', async () => {
        await fake.receive({ command: 'ready' });
        fake.posted.length = 0;

        fake.setVisible(true);

        await until(() => statuses(fake).length > 0, 'the status');
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.strictEqual(statuses(fake).at(-1)?.payload?.usable, false);
        assert.deepStrictEqual(
          fake.posted.filter((message) => message.type !== 'toolStatus'),
          [],
          'nothing but the status is posted',
        );
      });
    });
  });
});
