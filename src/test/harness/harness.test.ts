import * as assert from 'assert';
import {
  parseArguments,
  classifyResults,
  totalsLine,
  selectTestFiles,
  HostResults,
  CaseResult,
} from './results';
import { isLacking } from './platform';

function makeCase(overrides: Partial<CaseResult> & { title: string }): CaseResult {
  return {
    file: 'out/test/example.test.js',
    state: 'passed',
    error: null,
    knownGap: null,
    ...overrides,
  };
}

function makeResults(platform: string, cases: CaseResult[]): HostResults {
  return { platform, cases };
}

suite('Harness: parseArguments', () => {
  const allStages = ['compile', 'typecheck', 'lint', 'host'];

  test('no arguments selects all four stages in order', () => {
    const parsed = parseArguments([]);
    assert.strictEqual(parsed.ok, true);
    if (parsed.ok) {
      assert.deepStrictEqual(parsed.stages, allStages);
    }
  });

  test('named stages are returned in the fixed order whatever order they are given', () => {
    const parsed = parseArguments(['host', 'compile']);
    assert.strictEqual(parsed.ok, true);
    if (parsed.ok) {
      assert.deepStrictEqual(parsed.stages, ['compile', 'host']);
    }
  });

  test('a single stage selects only that stage', () => {
    const parsed = parseArguments(['lint']);
    assert.strictEqual(parsed.ok, true);
    if (parsed.ok) {
      assert.deepStrictEqual(parsed.stages, ['lint']);
    }
  });

  test('a repeated stage name runs once', () => {
    const parsed = parseArguments(['lint', 'lint']);
    assert.strictEqual(parsed.ok, true);
    if (parsed.ok) {
      assert.deepStrictEqual(parsed.stages, ['lint']);
    }
  });

  test('an unknown stage is a usage error naming the stage and listing the stages', () => {
    const parsed = parseArguments(['bogus']);
    assert.strictEqual(parsed.ok, false);
    if (!parsed.ok) {
      assert.strictEqual(
        parsed.error,
        'unknown stage: bogus (stages: compile, typecheck, lint, host)'
      );
    }
  });

  test('an unknown stage is a usage error even next to valid stages', () => {
    const parsed = parseArguments(['compile', 'nope']);
    assert.strictEqual(parsed.ok, false);
    if (!parsed.ok) {
      assert.strictEqual(
        parsed.error,
        'unknown stage: nope (stages: compile, typecheck, lint, host)'
      );
    }
  });

  test('host options default to no filter, normal order and one run', () => {
    const parsed = parseArguments(['host']);
    assert.strictEqual(parsed.ok, true);
    if (parsed.ok) {
      assert.strictEqual(parsed.host.only, undefined);
      assert.strictEqual(parsed.host.reverse, false);
      assert.strictEqual(parsed.host.repeat, 1);
    }
  });

  test('--only takes a glob after the separator', () => {
    const parsed = parseArguments(['host', '--', '--only', 'out/test/commands/*.test.js']);
    assert.strictEqual(parsed.ok, true);
    if (parsed.ok) {
      assert.deepStrictEqual(parsed.stages, ['host']);
      assert.strictEqual(parsed.host.only, 'out/test/commands/*.test.js');
    }
  });

  test('--reverse sets reverse order', () => {
    const parsed = parseArguments(['host', '--', '--reverse']);
    assert.strictEqual(parsed.ok, true);
    if (parsed.ok) {
      assert.strictEqual(parsed.host.reverse, true);
    }
  });

  test('--repeat takes a positive integer', () => {
    const parsed = parseArguments(['host', '--', '--repeat', '3']);
    assert.strictEqual(parsed.ok, true);
    if (parsed.ok) {
      assert.strictEqual(parsed.host.repeat, 3);
    }
  });

  test('host options combine', () => {
    const parsed = parseArguments(['--', '--reverse', '--repeat', '2', '--only', 'out/test/a.test.js']);
    assert.strictEqual(parsed.ok, true);
    if (parsed.ok) {
      assert.deepStrictEqual(parsed.stages, allStages);
      assert.strictEqual(parsed.host.reverse, true);
      assert.strictEqual(parsed.host.repeat, 2);
      assert.strictEqual(parsed.host.only, 'out/test/a.test.js');
    }
  });

  for (const bad of ['0', '-1', '1.5', 'abc', '']) {
    test(`--repeat "${bad}" is a usage error`, () => {
      const parsed = parseArguments(['host', '--', '--repeat', bad]);
      assert.strictEqual(parsed.ok, false);
      if (!parsed.ok) {
        assert.ok(parsed.error.length > 0);
      }
    });
  }

  test('--repeat without a value is a usage error', () => {
    assert.strictEqual(parseArguments(['host', '--', '--repeat']).ok, false);
  });

  test('--only without a value is a usage error', () => {
    assert.strictEqual(parseArguments(['host', '--', '--only']).ok, false);
  });

  test('an unrecognised host option is a usage error', () => {
    assert.strictEqual(parseArguments(['host', '--', '--shuffle']).ok, false);
  });

  test('a stray argument after the separator is a usage error', () => {
    assert.strictEqual(parseArguments(['host', '--', 'extra']).ok, false);
  });
});

suite('Harness: classifyResults', () => {
  test('all passing cases pass with no failure lines', () => {
    const outcome = classifyResults(
      makeResults('linux', [makeCase({ title: 'Suite a' }), makeCase({ title: 'Suite b' })])
    );
    assert.strictEqual(outcome.passed, true);
    assert.deepStrictEqual(outcome.failures, []);
  });

  test('a failed case yields FAILED with its full title', () => {
    const outcome = classifyResults(
      makeResults('linux', [
        makeCase({ title: 'Suite ok' }),
        makeCase({ title: 'Suite broken', state: 'failed', error: 'expected 1 to equal 2' }),
      ])
    );
    assert.strictEqual(outcome.passed, false);
    assert.deepStrictEqual(outcome.failures, ['FAILED: Suite broken']);
  });

  test('one FAILED line per failed case', () => {
    const outcome = classifyResults(
      makeResults('linux', [
        makeCase({ title: 'A one', state: 'failed', error: 'x' }),
        makeCase({ title: 'A two', state: 'failed', error: 'y' }),
      ])
    );
    assert.deepStrictEqual(outcome.failures, ['FAILED: A one', 'FAILED: A two']);
  });

  test('a pending case that is not a platform skip is a SILENT SKIP', () => {
    const outcome = classifyResults(
      makeResults('linux', [makeCase({ title: 'Suite skipped', state: 'pending' })])
    );
    assert.strictEqual(outcome.passed, false);
    assert.deepStrictEqual(outcome.failures, ['SILENT SKIP: Suite skipped']);
  });

  test('a platform skip on Windows is reported with its reason and does not fail', () => {
    const outcome = classifyResults(
      makeResults('win32', [
        makeCase({
          title: 'Native needs it',
          state: 'pending',
          platformSkip: {
            capability: 'native-component',
            reason: 'the tool\'s native component is not built on Windows',
          },
        }),
      ])
    );
    assert.strictEqual(outcome.passed, true);
    assert.deepStrictEqual(outcome.failures, []);
    assert.deepStrictEqual(outcome.notices, [
      "PLATFORM SKIP: Native needs it: the tool's native component is not built on Windows",
    ]);
  });

  test('a platform skip on Linux fails as PLATFORM SKIP ON LINUX', () => {
    const outcome = classifyResults(
      makeResults('linux', [
        makeCase({
          title: 'Native needs it',
          state: 'pending',
          platformSkip: { capability: 'native-component', reason: 'some reason' },
        }),
      ])
    );
    assert.strictEqual(outcome.passed, false);
    assert.deepStrictEqual(outcome.failures, ['PLATFORM SKIP ON LINUX: Native needs it']);
    assert.ok(outcome.notices.includes('PLATFORM SKIP: Native needs it: some reason'));
  });

  test('a platform skip on macOS also fails (only Windows may skip)', () => {
    const outcome = classifyResults(
      makeResults('darwin', [
        makeCase({
          title: 'Posix only',
          state: 'pending',
          platformSkip: { capability: 'posix-toolchain', reason: 'r' },
        }),
      ])
    );
    assert.strictEqual(outcome.passed, false);
    assert.deepStrictEqual(outcome.failures, ['PLATFORM SKIP ON LINUX: Posix only']);
  });

  test('a recorded known gap that passed does not fail', () => {
    const outcome = classifyResults(
      makeResults('linux', [makeCase({ title: 'Gap case', knownGap: 'some-gap' })])
    );
    assert.strictEqual(outcome.passed, true);
    assert.deepStrictEqual(outcome.failures, []);
  });

  test('mixed results report every failing line and fail', () => {
    const outcome = classifyResults(
      makeResults('linux', [
        makeCase({ title: 'Fine' }),
        makeCase({ title: 'Bad', state: 'failed', error: 'e' }),
        makeCase({ title: 'Quiet', state: 'pending' }),
      ])
    );
    assert.strictEqual(outcome.passed, false);
    assert.deepStrictEqual(outcome.failures, ['FAILED: Bad', 'SILENT SKIP: Quiet']);
  });
});

suite('Harness: totalsLine', () => {
  test('counts passed, failed, known gaps and platform skips', () => {
    const line = totalsLine(
      makeResults('win32', [
        makeCase({ title: 'p1' }),
        makeCase({ title: 'p2' }),
        makeCase({ title: 'f1', state: 'failed', error: 'e' }),
        makeCase({ title: 'g1', knownGap: 'gap' }),
        makeCase({
          title: 's1',
          state: 'pending',
          platformSkip: { capability: 'posix-toolchain', reason: 'r' },
        }),
      ])
    );
    assert.strictEqual(line, 'Totals: 2 passed, 1 failed, 1 known gaps, 1 platform skips');
  });

  test('known gaps are excluded from the passed count', () => {
    const line = totalsLine(
      makeResults('linux', [
        makeCase({ title: 'g1', knownGap: 'gap' }),
        makeCase({ title: 'g2', knownGap: 'gap' }),
      ])
    );
    assert.strictEqual(line, 'Totals: 0 passed, 0 failed, 2 known gaps, 0 platform skips');
  });

  test('an empty run reports zeros', () => {
    assert.strictEqual(
      totalsLine(makeResults('linux', [])),
      'Totals: 0 passed, 0 failed, 0 known gaps, 0 platform skips'
    );
  });
});

suite('Harness: selectTestFiles', () => {
  const root = '/ext';
  const hooks = '/ext/out/test/harness/rootHooks.js';
  const all = [
    '/ext/out/test/panels/messageHandler.test.js',
    '/ext/out/test/commands/buildCommands.test.js',
    '/ext/out/test/extension.test.js',
    '/ext/out/test/commands/dependencyCommands.test.js',
  ];
  const sorted = [
    '/ext/out/test/commands/buildCommands.test.js',
    '/ext/out/test/commands/dependencyCommands.test.js',
    '/ext/out/test/extension.test.js',
    '/ext/out/test/panels/messageHandler.test.js',
  ];

  test('returns the files sorted', () => {
    assert.deepStrictEqual(selectTestFiles(all, {}, root), sorted);
  });

  test('does not modify its input', () => {
    const copy = [...all];
    selectTestFiles(all, { order: 'reverse' }, root);
    assert.deepStrictEqual(all, copy);
  });

  test('reverse order reverses the sorted list', () => {
    assert.deepStrictEqual(
      selectTestFiles(all, { order: 'reverse' }, root),
      [...sorted].reverse()
    );
  });

  test('only keeps files whose path relative to the root matches the glob', () => {
    assert.deepStrictEqual(selectTestFiles(all, { only: 'out/test/commands/*.test.js' }, root), [
      '/ext/out/test/commands/buildCommands.test.js',
      '/ext/out/test/commands/dependencyCommands.test.js',
    ]);
  });

  test('only can name a single file', () => {
    assert.deepStrictEqual(
      selectTestFiles(all, { only: 'out/test/extension.test.js' }, root),
      ['/ext/out/test/extension.test.js']
    );
  });

  test('only matching nothing returns an empty list', () => {
    assert.deepStrictEqual(selectTestFiles(all, { only: 'out/test/none/*.js' }, root), []);
  });

  test('rootHooks.js comes first when present', () => {
    const selected = selectTestFiles([...all, hooks], {}, root);
    assert.strictEqual(selected[0], hooks);
    assert.deepStrictEqual(selected.slice(1), sorted);
  });

  test('rootHooks.js is never filtered out', () => {
    const selected = selectTestFiles([...all, hooks], { only: 'out/test/extension.test.js' }, root);
    assert.deepStrictEqual(selected, [hooks, '/ext/out/test/extension.test.js']);
  });

  test('rootHooks.js stays first when the order is reversed', () => {
    const selected = selectTestFiles([...all, hooks], { order: 'reverse' }, root);
    assert.strictEqual(selected[0], hooks);
    assert.deepStrictEqual(selected.slice(1), [...sorted].reverse());
  });

  test('rootHooks.js is not added when absent from the input', () => {
    assert.ok(!selectTestFiles(all, {}, root).includes(hooks));
  });
});

suite('Harness: isLacking', () => {
  test('native-component is lacking on win32 only', () => {
    assert.strictEqual(isLacking('native-component', 'win32'), true);
    assert.strictEqual(isLacking('native-component', 'linux'), false);
    assert.strictEqual(isLacking('native-component', 'darwin'), false);
  });

  test('posix-toolchain is lacking on win32 only', () => {
    assert.strictEqual(isLacking('posix-toolchain', 'win32'), true);
    assert.strictEqual(isLacking('posix-toolchain', 'linux'), false);
    assert.strictEqual(isLacking('posix-toolchain', 'darwin'), false);
  });
});
