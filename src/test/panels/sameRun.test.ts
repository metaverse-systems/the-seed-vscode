// A run started from the sidebar is the run started from the command palette:
// the same output panel lines, notifications and sidebar posts, compared
// through the extension's own view provider resolved on a fake view.
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { acquireOperationLock, getOperationLock } from '../../operationLock';
import { activeViewProvider } from '../../panels/TheSeedViewProvider';
import { requires } from '../harness/platform';
import { FAILING_STDERR, FAILING_STDOUT, useFakeGit } from '../helpers/fakeGit';
import { fakeView, until } from '../helpers/fakeView';
import type { FakeView, Posted } from '../helpers/fakeView';
import { assertSameRun, normalise, panelText, recordOperation } from '../helpers/operationRecorder';
import type { Recorder, Recording } from '../helpers/operationRecorder';
import { useScratchState } from '../helpers/scratchState';
import { testTool } from '../helpers/tool';

const NO_PREFIX = 'No prefix configured. Run "The Seed: Configure Project" first.';
const GIT_NOT_FOUND = 'git not found. Please install git to install dependencies.';
const PACKAGING_HOLDS = 'Cannot install dependencies while a packaging operation is in progress.';

suite('Sidebar and palette give the same run: dependency installation', function () {
  this.timeout(60000);
  requires('posix-toolchain');
  const state = useScratchState({ workspaceFolders: 1 });
  const git = useFakeGit();
  let recorder: Recorder;
  let pick: sinon.SinonStub;

  setup(() => {
    recorder = recordOperation();
    pick = sinon.stub(vscode.window, 'showQuickPick').resolves({ label: 'native' } as vscode.QuickPickItem);
  });

  interface SidebarRun {
    recording: Recording;
    /** What the provider answered the sidebar's own request with, outside `postMessage`. */
    replies: Posted[];
    picks: number;
  }

  function sidebar(): FakeView {
    const provider = activeViewProvider();
    assert.ok(provider, "the extension's view provider exists");
    return fakeView(provider);
  }

  /** Sends the sidebar's `installDependencies` message and waits for the fired command's outcome. */
  async function fromSidebar(target: 'native' | 'windows' = 'native'): Promise<SidebarRun> {
    const fake = sidebar();
    recorder.take();
    const picks = pick.callCount;
    await fake.receive({ command: 'installDependencies', requestId: 'install-1', data: { target } });
    await recorder.outcome();
    return {
      recording: recorder.take(),
      replies: fake.posted.filter((message) => message.requestId === 'install-1'),
      picks: pick.callCount - picks,
    };
  }

  /** Runs the palette command, answering its target prompt with `native` through the stubbed quick pick. */
  async function fromPalette(): Promise<{ recording: Recording; picks: number }> {
    recorder.take();
    const picks = pick.callCount;
    await vscode.commands.executeCommand('the-seed.installDependencies');
    return { recording: recorder.take(), picks: pick.callCount - picks };
  }

  /** Runs both starts and asserts that they showed the same thing; returns the palette's recording. */
  async function compare(paletteAsks: boolean): Promise<Recording> {
    const side = await fromSidebar();
    const palette = await fromPalette();
    assert.deepStrictEqual(side.replies, [], 'the sidebar gets no direct reply of its own (no error reply)');
    assert.strictEqual(side.picks, 0, 'the sidebar start asks nothing');
    assert.strictEqual(palette.picks, paletteAsks ? 1 : 0, paletteAsks ? 'the palette start asks for the target once' : 'the palette start asks nothing');
    assertSameRun(side.recording, palette.recording);
    return palette.recording;
  }

  const shown = (recording: Recording, kind: string): string[] =>
    recording.notifications.filter((entry) => entry.kind === kind).map((entry) => (entry as { text: string }).text);
  const types = (recording: Recording): string[] => (recording.sidebar as Posted[]).map((message) =>
    message.type === 'installDependenciesProgress' ? `${message.type}:${String(message.payload?.state)}` : message.type);

  test('a failing step: both show the step\'s output, the step it failed at and the same sidebar states', async () => {
    git.failing();

    const palette = await compare(true);

    const panel = panelText(palette);
    assert.ok(panel.includes(FAILING_STDOUT), "the panel holds git's stdout line");
    assert.ok(panel.includes(FAILING_STDERR), "the panel holds git's stderr line");
    assert.ok(panel.includes('── Installation failed at clone libecs-cpp: '), 'the panel names the failed step');
    assert.deepStrictEqual(shown(palette, 'error'), ['Dependency installation failed at clone libecs-cpp. Check output for details.']);
    assert.deepStrictEqual(types(palette), [
      'installDependenciesStarted',
      'installDependenciesProgress:running',
      'installDependenciesProgress:failed',
      'dependencyStatus',
    ]);
    assert.strictEqual(getOperationLock().active, false, 'the lock is free afterwards');
  });

  test('a successful installation: both complete, then post the refreshed dependency status', async () => {
    git.succeeding();

    const palette = await compare(true);

    assert.deepStrictEqual(shown(palette, 'info'), ['Dependencies installed successfully.']);
    assert.ok(panelText(palette).includes('── Installation completed successfully ──'));
    const sequence = types(palette);
    assert.strictEqual(sequence[0], 'installDependenciesStarted');
    assert.deepStrictEqual(sequence.slice(-2), ['installDependenciesProgress:completed', 'dependencyStatus']);
    assert.strictEqual(sequence.filter((type) => type === 'installDependenciesProgress:running').length, 10, 'one running state per step');
  });

  test('nothing missing: both say so and run nothing', async () => {
    git.failing();
    git.provideLibraries();

    const palette = await compare(true);

    assert.deepStrictEqual(normalise(palette), {
      panel: [],
      notifications: [{ kind: 'info', text: 'All dependencies are already installed for native.' }],
      sidebar: [],
    });
  });

  test('git absent: both show the same error and run nothing', async () => {
    git.absent();

    const palette = await compare(false);

    assert.deepStrictEqual(normalise(palette), { panel: [], notifications: [{ kind: 'error', text: GIT_NOT_FOUND }], sidebar: [] });
  });

  test('the lock held by packaging: both show the same warning naming packaging and leave the lock as it was', async () => {
    git.failing();
    const held = acquireOperationLock('package');
    assert.ok(held.success, 'the case holds the lock');

    const palette = await compare(false);

    assert.deepStrictEqual(normalise(palette), { panel: [], notifications: [{ kind: 'warning', text: PACKAGING_HOLDS }], sidebar: [] });
    assert.strictEqual(getOperationLock().type, 'package', 'the holder is unchanged');
    assert.strictEqual(getOperationLock().abortController, held.abortController, 'the abort controller is unchanged');
  });

  suite('edge cases', () => {
    test('a sidebar start while a palette packaging run holds the lock is refused with the palette\'s text and leaves the packaging run alone', async () => {
      git.failing();
      let finish: (result: unknown) => void = () => undefined;
      const run = sinon.stub(testTool().Package.prototype, 'run').callsFake(() => new Promise((resolve) => { finish = resolve; }) as never);
      const packaging = vscode.commands.executeCommand('the-seed.packageProject');
      try {
        await until(() => run.called, 'the packaging run to start');
        const controller = getOperationLock().abortController;
        assert.strictEqual(getOperationLock().type, 'package', 'packaging holds the lock');

        const side = await fromSidebar();

        assert.deepStrictEqual(side.replies, [], 'the sidebar gets no direct reply of its own (no error reply)');
        assert.deepStrictEqual(side.recording.notifications, [{ kind: 'warning', text: PACKAGING_HOLDS }]);
        assert.deepStrictEqual(side.recording.panel, [], 'nothing is written to the panel');
        assert.deepStrictEqual(side.recording.sidebar, [], 'no install is shown running and the packaging state is not touched');
        assert.strictEqual(getOperationLock().type, 'package', 'packaging still holds the lock');
        assert.strictEqual(getOperationLock().abortController, controller, 'the holder is the same packaging run');
        assert.strictEqual(run.callCount, 1, 'the packaging run is still the one running');
      } finally {
        finish({ success: false, message: 'stubbed packaging run', outputDir: '', projects: [], files: [], signatures: 0, fileCount: 0, notPackaged: [] });
        await packaging;
      }
      assert.strictEqual(getOperationLock().active, false, 'the lock is free after packaging ends');
    });

    test('a sidebar start with no folder open runs as the palette does', async () => {
      git.failing();
      state.setWorkspaceFolders([]);

      const palette = await compare(true);

      assert.deepStrictEqual(shown(palette, 'error'), ['Dependency installation failed at clone libecs-cpp. Check output for details.']);
      assert.strictEqual(getOperationLock().active, false, 'the lock is free afterwards');
    });

    test('a sidebar start with no prefix gives the palette\'s refusal', async () => {
      git.failing();
      sinon.stub(testTool().Config.prototype, 'loadConfig').callsFake(function (this: { config: { prefix: string } }) {
        this.config.prefix = '';
      });

      const palette = await compare(false);

      assert.deepStrictEqual(normalise(palette), { panel: [], notifications: [{ kind: 'error', text: NO_PREFIX }], sidebar: [] });
      assert.strictEqual(getOperationLock().active, false, 'the lock is free');
    });
  });
});
