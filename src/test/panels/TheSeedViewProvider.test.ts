import * as assert from 'assert';
import * as sinon from 'sinon';
import { TheSeedViewProvider } from '../../panels/TheSeedViewProvider';
import * as vscode from 'vscode';

suite('TheSeedViewProvider', () => {
  let provider: TheSeedViewProvider;
  let extensionUri: vscode.Uri;

  setup(() => {
    extensionUri = vscode.Uri.file('/test/extension');
    provider = new TheSeedViewProvider(extensionUri);
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

    // Verify script/style URIs reference out/webview/assets
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
      rootPath.includes('out') && rootPath.includes('webview'),
      'localResourceRoots should include the webview build directory'
    );
  });
});
