// A run started from the sidebar is the run started from the command palette:
// the same output panel lines, notifications and sidebar posts, compared
// through the extension's own view provider resolved on a fake view.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import type { ProjectBuildOptions } from '@metaverse-systems/the-seed/types';
import { NO_BUILDABLE_PROJECT } from '../../build/buildStart';
import { acquireOperationLock, getOperationLock, lockRefusal } from '../../operationLock';
import type { OperationType } from '../../operationLock';
import { activeViewProvider } from '../../panels/TheSeedViewProvider';
import { requires } from '../harness/platform';
import { FAILING_STDERR, FAILING_STDOUT, useFakeGit } from '../helpers/fakeGit';
import { fakeView, until } from '../helpers/fakeView';
import type { FakeView, Posted } from '../helpers/fakeView';
import { assertSameRun, normalise, panelText, recordOperation } from '../helpers/operationRecorder';
import type { Recorder, Recording } from '../helpers/operationRecorder';
import { createCertFor } from '../helpers/scratchHome';
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

// ── The other operations ─────────────────────────────────────────────────────

const DEBUG = { label: 'Debug' } as vscode.QuickPickItem;
const NO_WORKSPACE = 'No workspace folder open. Open a project folder first.';
const SCOPE = '@only';

interface Start {
  recording: Recording;
  /** What the provider answered the sidebar's own request with, outside `postMessage`; empty for the palette. */
  replies: Posted[];
  /** How many prompts (quick picks, input boxes, file dialogs) the start showed. */
  prompts: number;
}

/** The prompts a case answers with stubs; their call counts are what a start asked. */
interface Prompts {
  count(): number;
}

/** Stubs every kind of prompt: quick picks with `pick`, input boxes with `input`, file dialogs with `open` and `save`. */
function stubPrompts(answers: { pick?: unknown; input?: string; open?: (string | undefined)[]; save?: string } = {}): Prompts {
  const pick = sinon.stub(vscode.window, 'showQuickPick').resolves(answers.pick as vscode.QuickPickItem | undefined);
  const input = sinon.stub(vscode.window, 'showInputBox').resolves(answers.input);
  const open = sinon.stub(vscode.window, 'showOpenDialog');
  const files = answers.open ?? [];
  open.callsFake(async () => {
    const file = files[(open.callCount - 1) % Math.max(files.length, 1)];
    return file === undefined ? undefined : [vscode.Uri.file(file)];
  });
  const save = sinon.stub(vscode.window, 'showSaveDialog').resolves(answers.save === undefined ? undefined : vscode.Uri.file(answers.save));
  return { count: () => pick.callCount + input.callCount + open.callCount + save.callCount };
}

/**
 * Waits until an information, warning or error message has been shown and the
 * lock is held as it was before the start (free after a run, still the case's
 * holder after a refusal), then a little longer for the last posts.
 */
async function settled(recorder: Recorder, before: OperationType | null, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const shown = (): boolean => recorder.notifications.some((entry) => entry.kind === 'info' || entry.kind === 'warning' || entry.kind === 'error');
  while (!shown() || getOperationLock().type !== before) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for the operation's outcome; recorded so far: ${JSON.stringify({ panel: recorder.panel, notifications: recorder.notifications, sidebar: recorder.sidebar })}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}

function sidebarView(): FakeView {
  const provider = activeViewProvider();
  assert.ok(provider, "the extension's view provider exists");
  return fakeView(provider);
}

/** Sends a sidebar message on the extension's own provider and waits for the operation it starts to end or be refused. */
async function startFromSidebar(recorder: Recorder, prompts: Prompts, message: { command: string; data?: object }): Promise<Start> {
  const fake = sidebarView();
  recorder.take();
  const asked = prompts.count();
  const before = getOperationLock().type;
  await fake.receive({ ...message, requestId: 'side-1' });
  await settled(recorder, before);
  return {
    recording: recorder.take(),
    replies: fake.posted.filter((posted) => posted.requestId === 'side-1'),
    prompts: prompts.count() - asked,
  };
}

/** Runs a palette command with the same stubs. */
async function startFromPalette(recorder: Recorder, prompts: Prompts, commandId: string): Promise<Start> {
  recorder.take();
  const asked = prompts.count();
  await vscode.commands.executeCommand(commandId);
  return { recording: recorder.take(), replies: [], prompts: prompts.count() - asked };
}

const replyTypes = (start: Start): string[] => start.replies.map((reply) => reply.type);
const shownOf = (recording: Recording, kind: string): string[] =>
  recording.notifications.filter((entry) => entry.kind === kind).map((entry) => (entry as { text: string }).text);
const postedTypes = (recording: Recording): string[] => (recording.sidebar as Posted[]).map((message) => {
  const state = (message.payload as { state?: unknown } | undefined)?.state;
  return state === undefined ? message.type : `${message.type}:${String(state)}`;
});

/** Writes a buildable project into `folder` (found by the project search through a stubbed `findFiles`) and returns its directory. */
function writeBuildableProject(folder: string, name = 'game'): string {
  const dir = path.join(folder, name);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: `@test/${name}`, version: '0.1.0', scripts: { build: 'the-seed build native' } }));
  fs.writeFileSync(path.join(dir, 'src', 'Makefile.am'), `bin_PROGRAMS = ${name}\n`);
  sinon.stub(vscode.workspace, 'findFiles').resolves([vscode.Uri.file(path.join(dir, 'package.json'))]);
  return dir;
}

type BuildOutcome = { status: 'completed' } | { status: 'failed'; step: string; message: string };

/** A `buildProject` that writes a step's progress, output and log lines through the options it is given, then returns `outcome`. */
function stubBuildProject(outcome: BuildOutcome): sinon.SinonStub {
  return sinon.stub(testTool().Build.prototype, 'buildProject').callsFake(async (options: ProjectBuildOptions) => {
    options.onStepStart?.({ label: 'compile', program: 'make', args: ['-j4'] }, 0, 2);
    options.log?.('==> compile: make -j4');
    options.output?.stdout(Buffer.from('compiling game.cpp\n'));
    options.output?.stderr(Buffer.from('game.cpp:3: warning: unused variable\n'));
    options.onStepStart?.({ label: 'install', program: 'make', args: ['install'] }, 1, 2);
    options.log?.('==> install: make install');
    return outcome as never;
  });
}

/** A `buildProject` that reports its first step and then waits until its signal is aborted. */
function stubWaitingBuild(): sinon.SinonStub {
  return sinon.stub(testTool().Build.prototype, 'buildProject').callsFake((options: ProjectBuildOptions) => new Promise((resolve) => {
    options.onStepStart?.({ label: 'compile', program: 'make', args: ['-j4'] }, 0, 1);
    const signal = options.signal;
    if (!signal) {
      return;
    }
    if (signal.aborted) {
      resolve({ status: 'cancelled' } as never);
      return;
    }
    signal.addEventListener('abort', () => resolve({ status: 'cancelled' } as never), { once: true });
  }));
}

const packageResult = (success: boolean, message: string | null, files: string[] = []) => ({
  success,
  message,
  outputDir: '',
  projects: [],
  files,
  signatures: 0,
  fileCount: files.length,
  notPackaged: [],
});

suite('Sidebar and palette give the same run: builds', function () {
  this.timeout(60000);
  const state = useScratchState({ workspaceFolders: 1 });
  let recorder: Recorder;
  let prompts: Prompts;

  setup(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    recorder = recordOperation();
    prompts = stubPrompts({ pick: DEBUG });
  });

  /** Both starts, compared; each asks the build mode once and the sidebar is acknowledged with `buildStarted`. */
  async function compare(command: string, data: object, commandId: string): Promise<Recording> {
    const side = await startFromSidebar(recorder, prompts, { command, data });
    const palette = await startFromPalette(recorder, prompts, commandId);
    assert.deepStrictEqual(replyTypes(side), ['buildStarted'], 'the sidebar is acknowledged and gets no error reply');
    assert.strictEqual(side.prompts, 1, 'the sidebar start asks the build mode once');
    assert.strictEqual(palette.prompts, 1, 'the palette start asks the build mode once');
    assertSameRun(side.recording, palette.recording);
    assert.strictEqual(getOperationLock().active, false, 'the lock is free afterwards');
    return palette.recording;
  }

  const plain: { name: string; target: string; commandId: string; label: string }[] = [
    { name: 'native', target: 'native', commandId: 'the-seed.buildNative', label: 'native' },
    { name: 'windows', target: 'windows', commandId: 'the-seed.buildWindows', label: 'windows' },
    { name: 'incremental', target: 'incremental', commandId: 'the-seed.buildIncremental', label: 'incremental' },
  ];

  for (const { name, target, commandId, label } of plain) {
    test(`build ${name}: both show the build's output, progress and states`, async () => {
      writeBuildableProject(state.workspaceFolders[0]);
      const build = stubBuildProject({ status: 'completed' });

      const palette = await compare('startBuild', { target }, commandId);

      assert.strictEqual(build.callCount, 2, 'each start built once');
      const panel = panelText(palette);
      assert.ok(panel.includes('compiling game.cpp'), "the panel holds the step's stdout");
      assert.ok(panel.includes('game.cpp:3: warning: unused variable'), "the panel holds the step's stderr");
      assert.ok(panel.includes('==> install: make install\n'), "the panel holds the tool's log lines");
      assert.deepStrictEqual(shownOf(palette, 'info'), ['Build succeeded.']);
      assert.deepStrictEqual(postedTypes(palette), ['buildStatus:running', 'buildStatus:running', 'buildStatus:completed']);
      assert.ok(palette.notifications.some((entry) => entry.kind === 'progress' && entry.title === `Building ${label}`), 'the progress notification names the build');
    });
  }

  test('a failing build: both show the failed step the same way', async () => {
    writeBuildableProject(state.workspaceFolders[0]);
    stubBuildProject({ status: 'failed', step: 'compile', message: 'make exited with status 2' });

    const palette = await compare('startBuild', { target: 'native' }, 'the-seed.buildNative');

    assert.deepStrictEqual(shownOf(palette, 'error'), ['Build failed at compile: make exited with status 2.']);
    assert.ok(panelText(palette).includes('── Build failed at compile: make exited with status 2. ──'));
    assert.deepStrictEqual(postedTypes(palette).slice(-1), ['buildStatus:failed']);
  });

  suite('recursive', () => {
    requires('posix-toolchain');

    /** A project whose only dependency-free build fails at once in a fake `autogen.sh`. */
    function writeFailingProject(): void {
      const dir = writeBuildableProject(state.workspaceFolders[0]);
      const autogen = path.join(dir, 'autogen.sh');
      fs.writeFileSync(autogen, '#!/bin/sh\necho "autogen: stubbed for the comparison"\necho "autogen: giving up"\nexit 1\n');
      fs.chmodSync(autogen, 0o755);
    }

    async function compareRecursive(target: 'native' | 'windows', commandId: string): Promise<void> {
      writeFailingProject();

      const palette = await compare('startRecursiveBuild', { target }, commandId);

      assert.deepStrictEqual(shownOf(palette, 'error'), ['Recursive build failed on @test/game. Check output for details.']);
      const panel = panelText(palette);
      assert.ok(panel.includes('── [1/1] @test/game ──'), 'the panel names the project');
      assert.ok(panel.includes('autogen: giving up'), "the panel holds the failed step's output");
      assert.deepStrictEqual(postedTypes(palette), [
        'buildStatus:running',
        'buildStatus:running',
        'recursiveBuildProgress',
        'buildStatus:failed',
        'recursiveBuildComplete',
      ]);
    }

    test('recursive native: both stop at the same failed step', async () => {
      await compareRecursive('native', 'the-seed.buildNativeRecursive');
    });

    suite('windows', () => {
      requires('native-component');

      test('recursive windows: both stop at the same failed step', async () => {
        await compareRecursive('windows', 'the-seed.buildWindowsRecursive');
      });
    });
  });
});

suite('Sidebar and palette give the same run: packaging and the installer', function () {
  this.timeout(60000);
  useScratchState({ workspaceFolders: 1 });
  let recorder: Recorder;
  let prompts: Prompts;

  setup(() => {
    recorder = recordOperation();
    prompts = stubPrompts();
  });

  async function compare(command: string, commandId: string, reply: string[]): Promise<Recording> {
    const side = await startFromSidebar(recorder, prompts, { command });
    const palette = await startFromPalette(recorder, prompts, commandId);
    assert.deepStrictEqual(replyTypes(side), reply, 'the sidebar\'s direct reply');
    assert.strictEqual(side.prompts + palette.prompts, 0, 'neither start asks anything');
    assertSameRun(side.recording, palette.recording);
    assert.strictEqual(getOperationLock().active, false, 'the lock is free afterwards');
    return palette.recording;
  }

  /** A packaging run that writes its progress with `console.log`, as the tool does before it takes a log option. */
  function stubPackageRun(result: ReturnType<typeof packageResult>): sinon.SinonStub {
    return sinon.stub(testTool().Package.prototype, 'run').callsFake(async () => {
      console.log('Copying game...');
      return result as never;
    });
  }

  test('a successful packaging run: both show the same result', async () => {
    const run = stubPackageRun(packageResult(true, null, ['game', 'libengine.so.1']));

    const palette = await compare('startPackage', 'the-seed.packageProject', ['packageStarted']);

    assert.strictEqual(run.callCount, 2, 'each start packaged once');
    assert.deepStrictEqual(shownOf(palette, 'info'), ['Packaged 2 files into dist/']);
    assert.ok(panelText(palette).includes('── Packaged 2 files into dist/ ──'));
    assert.deepStrictEqual(postedTypes(palette), ['packageStatus:running', 'packageStatus:completed']);
  });

  test('a refused packaging run: both show the same refusal', async () => {
    stubPackageRun(packageResult(false, 'No buildable projects found.\nSecond line of the refusal'));

    const palette = await compare('startPackage', 'the-seed.packageProject', ['packageStarted']);

    assert.deepStrictEqual(shownOf(palette, 'error'), ['Packaging failed: No buildable projects found.']);
    assert.ok(panelText(palette).includes('── Packaging failed ──\nNo buildable projects found.\nSecond line of the refusal\n'));
    assert.deepStrictEqual(postedTypes(palette), ['packageStatus:running', 'packageStatus:failed']);
  });

  function stubInstallerRun(result: { ok: true; msiPath: string } | { ok: false; status: 1 | 2; message: string }): sinon.SinonStub {
    return sinon.stub(testTool().Installer.prototype, 'run').callsFake(async () => {
      console.log('Generating installer...');
      return result as never;
    });
  }

  test('a generated installer: both show the same result', async () => {
    const run = stubInstallerRun({ ok: true, msiPath: '/nowhere/game.msi' });

    const palette = await compare('generateInstaller', 'the-seed.generateWindowsInstaller', []);

    assert.strictEqual(run.callCount, 2, 'each start generated once');
    assert.deepStrictEqual(shownOf(palette, 'info'), ['Windows installer generated successfully.']);
    assert.deepStrictEqual(postedTypes(palette), ['installerStatus:running', 'installerStatus:completed']);
  });

  test('a failed installer: both show the same failure', async () => {
    stubInstallerRun({ ok: false, status: 1, message: 'wixl failed: stubbed' });

    const palette = await compare('generateInstaller', 'the-seed.generateWindowsInstaller', []);

    assert.deepStrictEqual(shownOf(palette, 'error'), ['wixl failed: stubbed']);
    assert.ok(panelText(palette).includes('── Installer generation failed ──'));
    assert.deepStrictEqual(postedTypes(palette), ['installerStatus:running', 'installerStatus:failed']);
  });
});

suite('Sidebar and palette give the same run: signing certificates', function () {
  this.timeout(60000);
  const state = useScratchState({ scopes: { [SCOPE]: 'Only Author' } });
  let recorder: Recorder;

  setup(() => {
    recorder = recordOperation();
  });

  function signing(): InstanceType<ReturnType<typeof testTool>['Signing']> {
    return new (testTool().Signing)();
  }

  function removeCertificate(): void {
    fs.rmSync(path.dirname(signing().scopeCertPath(SCOPE)), { recursive: true, force: true });
  }

  /**
   * Both starts with the same prompt answers; `between` runs after the sidebar's,
   * to put things back as they were. The sidebar's message is answered with nothing.
   */
  async function compare(command: string, commandId: string, prompts: Prompts, between: () => void = () => undefined): Promise<{ side: Recording; palette: Recording }> {
    const side = await startFromSidebar(recorder, prompts, { command });
    between();
    const palette = await startFromPalette(recorder, prompts, commandId);
    assert.deepStrictEqual(side.replies, [], 'the sidebar gets no direct reply');
    assert.strictEqual(side.prompts, palette.prompts, 'both starts ask the same prompts');
    return { side: side.recording, palette: palette.recording };
  }

  test('create: both create the certificate and show it the same way', async () => {
    const prompts = stubPrompts({ input: '30' });
    const fingerprints: string[] = [];
    const { side, palette } = await compare('createSigningCert', 'the-seed.createSigningCert', prompts, () => {
      fingerprints.push(signing().getCertInfo(SCOPE)?.fingerprint ?? '');
      removeCertificate();
    });
    fingerprints.push(signing().getCertInfo(SCOPE)?.fingerprint ?? '');

    // Each run makes a new key, so each run's fingerprint stands for itself.
    const withoutFingerprint = (recording: Recording, fingerprint: string): Recording => {
      assert.ok(fingerprint, 'a certificate was created');
      return JSON.parse(JSON.stringify(normalise(recording)).split(fingerprint).join('<fingerprint>')) as Recording;
    };
    const sideShown = withoutFingerprint(side, fingerprints[0]);
    const paletteShown = withoutFingerprint(palette, fingerprints[1]);
    assert.deepStrictEqual(sideShown, paletteShown);
    assert.deepStrictEqual(paletteShown, {
      panel: ['[<time>] Signing certificate created: <fingerprint>\n'],
      notifications: [{ kind: 'info', text: 'Signing certificate created. Fingerprint: <fingerprint>' }],
      sidebar: [],
    });
    assert.strictEqual(prompts.count(), 2, 'each start asked the validity once');
  });

  test('import: both import the same certificate and show it the same way', async () => {
    await createCertFor(SCOPE);
    const dir = state.dir('certificate');
    const cert = path.join(dir, 'cert.pem');
    const key = path.join(dir, 'key.pem');
    fs.copyFileSync(signing().scopeCertPath(SCOPE), cert);
    fs.copyFileSync(signing().scopeKeyPath(SCOPE), key);
    removeCertificate();
    const prompts = stubPrompts({ open: [cert, key] });

    const { side, palette } = await compare('importSigningCert', 'the-seed.importSigningCert', prompts, removeCertificate);

    assertSameRun(side, palette);
    const shown = shownOf(palette, 'info');
    assert.strictEqual(shown.length, 1);
    assert.ok(shown[0].startsWith('Certificate imported. Subject: '), `got: ${shown[0]}`);
    assert.strictEqual(prompts.count(), 4, 'each start asked for the certificate and the key');
  });

  test('info with a certificate: both show the same details', async () => {
    const fingerprint = await createCertFor(SCOPE);
    const prompts = stubPrompts();

    const { side, palette } = await compare('signingCertInfo', 'the-seed.signingCertInfo', prompts);

    assertSameRun(side, palette);
    const shown = shownOf(palette, 'info');
    assert.strictEqual(shown.length, 1);
    assert.ok(shown[0].endsWith(`| Status: Active | Fingerprint: ${fingerprint}`), `got: ${shown[0]}`);
  });

  test('info without a certificate: both offer the same choices', async () => {
    const prompts = stubPrompts();

    const { side, palette } = await compare('signingCertInfo', 'the-seed.signingCertInfo', prompts);

    assertSameRun(side, palette);
    assert.deepStrictEqual(shownOf(palette, 'info'), ['No signing certificate found.']);
  });

  test('export: both write the certificate to the chosen path', async () => {
    await createCertFor(SCOPE);
    const target = path.join(state.dir('export'), 'exported.pem');
    const prompts = stubPrompts({ save: target });

    const { side, palette } = await compare('exportSigningCert', 'the-seed.exportSigningCert', prompts, () => {
      assert.ok(fs.readFileSync(target, 'utf-8').includes('BEGIN CERTIFICATE'), 'the sidebar start wrote the certificate');
      fs.rmSync(target);
    });

    assertSameRun(side, palette);
    assert.ok(fs.readFileSync(target, 'utf-8').includes('BEGIN CERTIFICATE'), 'the palette start wrote the certificate');
    assert.deepStrictEqual(shownOf(palette, 'info'), [`Certificate exported to ${target}`]);
  });

  test('export without a certificate: both give the same error', async () => {
    const prompts = stubPrompts();

    const { side, palette } = await compare('exportSigningCert', 'the-seed.exportSigningCert', prompts);

    assertSameRun(side, palette);
    assert.deepStrictEqual(shownOf(palette, 'error'), [`No signing certificate for scope ${SCOPE}.`]);
  });
});

suite('Sidebar and palette give the same run: edge cases', function () {
  this.timeout(60000);
  const state = useScratchState({ workspaceFolders: 1 });
  let recorder: Recorder;
  let prompts: Prompts;

  setup(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    recorder = recordOperation();
    prompts = stubPrompts({ pick: DEBUG });
  });

  interface LongOperation {
    operation: OperationType;
    command: string;
    data?: object;
    commandId: string;
    reply: string[];
  }

  const OPERATIONS: LongOperation[] = [
    { operation: 'build', command: 'startBuild', data: { target: 'native' }, commandId: 'the-seed.buildNative', reply: ['buildStarted'] },
    { operation: 'build', command: 'startRecursiveBuild', data: { target: 'native' }, commandId: 'the-seed.buildNativeRecursive', reply: ['buildStarted'] },
    { operation: 'package', command: 'startPackage', commandId: 'the-seed.packageProject', reply: ['packageStarted'] },
    { operation: 'installer', command: 'generateInstaller', commandId: 'the-seed.generateWindowsInstaller', reply: [] },
  ];
  const INSTALL: LongOperation = { operation: 'install', command: 'installDependencies', data: { target: 'native' }, commandId: 'the-seed.installDependencies', reply: [] };

  /** Both starts while `holder` holds the lock: the same warning, the reply of `expected`, and the holder untouched. */
  async function compareRefused(start: LongOperation, holder: OperationType): Promise<void> {
    const lock = getOperationLock();
    assert.strictEqual(lock.type, holder, `${holder} holds the lock`);
    const controller = lock.abortController;

    const side = await startFromSidebar(recorder, prompts, { command: start.command, data: start.data });
    const palette = await startFromPalette(recorder, prompts, start.commandId);

    assert.deepStrictEqual(replyTypes(side), start.reply, 'the sidebar\'s reply is its acknowledgement, never an error reply');
    assert.strictEqual(side.prompts + palette.prompts, 0, 'nothing is asked');
    assertSameRun(side.recording, palette.recording);
    assert.deepStrictEqual(normalise(palette.recording), {
      panel: [],
      notifications: [{ kind: 'warning', text: lockRefusal(start.operation, holder) }],
      sidebar: [],
    });
    assert.strictEqual(getOperationLock().type, holder, 'the holder is unchanged');
    assert.strictEqual(getOperationLock().abortController, controller, 'the abort controller is unchanged');
  }

  suite('already running', () => {
    for (const start of OPERATIONS) {
      test(`a sidebar start of ${start.command} while the same operation runs gives the palette's warning`, async () => {
        assert.ok(acquireOperationLock(start.operation).success, 'the case holds the lock');

        await compareRefused(start, start.operation);
      });
    }

    suite('dependency installation', () => {
      requires('posix-toolchain');
      const git = useFakeGit();

      test('a sidebar start of installDependencies while an installation runs gives the palette\'s warning', async () => {
        git.failing();
        assert.ok(acquireOperationLock('install').success, 'the case holds the lock');

        await compareRefused(INSTALL, 'install');
      });
    });
  });

  suite('another operation running', () => {
    /** Starts a palette build that waits on its signal; resolves once it has posted its running state. */
    async function runningBuild(): Promise<{ done: Thenable<unknown>; running: Posted }> {
      writeBuildableProject(state.workspaceFolders[0]);
      const build = stubWaitingBuild();
      const done = vscode.commands.executeCommand('the-seed.buildNative');
      await until(() => build.called && recorder.sidebar.length > 0, 'the build to start');
      const running = recorder.sidebar[recorder.sidebar.length - 1] as Posted;
      assert.strictEqual(running.type, 'buildStatus');
      return { done, running };
    }

    /** The sidebar's state of the running operation: what the provider replays when the sidebar is reopened. */
    async function replayed(type: string): Promise<Posted[]> {
      const posts = await sidebarView().reopen();
      return posts.filter((posted) => posted.type === type);
    }

    function stopBuild(): void {
      getOperationLock().abortController?.abort();
    }

    for (const start of OPERATIONS.filter((operation) => operation.operation !== 'build')) {
      test(`a sidebar start of ${start.command} while a build runs is refused and leaves the build's sidebar state alone`, async () => {
        const { done, running } = await runningBuild();
        try {
          await compareRefused(start, 'build');

          assert.deepStrictEqual(await replayed('buildStatus'), [running], "the build's sidebar state is the one it posted");
        } finally {
          stopBuild();
          await done;
        }
        assert.strictEqual(getOperationLock().active, false, 'the lock is free after the build ends');
      });
    }

    suite('dependency installation', () => {
      requires('posix-toolchain');
      const git = useFakeGit();

      test('a sidebar start of installDependencies while a build runs is refused and leaves the build\'s sidebar state alone', async () => {
        git.failing();
        const { done, running } = await runningBuild();
        try {
          await compareRefused(INSTALL, 'build');

          assert.deepStrictEqual(await replayed('buildStatus'), [running], "the build's sidebar state is the one it posted");
        } finally {
          stopBuild();
          await done;
        }
      });
    });

    test('a sidebar start of startBuild while packaging runs is refused and leaves the packaging state alone', async () => {
      let finish: (result: unknown) => void = () => undefined;
      const run = sinon.stub(testTool().Package.prototype, 'run').callsFake(() => new Promise((resolve) => { finish = resolve; }) as never);
      const packaging = vscode.commands.executeCommand('the-seed.packageProject');
      try {
        await until(() => run.called, 'the packaging run to start');
        const running = (recorder.sidebar as Posted[]).filter((posted) => posted.type === 'packageStatus');
        assert.deepStrictEqual(running.map((posted) => posted.payload?.state), ['running']);

        await compareRefused(OPERATIONS[0], 'package');

        assert.deepStrictEqual(await replayed('packageStatus'), running, 'the packaging state is the one it posted');
      } finally {
        finish(packageResult(false, 'stubbed packaging run'));
        await packaging;
      }
      assert.strictEqual(getOperationLock().active, false, 'the lock is free after packaging ends');
    });
  });

  suite('no folder open', () => {
    setup(() => {
      state.setWorkspaceFolders([]);
    });

    for (const { command, commandId, reply } of [
      { command: 'startPackage', commandId: 'the-seed.packageProject', reply: ['packageStarted'] },
      { command: 'generateInstaller', commandId: 'the-seed.generateWindowsInstaller', reply: [] },
    ]) {
      test(`a sidebar start of ${command} gives the palette's no-project message and leaves the lock free`, async () => {
        const side = await startFromSidebar(recorder, prompts, { command });
        const palette = await startFromPalette(recorder, prompts, commandId);

        assert.deepStrictEqual(replyTypes(side), reply);
        assertSameRun(side.recording, palette.recording);
        assert.deepStrictEqual(normalise(palette.recording), { panel: [], notifications: [{ kind: 'error', text: NO_WORKSPACE }], sidebar: [] });
        assert.strictEqual(getOperationLock().active, false, 'the lock is free');
      });
    }

    test('a sidebar build start gives the palette\'s no-buildable-project message and leaves the lock free', async () => {
      const side = await startFromSidebar(recorder, prompts, { command: 'startBuild', data: { target: 'native' } });
      const palette = await startFromPalette(recorder, prompts, 'the-seed.buildNative');

      assert.deepStrictEqual(replyTypes(side), ['buildStarted']);
      assert.strictEqual(side.prompts, 1, 'the build mode is asked');
      assert.strictEqual(palette.prompts, 1, 'the build mode is asked');
      assertSameRun(side.recording, palette.recording);
      assert.deepStrictEqual(normalise(palette.recording), { panel: [], notifications: [{ kind: 'error', text: NO_BUILDABLE_PROJECT }], sidebar: [] });
      assert.strictEqual(getOperationLock().active, false, 'the lock is free');
    });
  });

  suite('build cancellation from two places', () => {
    // The sidebar's start fires the command and returns; the palette's resolves when the build ends.
    const starts: { via: string; start: () => Thenable<unknown> }[] = [
      { via: 'the sidebar', start: () => sidebarView().receive({ command: 'startBuild', requestId: 'side-1', data: { target: 'native' } }) },
      { via: 'the palette', start: () => vscode.commands.executeCommand('the-seed.buildNative') },
    ];
    const controls = [
      { name: 'the notification', cancel: async (): Promise<void> => { recorder.cancelProgress(); } },
      { name: "the sidebar's cancelBuild", cancel: async (): Promise<void> => { await sidebarView().receive({ command: 'cancelBuild', requestId: 'cancel-1' }); } },
    ];

    for (const { via, start } of starts) {
      for (let index = 0; index < controls.length; index++) {
        const control = controls[index];
        const other = controls[1 - index];
        test(`a build started from ${via} and cancelled from ${control.name} ends cancelled once; ${other.name} afterwards changes nothing`, async () => {
          writeBuildableProject(state.workspaceFolders[0]);
          const build = stubWaitingBuild();
          recorder.take();
          const done = start();
          await until(() => build.called, 'the build to start');
          assert.strictEqual(getOperationLock().type, 'build', 'the build holds the lock');

          await control.cancel();
          await done;
          await settled(recorder, null);
          const run = recorder.take();

          assert.deepStrictEqual(shownOf(run, 'warning'), ['Build cancelled.'], 'one cancellation warning');
          assert.strictEqual(panelText(run).split('── Build cancelled. ──').length - 1, 1, 'one cancellation line in the panel');
          assert.deepStrictEqual(postedTypes(run), ['buildStatus:running', 'buildStatus:cancelled'], 'one cancelled state');
          assert.strictEqual(getOperationLock().active, false, 'the lock is free');

          await other.cancel();
          await new Promise((resolve) => setTimeout(resolve, 200));

          assert.deepStrictEqual(recorder.take(), { panel: [], notifications: [], sidebar: [] }, 'the other control changes nothing');
          assert.strictEqual(getOperationLock().active, false, 'the lock is still free');
          assert.strictEqual(build.callCount, 1, 'one build ran');
        });
      }
    }
  });
});
