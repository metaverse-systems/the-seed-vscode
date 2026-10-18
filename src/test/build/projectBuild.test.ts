import * as assert from 'assert';
import { runProjectBuild, ProjectBuildUi } from '../../build/projectBuild';
import type { BuildStep, ProjectBuildOptions, ProjectBuildResult } from '@metaverse-systems/the-seed/dist/types';

// Choices made where the contract leaves a detail open (the implementation matches these):
// - `runProjectBuild(build, options, ui)` returns exactly the object `build.buildProject` resolved to.
// - Output chunks are decoded with `toString()` and passed to `ui.append` in arrival order; the
//   sink given to `buildProject` handles stdout and stderr the same way.
// - `ui.stepStarted(label, index, total)` receives the step's `label` and the 0-based index and total
//   that `buildProject` reported through `onStepStart`.

suite('projectBuild', () => {
  interface Recorder {
    calls: ProjectBuildOptions[];
    events: string[];
    ui: ProjectBuildUi;
  }

  function recorder(): Recorder {
    const events: string[] = [];
    return {
      calls: [],
      events,
      ui: {
        append: (text) => { events.push('append:' + text); },
        appendLine: (text) => { events.push('line:' + text); },
        stepStarted: (label, index, total) => { events.push(`step:${label}:${index}:${total}`); },
      },
    };
  }

  /** A stand-in for Build whose buildProject records its options and runs `script` with them. */
  function fakeBuild(
    rec: Recorder,
    script: (options: ProjectBuildOptions) => Promise<ProjectBuildResult> | ProjectBuildResult = () => ({ status: 'completed' })
  ) {
    return {
      buildProject: async (options: ProjectBuildOptions): Promise<ProjectBuildResult> => {
        rec.calls.push(options);
        return script(options);
      },
    };
  }

  const step = (label: string): BuildStep => ({ label, program: 'make', args: [] });

  test('passes projectDir, target, release, configDir and signal through, and no forceSignal', async () => {
    const rec = recorder();
    const controller = new AbortController();

    const result = await runProjectBuild(
      fakeBuild(rec),
      { projectDir: '/work/project', target: 'windows', release: true, configDir: '/work/config', signal: controller.signal },
      rec.ui
    );

    assert.deepStrictEqual(result, { status: 'completed' });
    assert.strictEqual(rec.calls.length, 1);
    const options = rec.calls[0];
    assert.strictEqual(options.projectDir, '/work/project');
    assert.strictEqual(options.target, 'windows');
    assert.strictEqual(options.release, true);
    assert.strictEqual(options.configDir, '/work/config');
    assert.strictEqual(options.signal, controller.signal);
    assert.strictEqual(options.forceSignal, undefined);
  });

  test('an incremental build passes no target', async () => {
    const rec = recorder();

    await runProjectBuild(
      fakeBuild(rec),
      { projectDir: '/work/project', target: undefined, release: false, configDir: '/work/config', signal: new AbortController().signal },
      rec.ui
    );

    assert.strictEqual(rec.calls.length, 1);
    assert.strictEqual(rec.calls[0].target, undefined);
    assert.strictEqual(rec.calls[0].release, false);
  });

  test('forwards output chunks to append and log lines to appendLine in order', async () => {
    const rec = recorder();
    const build = fakeBuild(rec, (options) => {
      options.log?.('==> compile: make -j4');
      options.output?.stdout(Buffer.from('first out;'));
      options.output?.stderr(Buffer.from('first err;'));
      options.log?.('Installed 2 file(s) into /prefix');
      options.output?.stdout(Buffer.from('second out;'));
      return { status: 'completed' };
    });

    await runProjectBuild(
      build,
      { projectDir: '/work/project', target: 'native', release: false, configDir: '/work/config', signal: new AbortController().signal },
      rec.ui
    );

    assert.deepStrictEqual(rec.events, [
      'line:==> compile: make -j4',
      'append:first out;',
      'append:first err;',
      'line:Installed 2 file(s) into /prefix',
      'append:second out;',
    ]);
  });

  test('reports each step start as stepStarted(label, index, total)', async () => {
    const rec = recorder();
    const build = fakeBuild(rec, (options) => {
      options.onStepStart?.(step('compile'), 0, 2);
      options.log?.('between');
      options.onStepStart?.(step('install'), 1, 2);
      return { status: 'completed' };
    });

    await runProjectBuild(
      build,
      { projectDir: '/work/project', target: undefined, release: false, configDir: '/work/config', signal: new AbortController().signal },
      rec.ui
    );

    assert.deepStrictEqual(rec.events, ['step:compile:0:2', 'line:between', 'step:install:1:2']);
  });

  test('returns a failed result unchanged', async () => {
    const rec = recorder();
    const failed: ProjectBuildResult = { status: 'failed', step: 'strip', message: 'strip failed on /prefix/bin/tiny: boom' };

    const result = await runProjectBuild(
      fakeBuild(rec, () => failed),
      { projectDir: '/work/project', target: 'native', release: true, configDir: '/work/config', signal: new AbortController().signal },
      rec.ui
    );

    assert.strictEqual(result, failed);
    assert.deepStrictEqual(result, { status: 'failed', step: 'strip', message: 'strip failed on /prefix/bin/tiny: boom' });
  });

  test('returns a cancelled result unchanged', async () => {
    const rec = recorder();
    const cancelled: ProjectBuildResult = { status: 'cancelled' };

    const result = await runProjectBuild(
      fakeBuild(rec, () => cancelled),
      { projectDir: '/work/project', target: 'native', release: false, configDir: '/work/config', signal: new AbortController().signal },
      rec.ui
    );

    assert.strictEqual(result, cancelled);
  });
});
