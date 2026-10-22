import * as path from 'path';

export const STAGES = ['compile', 'typecheck', 'lint', 'host'] as const;
export type Stage = typeof STAGES[number];

export interface HostOptions {
  only: string | undefined;
  reverse: boolean;
  repeat: number;
}

export type ParsedArguments =
  | { ok: true; stages: Stage[]; host: HostOptions }
  | { ok: false; error: string };

/**
 * Parses the runner's arguments: stage names, then optionally `--` and the
 * host options. Stages are returned in their fixed order, without repeats.
 */
export function parseArguments(argv: readonly string[]): ParsedArguments {
  const separator = argv.indexOf('--');
  const stageArgs = separator === -1 ? argv : argv.slice(0, separator);
  const hostArgs = separator === -1 ? [] : argv.slice(separator + 1);

  for (const name of stageArgs) {
    if (!(STAGES as readonly string[]).includes(name)) {
      return { ok: false, error: `unknown stage: ${name} (stages: ${STAGES.join(', ')})` };
    }
  }
  const stages = stageArgs.length === 0
    ? [...STAGES]
    : STAGES.filter((stage) => stageArgs.includes(stage));

  const host: HostOptions = { only: undefined, reverse: false, repeat: 1 };
  for (let index = 0; index < hostArgs.length; index++) {
    const option = hostArgs[index];
    if (option === '--reverse') {
      host.reverse = true;
    } else if (option === '--only') {
      const value = hostArgs[++index];
      if (value === undefined || value === '') {
        return { ok: false, error: '--only needs a glob' };
      }
      host.only = value;
    } else if (option === '--repeat') {
      const value = hostArgs[++index];
      if (value === undefined || !/^[1-9][0-9]*$/.test(value)) {
        return { ok: false, error: `--repeat needs a positive integer (got ${value === undefined ? 'nothing' : `"${value}"`})` };
      }
      host.repeat = Number(value);
    } else {
      return { ok: false, error: `unknown host option: ${option} (options: --only <glob>, --reverse, --repeat <n>)` };
    }
  }
  return { ok: true, stages, host };
}

export interface CaseResult {
  title: string;
  file: string;
  state: 'passed' | 'failed' | 'pending';
  error: string | null;
  knownGap: string | null;
  platformSkip?: { capability: string; reason: string };
}

export interface HostResults {
  platform: string;
  cases: CaseResult[];
}

export interface Classification {
  passed: boolean;
  /** Lines that fail the run. */
  failures: string[];
  /** Lines always printed. */
  notices: string[];
}

/** Turns the reporter's results into the lines the runner prints and whether the run passed. */
export function classifyResults(results: HostResults): Classification {
  const failures: string[] = [];
  const notices: string[] = [];
  for (const test of results.cases) {
    if (test.platformSkip) {
      notices.push(`PLATFORM SKIP: ${test.title}: ${test.platformSkip.reason}`);
      if (results.platform !== 'win32') {
        failures.push(`PLATFORM SKIP ON LINUX: ${test.title}`);
      }
    } else if (test.state === 'failed') {
      failures.push(`FAILED: ${test.title}`);
    } else if (test.state === 'pending') {
      failures.push(`SILENT SKIP: ${test.title}`);
    }
  }
  return { passed: failures.length === 0, failures, notices };
}

export function totalsLine(results: HostResults): string {
  let passed = 0;
  let failed = 0;
  let knownGaps = 0;
  let platformSkips = 0;
  for (const test of results.cases) {
    if (test.platformSkip) {
      platformSkips++;
    } else if (test.state === 'failed') {
      failed++;
    } else if (test.state === 'passed') {
      if (test.knownGap) {
        knownGaps++;
      } else {
        passed++;
      }
    }
  }
  return `Totals: ${passed} passed, ${failed} failed, ${knownGaps} known gaps, ${platformSkips} platform skips`;
}

export interface Selection {
  only?: string;
  order?: string;
}

const ROOT_HOOKS = 'out/test/harness/rootHooks.js';

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

/**
 * Sorts the test files, keeps those matching `only` (a glob against the path
 * relative to `root`) and reverses them when asked. The root hooks file, when
 * present, is always first and never filtered or reversed.
 */
export function selectTestFiles(all: readonly string[], selection: Selection, root: string): string[] {
  const relative = (file: string): string => toPosix(path.relative(root, file));
  const matchesGlob = (path as unknown as { matchesGlob: (p: string, pattern: string) => boolean }).matchesGlob;
  const hooks = all.filter((file) => relative(file) === ROOT_HOOKS);
  let files = all.filter((file) => relative(file) !== ROOT_HOOKS).sort();
  if (selection.only) {
    const pattern = selection.only;
    files = files.filter((file) => matchesGlob(relative(file), pattern));
  }
  if (selection.order === 'reverse') {
    files.reverse();
  }
  return [...hooks, ...files];
}
