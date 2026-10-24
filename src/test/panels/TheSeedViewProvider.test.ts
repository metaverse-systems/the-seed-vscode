import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as sinon from 'sinon';
import { TheSeedViewProvider, activeViewProvider } from '../../panels/TheSeedViewProvider';
import * as vscode from 'vscode';
import { activeToolService } from '../../tool/toolService';
import type { ToolService } from '../../tool/toolService';
import type { ToolApi } from '../../tool/toolApi';
import { useScratchState } from '../helpers/scratchState';
import { testTool, withToolSetting } from '../helpers/tool';
import { requires } from '../harness/platform';
import { useFakeGit } from '../helpers/fakeGit';
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
          required: '2.1.0',
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
        required: '2.1.0',
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

  suite('replay when the sidebar is reopened', function () {
    this.timeout(60000);
    useScratchState({ workspaceFolders: 1 });

    teardown(() => {
      (provider as unknown as { dispose?: () => void }).dispose?.();
    });

    /** The extension's own provider, resolved on a fake view whose page has loaded. */
    async function openSidebar(): Promise<FakeView> {
      const extensionProvider = activeViewProvider();
      assert.ok(extensionProvider, "the extension's view provider exists");
      const fake = fakeView(extensionProvider);
      await fake.receive({ command: 'ready' });
      return fake;
    }

    const ofType = (messages: Posted[], type: string, state?: string): Posted[] =>
      messages.filter((message) => message.type === type && (state === undefined || message.payload?.state === state));

    suite('dependency installation', () => {
      requires('posix-toolchain');
      const git = useFakeGit();

      setup(() => {
        sinon.stub(vscode.window, 'showQuickPick').resolves({ label: 'native' } as vscode.QuickPickItem);
        sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
        sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);
        sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      });

      const starts: { from: string; start: (fake: FakeView) => Promise<{ done: Thenable<unknown> | null }> }[] = [
        {
          from: 'the sidebar',
          start: async (fake) => {
            await fake.receive({ command: 'installDependencies', requestId: 'install-1', data: { target: 'native' } });
            return { done: null };
          },
        },
        {
          from: 'the palette',
          start: async () => ({ done: vscode.commands.executeCommand('the-seed.installDependencies', 'native') }),
        },
      ];

      for (const { from, start } of starts) {
        test(`an installation started from ${from} is replayed as running after ready, and not once it has ended`, async () => {
          git.slow(30);
          const fake = await openSidebar();

          const { done } = await start(fake);
          try {
            await until(() => ofType(fake.posted, 'installDependenciesProgress', 'running').length > 0, 'the installation to post its running state');

            const replayed = await fake.reopen();

            const progress = ofType(replayed, 'installDependenciesProgress', 'running');
            assert.ok(progress.length > 0, `the running installation is replayed after ready; posted after ready: ${JSON.stringify(replayed.map((message) => message.type))}`);
            assert.strictEqual(progress[0].payload?.target, 'native');
          } finally {
            await fake.receive({ command: 'cancelInstallDependencies', requestId: 'cancel-1' });
            await until(() => !getOperationLock().active, 'the installation to end');
            await done;
          }

          const again = await fake.reopen();
          assert.deepStrictEqual(ofType(again, 'installDependenciesProgress'), [], 'no install progress is replayed once the run has ended');
        });
      }
    });

    type Pending = { run: sinon.SinonStub; finish: () => void };

    const palette: { name: string; commandId: string; type: string; begin: () => Pending }[] = [
      {
        name: 'packaging run',
        commandId: 'the-seed.packageProject',
        type: 'packageStatus',
        begin: () => {
          let finish: () => void = () => undefined;
          const run = sinon.stub(testTool().Package.prototype, 'run').callsFake(() => new Promise((resolve) => {
            finish = () => resolve({ success: false, message: 'stubbed packaging run', outputDir: '', projects: [], files: [], signatures: 0, fileCount: 0, notPackaged: [] });
          }) as never);
          return { run, finish: () => finish() };
        },
      },
      {
        name: 'installer run',
        commandId: 'the-seed.generateWindowsInstaller',
        type: 'installerStatus',
        begin: () => {
          let finish: () => void = () => undefined;
          const run = sinon.stub(testTool().Installer.prototype, 'run').callsFake(() => new Promise((resolve) => {
            finish = () => resolve({ ok: false, status: 1, message: 'stubbed installer run' });
          }) as never);
          return { run, finish: () => finish() };
        },
      },
    ];

    for (const { name, commandId, type, begin } of palette) {
      test(`a palette ${name} is replayed as running after ready, and not once it has ended`, async () => {
        sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
        sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);
        sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
        const pending = begin();
        const fake = await openSidebar();

        const running = vscode.commands.executeCommand(commandId);
        try {
          await until(() => pending.run.called, `the ${name} to start`);

          const replayed = await fake.reopen();

          assert.ok(ofType(replayed, type, 'running').length > 0, `the running ${name} is replayed after ready; posted after ready: ${JSON.stringify(replayed.map((message) => message.type))}`);
        } finally {
          pending.finish();
          await running;
        }

        const again = await fake.reopen();
        assert.deepStrictEqual(ofType(again, type), [], `no ${type} is replayed once the run has ended`);
      });
    }
  });

  suite('dependency checks when the sidebar opens', function () {
    this.timeout(60000);
    useScratchState();
    let probes: string[];
    let counted: TheSeedViewProvider;

    /**
     * The extension's service, except that the tool it hands out counts its library probes instead of
     * running pkg-config.
     */
    function countingService(): ToolService {
      const real = activeToolService();
      const api: ToolApi = Object.freeze({
        ...testTool(),
        checkLibEcs: (_config: Parameters<ToolApi['checkLibEcs']>[0], target: string) => {
          probes.push(`libecs-cpp ${target}`);
          return true;
        },
        checkLibTheSeed: (_config: Parameters<ToolApi['checkLibTheSeed']>[0], target: string) => {
          probes.push(`libthe-seed ${target}`);
          return false;
        },
      });
      return {
        get status() {
          return real.status;
        },
        onDidChangeStatus: real.onDidChangeStatus,
        acquire: async () => {
          const acquired = await real.acquire();
          return acquired.ok ? { ...acquired, api } : acquired;
        },
        check: (reason: Parameters<ToolService['check']>[0]) => real.check(reason),
      } as unknown as ToolService;
    }

    /** Lets work the provider started without being awaited finish: until `condition` holds or a second passes, then a little more. */
    async function settle(condition: () => boolean): Promise<void> {
      const deadline = Date.now() + 1000;
      while (!condition() && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    const dependencyTargets = (messages: Posted[]): string[] => messages
      .filter((message) => message.type === 'dependencyStatus')
      .map((message) => String(message.payload?.target))
      .sort();

    setup(() => {
      probes = [];
      counted = new TheSeedViewProvider(vscode.Uri.file('/test/extension'), countingService());
    });

    teardown(() => {
      counted.dispose();
    });

    test('the first ready probes each library once for each target and posts both statuses', async () => {
      const fake = fakeView(counted);

      await fake.receive({ command: 'ready' });
      await settle(() => probes.length >= 4);

      assert.deepStrictEqual([...probes].sort(), [
        'libecs-cpp native',
        'libecs-cpp windows',
        'libthe-seed native',
        'libthe-seed windows',
      ]);
      assert.deepStrictEqual(dependencyTargets(fake.posted), ['native', 'windows']);
    });

    test('a reopened sidebar probes nothing and is sent the status of both targets', async () => {
      const fake = fakeView(counted);
      await fake.receive({ command: 'ready' });
      await settle(() => probes.length >= 4);
      const before = probes.length;

      const replayed = await fake.reopen();
      await settle(() => false);

      assert.deepStrictEqual(probes.slice(before), [], 'no library is probed on a reopen');
      assert.deepStrictEqual(dependencyTargets(replayed), ['native', 'windows']);
    });

    test('Check for windows in the sidebar probes both libraries for windows', async () => {
      const fake = fakeView(counted);
      await fake.receive({ command: 'ready' });
      await settle(() => probes.length >= 4);
      const before = probes.length;

      await fake.receive({ command: 'checkDependencies', requestId: 'check-windows', data: { target: 'windows' } });

      assert.deepStrictEqual(probes.slice(before).sort(), ['libecs-cpp windows', 'libthe-seed windows']);
      const answer = fake.posted.find((message) => message.requestId === 'check-windows');
      assert.strictEqual(answer?.type, 'dependencyStatus');
    });
  });
});
