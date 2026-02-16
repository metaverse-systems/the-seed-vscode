import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { runBuildSteps } from '../../build/buildRunner';
import type { BuildStep } from '@metaverse-systems/the-seed/dist/types';

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
      { label: 'echo', command: 'echo "hello world"' },
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
      { label: 'step1', command: 'echo "first"' },
      { label: 'step2', command: 'echo "second"' },
      { label: 'step3', command: 'echo "third"' },
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
      { label: 'succeed', command: 'echo "ok"' },
      { label: 'fail', command: 'exit 1' },
      { label: 'never', command: 'echo "unreachable"' },
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
      { label: 'distclean', command: 'exit 1', ignoreExitCode: true },
      { label: 'next', command: 'echo "continued"' },
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
      { label: 'stderr', command: 'echo "error output" >&2' },
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
      { label: 'long', command: 'sleep 30' },
      { label: 'after', command: 'echo "unreachable"' },
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
      { label: 'step', command: 'echo "should not run"' },
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
      { label: 'a', command: 'echo "a"' },
      { label: 'b', command: 'echo "b"' },
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
      { label: 'pwd', command: 'pwd' },
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
});
