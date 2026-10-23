import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as sinon from 'sinon';
import { TheSeedViewProvider } from '../../panels/TheSeedViewProvider';
import * as vscode from 'vscode';
import { activeToolService } from '../../tool/toolService';
import { useScratchState } from '../helpers/scratchState';
import { withToolSetting } from '../helpers/tool';
import { acquireOperationLock, getOperationLock } from '../../operationLock';
import { fakeView, until } from '../helpers/fakeView';
import type { FakeView, Posted } from '../helpers/fakeView';

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

  suite('build commands that do not start', function () {
    this.timeout(60000);
    useScratchState({ workspaceFolders: 1 });

    teardown(() => {
      (provider as unknown as { dispose?: () => void }).dispose?.();
      sinon.restore();
    });

    test('startBuild through the sidebar after a build ended with no project answers buildStarted', async () => {
      const pick = sinon.stub(vscode.window, 'showQuickPick');
      pick.onFirstCall().resolves({ label: 'Debug' } as vscode.QuickPickItem);
      pick.resolves(undefined);
      sinon.stub(vscode.workspace, 'findFiles').resolves([]);
      sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);
      await vscode.commands.executeCommand('the-seed.buildNative');
      assert.strictEqual(getOperationLock().active, false, 'the lock is free after the build that did not start');
      const fake = fakeView(provider);
      const asked = pick.callCount;

      await fake.receive({ command: 'startBuild', requestId: 'build-1', data: { target: 'native' } });
      await until(() => pick.callCount > asked, 'the fired command to ask for the build mode');

      const answer = fake.posted.find((message) => message.requestId === 'build-1');
      assert.ok(answer, 'the request was answered');
      assert.strictEqual(answer.type, 'buildStarted');
      assert.notStrictEqual(answer.payload?.message, 'A build is already in progress.');
    });

    for (const [command, target] of [['startBuild', 'native'], ['startRecursiveBuild', 'native']] as const) {
      test(`${command} through the sidebar while a build holds the lock answers buildStarted and shows the palette's warning once`, async () => {
        const held = acquireOperationLock('build');
        assert.ok(held.success, 'the case holds the build lock');
        const pick = sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);
        const warning = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);
        const fake = fakeView(provider);

        await fake.receive({ command, requestId: 'held-1', data: { target } });

        const answer = fake.posted.find((message) => message.requestId === 'held-1');
        assert.ok(answer, 'the request was answered');
        assert.strictEqual(answer.type, 'buildStarted', `the answer is not an error reply: ${JSON.stringify(answer.payload)}`);
        await until(() => warning.callCount > 0, "the fired command's warning");
        await new Promise((resolve) => setTimeout(resolve, 200));
        assert.deepStrictEqual(warning.getCalls().map((call) => call.args[0]), ['A build is already in progress.']);
        assert.ok(pick.notCalled, 'nothing is asked while the lock is held');
        assert.strictEqual(getOperationLock().type, 'build', 'the holder is unchanged');
        assert.strictEqual(getOperationLock().abortController, held.abortController, 'the holder is the same build');
      });
    }
  });

  suite('creating a project from the sidebar', function () {
    this.timeout(60000);
    const SCOPE = '@acme';
    const NAME = 'widget';
    const state = useScratchState({ scopes: { [SCOPE]: 'Ada Lovelace' }, workspaceFolders: 1 });
    let opened: unknown[][];

    setup(() => {
      opened = [];
      const original = vscode.commands.executeCommand.bind(vscode.commands);
      sinon.stub(vscode.commands, 'executeCommand').callsFake(((command: string, ...args: unknown[]) => {
        if (command === 'vscode.openFolder') {
          opened.push(args);
          return Promise.resolve(undefined);
        }
        return original(command, ...args);
      }) as typeof vscode.commands.executeCommand);
    });

    teardown(() => {
      (provider as unknown as { dispose?: () => void }).dispose?.();
      sinon.restore();
    });

    function openedPaths(): string[] {
      return opened.map((args) => (args[0] as vscode.Uri).fsPath);
    }

    test('createResourcePak with a folder open answers openFolder false, creates the pak inside it and opens nothing', async () => {
      const workspace = state.workspaceFolders[0];
      const dialog = sinon.stub(vscode.window, 'showOpenDialog').resolves(undefined);
      const fake = fakeView(provider);

      await fake.receive({ command: 'createResourcePak', requestId: 'pak-1', data: { scopeName: SCOPE, pakName: NAME } });

      const answer = fake.posted.find((message) => message.requestId === 'pak-1');
      assert.ok(answer, 'the request was answered');
      assert.strictEqual(answer.type, 'resourcePakCreated');
      assert.strictEqual(answer.payload?.openFolder, false);
      assert.strictEqual(answer.payload?.packageDir, path.join(workspace, NAME));
      assert.ok(fs.existsSync(path.join(workspace, NAME)), 'the pak is created inside the open folder');
      assert.ok(dialog.notCalled, 'no folder is asked for while a folder is open');
      assert.deepStrictEqual(opened, [], 'the open folder is not replaced');
    });

    test('createResourcePak with no folder open opens the new pak once', async () => {
      const chosen = state.dir('chosen');
      state.setWorkspaceFolders([]);
      sinon.stub(vscode.window, 'showOpenDialog').resolves([vscode.Uri.file(chosen)]);
      const fake = fakeView(provider);

      await fake.receive({ command: 'createResourcePak', requestId: 'pak-2', data: { scopeName: SCOPE, pakName: NAME } });

      const answer = fake.posted.find((message) => message.requestId === 'pak-2');
      assert.ok(answer, 'the request was answered');
      assert.strictEqual(answer.type, 'resourcePakCreated');
      assert.strictEqual(answer.payload?.openFolder, true);
      assert.deepStrictEqual(openedPaths(), [path.join(chosen, NAME)]);
    });

    test('createTemplate with a folder open opens nothing', async () => {
      const workspace = state.workspaceFolders[0];
      const dialog = sinon.stub(vscode.window, 'showOpenDialog').resolves(undefined);
      const fake = fakeView(provider);

      await fake.receive({
        command: 'createTemplate',
        requestId: 'template-1',
        data: { templateType: 'component', scopeName: SCOPE, templateName: NAME },
      });

      const answer = fake.posted.find((message) => message.requestId === 'template-1');
      assert.ok(answer, 'the request was answered');
      assert.strictEqual(answer.type, 'templateCreated');
      assert.strictEqual(answer.payload?.openFolder, false);
      assert.ok(fs.existsSync(path.join(workspace, NAME)), 'the project is created inside the open folder');
      assert.ok(dialog.notCalled, 'no folder is asked for while a folder is open');
      assert.deepStrictEqual(opened, [], 'the open folder is not replaced');
    });

    test('createTemplate with no folder open opens the new project once', async () => {
      const chosen = state.dir('chosen');
      state.setWorkspaceFolders([]);
      sinon.stub(vscode.window, 'showOpenDialog').resolves([vscode.Uri.file(chosen)]);
      const fake = fakeView(provider);

      await fake.receive({
        command: 'createTemplate',
        requestId: 'template-2',
        data: { templateType: 'component', scopeName: SCOPE, templateName: NAME },
      });

      const answer = fake.posted.find((message) => message.requestId === 'template-2');
      assert.ok(answer, 'the request was answered');
      assert.strictEqual(answer.type, 'templateCreated');
      assert.strictEqual(answer.payload?.openFolder, true);
      assert.deepStrictEqual(openedPaths(), [path.join(chosen, NAME)]);
    });
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
