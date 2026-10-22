import * as assert from 'assert';
import {
  parseArguments,
  classifyResults,
  totalsLine,
  selectTestFiles,
  validateKnownGaps,
  knownGapOutcome,
  HostResults,
  CaseResult,
} from './results';
import { isLacking } from './platform';
import { KnownGap } from './knownGaps';

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

function makeGap(overrides: Partial<KnownGap> = {}): KnownGap {
  return {
    id: 'sample-gap',
    review: 'the-seed-vscode-1',
    finding: 3,
    fixedBy: 'Fix the sample',
    signature: 'sample failure text',
    reason: 'The sample case fails today.',
    cases: ['sample case'],
    ...overrides,
  };
}

function source(id: string, title: string): { file: string; text: string } {
  return { file: 'src/test/sample.test.ts', text: `  knownGapTest('${id}', '${title}', async () => {\n  });\n` };
}

const sampleSources = [source('sample-gap', 'sample case')];

const reviewText = [
  '# Review',
  '### 1. First finding',
  'text',
  '### 3. Third finding',
  'text',
  '### 12. Last finding',
  '',
].join('\n');

const roadmapText = [
  '| Order | Findings |',
  '|---|---|',
  '| 1. Fix the sample | 1, 3 (the dependency) | notes |',
  '| 2. Other task | 12 | notes |',
  '',
  '- [ ] **Task 1 — Fix the sample**',
  '- [X] **Task 2 — Other task**',
  '',
].join('\n');

const parentDocs = { review: reviewText, roadmap: roadmapText };

function violations(entries: KnownGap[], sources = sampleSources, docs?: { review: string; roadmap: string }): string[] {
  return validateKnownGaps(entries, sources, docs).violations;
}

function assertViolation(lines: string[], detail: string): void {
  assert.ok(
    lines.some((line) => line.startsWith('MALFORMED KNOWN GAP: ') && line.includes(detail)),
    `expected a MALFORMED KNOWN GAP line containing "${detail}", got ${JSON.stringify(lines)}`
  );
}

suite('Harness: validateKnownGaps', () => {
  test('an empty list with no marked cases has no violations', () => {
    const result = validateKnownGaps([], []);
    assert.deepStrictEqual(result.violations, []);
  });

  test('a well-formed entry matching its marked case has no violations', () => {
    assert.deepStrictEqual(violations([makeGap()]), []);
  });

  test('an id that is not kebab-case is a violation naming the id', () => {
    for (const id of ['Sample_Gap', 'sample gap', '-sample', 'sample-', 'a--b', '']) {
      const lines = violations([makeGap({ id, cases: [] })], []);
      assertViolation(lines, 'id');
    }
  });

  test('a duplicate id is a violation', () => {
    const lines = violations([makeGap(), makeGap()]);
    assertViolation(lines, 'duplicate');
    assertViolation(lines, 'sample-gap');
  });

  test('a review other than the-seed-vscode-1 is a violation', () => {
    const entry = makeGap({ review: 'other-review' as unknown as 'the-seed-vscode-1' });
    assertViolation(violations([entry]), 'review');
  });

  test('a finding outside 1 to 12, not an integer, or not new is a violation', () => {
    for (const finding of [0, 13, 2.5, -1, 'old'] as unknown as Array<number | 'new'>) {
      assertViolation(violations([makeGap({ finding })]), 'finding');
    }
  });

  test('findings 1 and 12 and new are accepted', () => {
    assert.deepStrictEqual(violations([makeGap({ finding: 1 })]), []);
    assert.deepStrictEqual(violations([makeGap({ finding: 12 })]), []);
    assert.deepStrictEqual(violations([makeGap({ finding: 'new', description: 'A defect.' })]), []);
  });

  test('a new finding needs a non-empty description', () => {
    assertViolation(violations([makeGap({ finding: 'new' })]), 'description');
    assertViolation(violations([makeGap({ finding: 'new', description: '' })]), 'description');
    assertViolation(violations([makeGap({ finding: 'new', description: '   ' })]), 'description');
  });

  test('an empty fixedBy is a violation', () => {
    assertViolation(violations([makeGap({ fixedBy: '' })]), 'fixedBy');
  });

  test('an empty reason is a violation', () => {
    assertViolation(violations([makeGap({ reason: '' })]), 'reason');
  });

  test('a signature shorter than 12 characters is a violation and exactly 12 is accepted', () => {
    assertViolation(violations([makeGap({ signature: 'elevenchars' })]), 'signature');
    assert.deepStrictEqual(violations([makeGap({ signature: '123456789012' })]), []);
  });

  test('cases that differ from the marked titles are a violation naming the id', () => {
    assertViolation(violations([makeGap({ cases: ['another case'] })]), 'sample-gap');
    assertViolation(violations([makeGap({ cases: ['sample case', 'extra case'] })]), 'cases');
  });

  test('cases are compared as a set, ignoring order', () => {
    const sources = [source('sample-gap', 'first'), source('sample-gap', 'second')];
    assert.deepStrictEqual(violations([makeGap({ cases: ['second', 'first'] })], sources), []);
  });

  test('a marked id that is not listed is a violation naming the id', () => {
    const lines = violations([], [source('unlisted-gap', 'some case')]);
    assertViolation(lines, 'unlisted-gap');
  });

  test('marked calls are found in every source', () => {
    const sources = [
      { file: 'a.ts', text: "knownGapTest('first-gap', 'one', () => {});" },
      { file: 'b.ts', text: "knownGapTest('second-gap', 'two', () => {});" },
    ];
    const entries = [
      makeGap({ id: 'first-gap', cases: ['one'] }),
      makeGap({ id: 'second-gap', cases: ['two'] }),
    ];
    assert.deepStrictEqual(violations(entries, sources), []);
  });

  test('every violation is reported, one line each', () => {
    const lines = violations([makeGap({ fixedBy: '', reason: '' })]);
    assert.strictEqual(lines.length, 2);
    for (const line of lines) {
      assert.ok(line.startsWith('MALFORMED KNOWN GAP: '));
    }
  });

  test('without parent documents the notice is given and there is no error', () => {
    const result = validateKnownGaps([makeGap()], sampleSources);
    assert.deepStrictEqual(result.violations, []);
    assert.deepStrictEqual(result.notices, [
      'Known-gap references not checked against the review: the parent repository is not present.',
    ]);
  });

  test('with parent documents there is no notice', () => {
    const result = validateKnownGaps([makeGap()], sampleSources, parentDocs);
    assert.deepStrictEqual(result.violations, []);
    assert.deepStrictEqual(result.notices, []);
  });

  test('a finding with no heading in the review is a violation', () => {
    assertViolation(violations([makeGap({ finding: 5 })], sampleSources, parentDocs), '5');
  });

  test('a heading must start a line as "### <finding>."', () => {
    const docs = { review: 'see ### 3. inline\n### 33. other\n', roadmap: roadmapText };
    assertViolation(violations([makeGap()], sampleSources, docs), 'finding 3');
  });

  test('a fixedBy that is not a roadmap task title is a violation', () => {
    const lines = violations([makeGap({ fixedBy: 'No such task' })], sampleSources, parentDocs);
    assertViolation(lines, 'No such task');
  });

  test('a task title is read from either an unchecked or a checked task line', () => {
    const entry = makeGap({ finding: 12, fixedBy: 'Other task' });
    assert.deepStrictEqual(violations([entry], sampleSources, parentDocs), []);
  });

  test('a finding missing from the order-table row of its task is a violation', () => {
    const lines = violations([makeGap({ finding: 12, fixedBy: 'Fix the sample' })], sampleSources, parentDocs);
    assertViolation(lines, 'Fix the sample');
  });

  test('a parenthesised note in the findings cell is ignored', () => {
    const docs = {
      review: reviewText,
      roadmap: roadmapText.replace('1, 3 (the dependency)', '1, (3), 7'),
    };
    assertViolation(violations([makeGap()], sampleSources, docs), 'Fix the sample');
    assert.deepStrictEqual(violations([makeGap()], sampleSources, parentDocs), []);
  });

  test('a new finding needs only the roadmap task, not a heading or a table row', () => {
    const entry = makeGap({ finding: 'new', description: 'A defect.', fixedBy: 'Other task' });
    assert.deepStrictEqual(violations([entry], sampleSources, parentDocs), []);
    const missing = makeGap({ finding: 'new', description: 'A defect.', fixedBy: 'No such task' });
    assertViolation(violations([missing], sampleSources, parentDocs), 'No such task');
  });
});

suite('Harness: knownGapOutcome', () => {
  test('an error containing the signature passes as a gap', () => {
    const entry = makeGap();
    assert.doesNotThrow(() => knownGapOutcome(entry, 'sample case', new Error('boom: sample failure text here')));
  });

  test('an error without the signature is rethrown unchanged', () => {
    const entry = makeGap();
    const error = new Error('something else');
    assert.throws(() => knownGapOutcome(entry, 'sample case', error), (thrown) => thrown === error);
  });

  test('no error is stale and the message says what to remove', () => {
    const entry = makeGap();
    assert.throws(
      () => knownGapOutcome(entry, 'sample case', null),
      {
        message:
          'STALE KNOWN GAP: sample-gap (the-seed-vscode-1 finding 3, fixed by "Fix the sample"): ' +
          '"sample case" now passes; remove the knownGapTest marker and the entry from src/test/harness/knownGaps.ts',
      }
    );
  });

  test('the stale message names a new finding as "new"', () => {
    const entry = makeGap({ finding: 'new', description: 'A defect.' });
    assert.throws(
      () => knownGapOutcome(entry, 'sample case', null),
      /^Error: STALE KNOWN GAP: sample-gap \(the-seed-vscode-1 finding new, fixed by "Fix the sample"\)/
    );
  });
});

suite('Harness: known gaps in results', () => {
  const gap = makeGap();

  test('a recorded gap prints a KNOWN GAP line and is not a failure', () => {
    const results = makeResults('linux', [
      makeCase({ title: 'Suite sample case [known gap: the-seed-vscode-1 finding 3]', knownGap: 'sample-gap' }),
    ]);
    const outcome = classifyResults(results, [gap]);
    assert.strictEqual(outcome.passed, true);
    assert.deepStrictEqual(outcome.failures, []);
    assert.deepStrictEqual(outcome.notices, [
      'KNOWN GAP: Suite sample case [known gap: the-seed-vscode-1 finding 3] (the-seed-vscode-1 finding 3; fixed by "Fix the sample")',
    ]);
  });

  test('the KNOWN GAP line says "new" for a new defect', () => {
    const newGap = makeGap({ finding: 'new', description: 'A defect.' });
    const results = makeResults('linux', [makeCase({ title: 'Suite sample case', knownGap: 'sample-gap' })]);
    assert.deepStrictEqual(classifyResults(results, [newGap]).notices, [
      'KNOWN GAP: Suite sample case (the-seed-vscode-1 finding new; fixed by "Fix the sample")',
    ]);
  });

  test('a failed case marked as a known gap is still a failure', () => {
    const results = makeResults('linux', [makeCase({ title: 'Suite sample case', state: 'failed', error: 'x', knownGap: 'sample-gap' })]);
    const outcome = classifyResults(results, [gap]);
    assert.strictEqual(outcome.passed, false);
    assert.deepStrictEqual(outcome.failures, ['FAILED: Suite sample case']);
  });

  test('the totals line counts gaps apart from passes', () => {
    const results = makeResults('linux', [
      makeCase({ title: 'one' }),
      makeCase({ title: 'two' }),
      makeCase({ title: 'three', knownGap: 'sample-gap' }),
      makeCase({ title: 'four', state: 'failed', error: 'x' }),
    ]);
    assert.strictEqual(totalsLine(results), 'Totals: 2 passed, 1 failed, 1 known gaps, 0 platform skips');
  });
});
