// The build limits: the validation of typed and saved values, the reduction of
// the project count, the output line, and parity with the loaded tool, which
// must reject and reduce exactly as the extension says it does.
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  effectiveLimits,
  limitsLine,
  parseLimitSetting,
  parseLimitText,
  processorCount,
} from '../../build/buildLimits';
import type { BuildLimitRequest, LimitName } from '../../build/buildLimits';
import { useScratchState } from '../helpers/scratchState';
import { testTool } from '../helpers/tool';

const ACCEPTED_TEXT: { raw: string; value: number }[] = [
  { raw: '1', value: 1 },
  { raw: '4', value: 4 },
  { raw: ' 8 ', value: 8 },
  { raw: String(Number.MAX_SAFE_INTEGER), value: Number.MAX_SAFE_INTEGER },
];

const REJECTED_TEXT = ['', '0', '-1', '04', '+4', '4.0', '4.5', '1e3', 'four', '9007199254740993'];

const REJECTED_SETTINGS: unknown[] = [0, -1, 4.5, '4', true, {}, NaN];

const LABELS: Record<LimitName, string> = { parallel: 'the project count', jobs: 'the job limit' };

suite('Build limits: validation', () => {
  for (const name of ['parallel', 'jobs'] as const) {
    for (const { raw, value } of ACCEPTED_TEXT) {
      test(`parseLimitText accepts ${JSON.stringify(raw)} for ${name}`, () => {
        assert.deepStrictEqual(parseLimitText(raw, name), { ok: true, value });
      });
    }

    for (const raw of REJECTED_TEXT) {
      test(`parseLimitText rejects ${JSON.stringify(raw)} for ${name} with the tool's wording`, () => {
        assert.deepStrictEqual(parseLimitText(raw, name), {
          ok: false,
          message: `Invalid value "${raw}" for ${LABELS[name]}; expected a positive whole number.`,
        });
      });
    }

    test(`parseLimitSetting treats a missing or null ${name} as no value`, () => {
      assert.deepStrictEqual(parseLimitSetting(undefined, name), { ok: true, value: undefined });
      assert.deepStrictEqual(parseLimitSetting(null, name), { ok: true, value: undefined });
    });

    test(`parseLimitSetting accepts a positive whole number for ${name}`, () => {
      assert.deepStrictEqual(parseLimitSetting(3, name), { ok: true, value: 3 });
    });

    for (const raw of REJECTED_SETTINGS) {
      test(`parseLimitSetting rejects ${String(JSON.stringify(raw))} for ${name}`, () => {
        const parsed = parseLimitSetting(raw, name);
        assert.strictEqual(parsed.ok, false);
      });
    }
  }

  test('parseLimitSetting names the setting, the value and the fallback', () => {
    assert.deepStrictEqual(parseLimitSetting('six', 'jobs'), {
      ok: false,
      message: 'The setting "the-seed.build.jobs" is "six"; expected a positive whole number. Using the processor count for this build.',
    });
    assert.deepStrictEqual(parseLimitSetting(4.5, 'parallel'), {
      ok: false,
      message: 'The setting "the-seed.build.parallel" is 4.5; expected a positive whole number. Using 1 project at a time for this build.',
    });
    assert.deepStrictEqual(parseLimitSetting(NaN, 'jobs'), {
      ok: false,
      message: 'The setting "the-seed.build.jobs" is NaN; expected a positive whole number. Using the processor count for this build.',
    });
  });

  test('processorCount matches the tool\'s expression', () => {
    assert.strictEqual(processorCount(), Math.max(1, os.availableParallelism()));
  });
});

suite('Build limits: reduction and report', () => {
  const thisBuild = (value: number) => ({ value, source: 'this build' as const });
  const saved = (value: number) => ({ value, source: 'workspace default' as const });

  test('a project count above the processor count is reduced to it', () => {
    const effective = effectiveLimits({ parallel: thisBuild(16) }, true, 8);
    assert.deepStrictEqual(effective, {
      jobs: 8,
      jobsSource: 'processor count',
      parallel: 8,
      parallelSource: 'this build',
      reductions: [{ requested: 16, to: 8, cause: 'the processor count' }],
    });
    assert.strictEqual(
      limitsLine(effective),
      'Build limits: up to 8 projects at once (requested 16, reduced to the processor count), 8 compile jobs (processor count)'
    );
  });

  test('a project count above the job limit is reduced to it', () => {
    const effective = effectiveLimits({ parallel: thisBuild(16), jobs: thisBuild(2) }, true, 8);
    assert.deepStrictEqual(effective.reductions, [{ requested: 16, to: 2, cause: 'the job limit' }]);
    assert.strictEqual(
      limitsLine(effective),
      'Build limits: up to 2 projects at once (requested 16, reduced to the job limit), 2 compile jobs (this build)'
    );
  });

  test('when both bounds apply the lower one is used', () => {
    assert.deepStrictEqual(
      effectiveLimits({ parallel: saved(16), jobs: saved(12) }, true, 3).reductions,
      [{ requested: 16, to: 3, cause: 'the processor count' }]
    );
    assert.deepStrictEqual(
      effectiveLimits({ parallel: saved(16), jobs: saved(3) }, true, 3).reductions,
      [{ requested: 16, to: 3, cause: 'the job limit' }],
      'the job limit when the two are equal'
    );
    assert.strictEqual(
      limitsLine(effectiveLimits({ parallel: saved(16), jobs: saved(6) }, true, 3)),
      'Build limits: up to 3 projects at once (requested 16, reduced to the processor count), 6 compile jobs (workspace default)'
    );
  });

  test('a job limit above the processor count is kept', () => {
    const effective = effectiveLimits({ jobs: thisBuild(64) }, false, 4);
    assert.deepStrictEqual(effective, { jobs: 64, jobsSource: 'this build', reductions: [] });
    assert.strictEqual(limitsLine(effective), 'Build limits: 64 compile jobs (this build)');
  });

  test('a single-project build has no project count', () => {
    const effective = effectiveLimits({ parallel: thisBuild(4), jobs: thisBuild(2) }, false, 8);
    assert.strictEqual(effective.parallel, undefined);
    assert.strictEqual(limitsLine(effective), 'Build limits: 2 compile jobs (this build)');
  });

  test('with nothing requested: one project at a time and the processor count', () => {
    const recursive = effectiveLimits({}, true, 6);
    assert.deepStrictEqual(recursive, {
      jobs: 6,
      jobsSource: 'processor count',
      parallel: 1,
      parallelSource: 'default',
      reductions: [],
    });
    assert.strictEqual(limitsLine(recursive), 'Build limits: 1 project at a time (default), 6 compile jobs (processor count)');
    assert.strictEqual(limitsLine(effectiveLimits({}, false, 6)), 'Build limits: 6 compile jobs (processor count)');
  });

  test('a project count that is not reduced names its source', () => {
    assert.strictEqual(
      limitsLine(effectiveLimits({ parallel: saved(3), jobs: saved(6) }, true, 8)),
      'Build limits: up to 3 projects at once (workspace default), 6 compile jobs (workspace default)'
    );
    assert.strictEqual(
      limitsLine(effectiveLimits({ jobs: thisBuild(1) }, false, 8)),
      'Build limits: 1 compile job (this build)'
    );
  });
});

suite('Build limits: parity with the tool', function () {
  this.timeout(30000);
  const state = useScratchState();

  function config() {
    const loaded = new (testTool().Config)();
    loaded.loadConfig();
    return loaded;
  }

  /** Runs the tool's buildRecursive on a directory that is not a project, so it stops at validation or discovery. */
  async function rejection(parallel: unknown, jobs: unknown): Promise<unknown> {
    try {
      await testTool().buildRecursive({
        config: config(),
        target: 'native',
        fullReconfigure: true,
        projectDir: path.join(state.dir('missing'), 'not-there'),
        parallel: parallel as number,
        jobs: jobs as number,
      });
    } catch (error) {
      return error;
    }
    return undefined;
  }

  const rejectedValues: unknown[] = [...REJECTED_TEXT, 0, -1, 4.5, NaN, Number.MAX_SAFE_INTEGER + 2];

  for (const value of rejectedValues) {
    for (const name of ['parallel', 'jobs'] as const) {
      test(`the tool rejects ${String(JSON.stringify(value) ?? value)} as ${name} before discovery`, async () => {
        const error = await rejection(name === 'parallel' ? value : undefined, name === 'jobs' ? value : undefined);
        assert.ok(error instanceof RangeError, `a RangeError, got: ${String(error)}`);
        if (typeof value === 'number') {
          assert.strictEqual(parseLimitSetting(value, name).ok, false, 'the extension rejects it as a saved value too');
        } else {
          assert.strictEqual(parseLimitText(value as string, name).ok, false, 'the extension rejects it as typed text too');
        }
      });
    }
  }

  for (const { raw } of ACCEPTED_TEXT) {
    test(`the tool accepts ${JSON.stringify(raw)} as both limits`, async () => {
      const parsed = parseLimitText(raw, 'jobs');
      assert.ok(parsed.ok);
      const error = await rejection(parsed.value, parsed.value);
      assert.ok(!(error instanceof RangeError), `not a RangeError, got: ${String(error)}`);
    });
  }

  /** A scratch project the tool can discover; it is never compiled. */
  function oneProject(): string {
    const dir = path.join(state.dir('graph'), 'solo');
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'Makefile.am'), 'bin_PROGRAMS = solo\n');
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: '@test/solo', version: '0.1.0', scripts: { build: 'the-seed build native' } })
    );
    return dir;
  }

  const pairs: { parallel: number; jobs?: number }[] = [
    { parallel: 2 },
    { parallel: 16 },
    { parallel: 4, jobs: 2 },
    { parallel: 3, jobs: 6 },
    { parallel: 1, jobs: 4 },
  ];

  for (const pair of pairs) {
    test(`the tool reduces parallel ${pair.parallel} with jobs ${pair.jobs ?? 'unset'} as the report says`, async () => {
      const projectDir = oneProject();
      const controller = new AbortController();
      const lines: string[] = [];
      // The editor host ignores a plain assignment to console.log, so the catcher is defined in its place
      const original = Object.getOwnPropertyDescriptor(console, 'log');
      Object.defineProperty(console, 'log', {
        configurable: true,
        enumerable: original?.enumerable ?? true,
        writable: true,
        value: (...args: unknown[]) => {
          const line = args.map(String).join(' ');
          lines.push(line);
          // The plan ends with an empty line, printed before any project starts
          if (line === '' || line.startsWith('Building up to')) {
            controller.abort();
          }
        },
      });
      try {
        await testTool().buildRecursive({
          config: config(),
          target: 'native',
          fullReconfigure: true,
          projectDir,
          signal: controller.signal,
          parallel: pair.parallel,
          jobs: pair.jobs,
          callbacks: { onProjectStart: () => controller.abort() },
        });
      } finally {
        if (original) {
          Object.defineProperty(console, 'log', original);
        } else {
          delete (console as unknown as Record<string, unknown>).log;
        }
      }

      const request: BuildLimitRequest = {
        parallel: { value: pair.parallel, source: 'this build' },
        ...(pair.jobs === undefined ? {} : { jobs: { value: pair.jobs, source: 'this build' as const } }),
      };
      const effective = effectiveLimits(request, true, processorCount());
      const planned = lines.find((line) => line.startsWith('Building up to'));
      if (effective.parallel === 1) {
        assert.strictEqual(planned, undefined, `the tool builds one at a time, got: ${planned}`);
      } else {
        assert.strictEqual(
          planned,
          `Building up to ${effective.parallel} projects at once (${effective.jobs} compile jobs shared out per tier)`,
          `the tool's plan, got: ${JSON.stringify(lines)}`
        );
      }
    });
  }
});
