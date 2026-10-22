import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { runBuildSteps } from '../../build/buildRunner';
import type { BuildStep } from '@metaverse-systems/the-seed/types';

suite('buildRunner', () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buildrunner-test-'));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('executes a single step and captures stdout', async () => {
    const steps: BuildStep[] = [
      { label: 'echo', program: 'sh', args: ['-c', 'echo "hello world"'] },
    ];

    let stdout = '';
    const result = await runBuildSteps(steps, {
      cwd: tmpDir,
      onStdout: (data) => { stdout += data; },
      onStderr: () => {},
      onStepStart: () => {},
    });

    assert.strictEqual(result.success, true);
    assert.ok(stdout.includes('hello world'), 'Should capture stdout');
  });

  test('executes multiple steps in order', async () => {
    const steps: BuildStep[] = [
      { label: 'step1', program: 'sh', args: ['-c', 'echo "first"'] },
      { label: 'step2', program: 'sh', args: ['-c', 'echo "second"'] },
      { label: 'step3', program: 'sh', args: ['-c', 'echo "third"'] },
    ];

    const order: string[] = [];
    const result = await runBuildSteps(steps, {
      cwd: tmpDir,
      onStdout: () => {},
      onStderr: () => {},
      onStepStart: (step) => { order.push(step.label); },
    });

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(order, ['step1', 'step2', 'step3']);
  });

  test('reports failure when a step exits with non-zero code', async () => {
    const steps: BuildStep[] = [
      { label: 'succeed', program: 'sh', args: ['-c', 'echo "ok"'] },
      { label: 'fail', program: 'sh', args: ['-c', 'exit 1'] },
      { label: 'never', program: 'sh', args: ['-c', 'echo "unreachable"'] },
    ];

    const startedSteps: string[] = [];
    const result = await runBuildSteps(steps, {
      cwd: tmpDir,
      onStdout: () => {},
      onStderr: () => {},
      onStepStart: (step) => { startedSteps.push(step.label); },
    });

    assert.strictEqual(result.success, false);
    // 'never' step should not have started
    assert.ok(!startedSteps.includes('never'), 'Should not start steps after failure');
  });

  test('ignoreExitCode allows build to continue on non-zero exit', async () => {
    const steps: BuildStep[] = [
      { label: 'distclean', program: 'sh', args: ['-c', 'exit 1'], ignoreExitCode: true },
      { label: 'next', program: 'sh', args: ['-c', 'echo "continued"'] },
    ];

    let stdout = '';
    const result = await runBuildSteps(steps, {
      cwd: tmpDir,
      onStdout: (data) => { stdout += data; },
      onStderr: () => {},
      onStepStart: () => {},
    });

    assert.strictEqual(result.success, true);
    assert.ok(stdout.includes('continued'), 'Should continue after ignored failure');
  });

  test('captures stderr output', async () => {
    const steps: BuildStep[] = [
      { label: 'stderr', program: 'sh', args: ['-c', 'echo "error output" >&2'] },
    ];

    let stderr = '';
    const result = await runBuildSteps(steps, {
      cwd: tmpDir,
      onStdout: () => {},
      onStderr: (data) => { stderr += data; },
      onStepStart: () => {},
    });

    assert.strictEqual(result.success, true);
    assert.ok(stderr.includes('error output'), 'Should capture stderr');
  });

  test('cancellation via AbortSignal stops execution', async () => {
    const steps: BuildStep[] = [
      { label: 'long', program: 'sleep', args: ['30'] },
      { label: 'after', program: 'sh', args: ['-c', 'echo "unreachable"'] },
    ];

    const abortController = new AbortController();
    const startedSteps: string[] = [];

    // Abort after a short delay
    setTimeout(() => abortController.abort(), 200);

    const result = await runBuildSteps(steps, {
      cwd: tmpDir,
      onStdout: () => {},
      onStderr: () => {},
      onStepStart: (step) => { startedSteps.push(step.label); },
      signal: abortController.signal,
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.cancelledAtStep !== undefined, 'Should report cancelled step');
    assert.ok(!startedSteps.includes('after'), 'Should not start steps after cancellation');
  });

  test('already-aborted signal prevents execution', async () => {
    const steps: BuildStep[] = [
      { label: 'step', program: 'sh', args: ['-c', 'echo "should not run"'] },
    ];

    const abortController = new AbortController();
    abortController.abort(); // Abort before execution starts

    const startedSteps: string[] = [];
    const result = await runBuildSteps(steps, {
      cwd: tmpDir,
      onStdout: () => {},
      onStderr: () => {},
      onStepStart: (step) => { startedSteps.push(step.label); },
      signal: abortController.signal,
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.cancelledAtStep, 0);
  });

  test('onStepStart receives correct index and total', async () => {
    const steps: BuildStep[] = [
      { label: 'a', program: 'sh', args: ['-c', 'echo "a"'] },
      { label: 'b', program: 'sh', args: ['-c', 'echo "b"'] },
    ];

    const calls: { index: number; total: number }[] = [];
    await runBuildSteps(steps, {
      cwd: tmpDir,
      onStdout: () => {},
      onStderr: () => {},
      onStepStart: (_step, index, total) => {
        calls.push({ index, total });
      },
    });

    assert.deepStrictEqual(calls, [
      { index: 0, total: 2 },
      { index: 1, total: 2 },
    ]);
  });

  test('uses correct working directory', async () => {
    const steps: BuildStep[] = [
      { label: 'pwd', program: 'pwd', args: [] },
    ];

    let stdout = '';
    await runBuildSteps(steps, {
      cwd: tmpDir,
      onStdout: (data) => { stdout += data; },
      onStderr: () => {},
      onStepStart: () => {},
    });

    assert.ok(stdout.trim().includes(tmpDir), 'Should run in specified cwd');
  });

  test('passes an argument with a space, quotes and $HOME literally', async () => {
    const tricky = "a b 'q' \"d\" $HOME";
    const steps: BuildStep[] = [
      { label: 'printf', program: 'printf', args: ['%s', tricky] },
    ];

    let stdout = '';
    const result = await runBuildSteps(steps, {
      cwd: tmpDir,
      onStdout: (data) => { stdout += data; },
      onStderr: () => {},
      onStepStart: () => {},
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(stdout, tricky);
  });

  test('uses a step cwd relative to options.cwd', async () => {
    fs.mkdirSync(path.join(tmpDir, 'sub'));
    const steps: BuildStep[] = [
      { label: 'pwd', program: 'pwd', args: [], cwd: 'sub' },
    ];

    let stdout = '';
    const result = await runBuildSteps(steps, {
      cwd: tmpDir,
      onStdout: (data) => { stdout += data; },
      onStderr: () => {},
      onStepStart: () => {},
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(fs.realpathSync(stdout.trim()), fs.realpathSync(path.join(tmpDir, 'sub')));
  });

  test('makes a step env value visible and lets it override options.env', async () => {
    const steps: BuildStep[] = [
      {
        label: 'env',
        program: 'sh',
        args: ['-c', 'printf "%s|%s" "$BUILDRUNNER_A" "$BUILDRUNNER_B"'],
        env: { BUILDRUNNER_B: 'from-step' },
      },
    ];

    let stdout = '';
    const result = await runBuildSteps(steps, {
      cwd: tmpDir,
      env: { BUILDRUNNER_A: 'from-options', BUILDRUNNER_B: 'from-options' },
      onStdout: (data) => { stdout += data; },
      onStderr: () => {},
      onStepStart: () => {},
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(stdout, 'from-options|from-step');
  });

  test('fails the step without rejecting when the program does not exist', async () => {
    const steps: BuildStep[] = [
      { label: 'missing', program: 'no-such-program-for-the-seed-test', args: [] },
      { label: 'never', program: 'echo', args: ['unreachable'] },
    ];

    let stderr = '';
    const startedSteps: string[] = [];
    const result = await runBuildSteps(steps, {
      cwd: tmpDir,
      onStdout: () => {},
      onStderr: (data) => { stderr += data; },
      onStepStart: (step) => { startedSteps.push(step.label); },
    });

    assert.strictEqual(result.success, false);
    assert.ok(stderr.includes('no-such-program-for-the-seed-test'), 'Should report the program through onStderr');
    assert.deepStrictEqual(startedSteps, ['missing']);
  });
});
