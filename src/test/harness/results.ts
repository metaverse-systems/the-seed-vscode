import * as path from 'path';
import type { KnownGap } from './knownGaps';

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
export function classifyResults(results: HostResults, gaps: readonly KnownGap[] = []): Classification {
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
    } else if (test.knownGap) {
      const entry = gaps.find((candidate) => candidate.id === test.knownGap);
      if (entry) {
        notices.push(`KNOWN GAP: ${test.title} (${entry.review} finding ${entry.finding}; fixed by "${entry.fixedBy}")`);
      }
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

export interface KnownGapValidation {
  violations: string[];
  notices: string[];
}

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MARKED_CALL = /^[ \t]*knownGapTest\(\s*'([a-z0-9-]+)'\s*,\s*'([^']*)'/gm;

/** The `knownGapTest('<id>', '<title>'` calls in the given sources, as id to titles. */
function markedCases(sources: readonly { file: string; text: string }[]): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const source of sources) {
    for (const match of source.text.matchAll(MARKED_CALL)) {
      const titles = found.get(match[1]) ?? [];
      titles.push(match[2]);
      found.set(match[1], titles);
    }
  }
  return found;
}

function roadmapTaskTitles(roadmap: string): Set<string> {
  const titles = new Set<string>();
  for (const match of roadmap.matchAll(/^- \[[ xX]\] \*\*Task \d+ — (.+?)\*\*/gm)) {
    titles.add(match[1].trim());
  }
  return titles;
}

/** The findings listed in the order-table row of the task with the given title, or null when there is no row. */
function orderTableFindings(roadmap: string, title: string): number[] | null {
  for (const match of roadmap.matchAll(/^\|\s*\d+\.\s*(.+?)\s*\|([^|]*)\|/gm)) {
    if (match[1].trim() === title) {
      return match[2]
        .replace(/\([^)]*\)/g, '')
        .split(',')
        .map((part) => part.trim())
        .filter((part) => /^\d+$/.test(part))
        .map(Number);
    }
  }
  return null;
}

/**
 * Checks the known-gap list: each entry's fields, the match between each
 * entry's cases and the `knownGapTest` calls in the sources, and, when the
 * parent documents are given, the references to the review and the roadmap.
 */
export function validateKnownGaps(
  entries: readonly KnownGap[],
  sources: readonly { file: string; text: string }[],
  parentDocs?: { review: string; roadmap: string }
): KnownGapValidation {
  const violations: string[] = [];
  const notices: string[] = [];
  const report = (detail: string): void => {
    violations.push(`MALFORMED KNOWN GAP: ${detail}`);
  };

  const marked = markedCases(sources);
  const seen = new Set<string>();
  const taskTitles = parentDocs ? roadmapTaskTitles(parentDocs.roadmap) : new Set<string>();

  for (const entry of entries) {
    const name = `"${entry.id}"`;
    if (typeof entry.id !== 'string' || !KEBAB_CASE.test(entry.id)) {
      report(`${name}: id must be kebab-case`);
    }
    if (seen.has(entry.id)) {
      report(`${name}: duplicate id`);
    }
    seen.add(entry.id);
    if (entry.review !== 'the-seed-vscode-1') {
      report(`${name}: review must be "the-seed-vscode-1"`);
    }
    const isNew = entry.finding === 'new';
    if (!isNew && !(Number.isInteger(entry.finding) && (entry.finding as number) >= 1 && (entry.finding as number) <= 12)) {
      report(`${name}: finding must be an integer from 1 to 12, or "new"`);
    }
    if (isNew && (typeof entry.description !== 'string' || entry.description.trim() === '')) {
      report(`${name}: description is required when finding is "new"`);
    }
    if (typeof entry.fixedBy !== 'string' || entry.fixedBy.trim() === '') {
      report(`${name}: fixedBy must be a non-empty roadmap task title`);
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      report(`${name}: reason must be non-empty`);
    }
    if (typeof entry.signature !== 'string' || entry.signature.length < 12) {
      report(`${name}: signature must be at least 12 characters`);
    }

    const expected = [...new Set(marked.get(entry.id) ?? [])].sort();
    const actual = [...new Set(entry.cases ?? [])].sort();
    if (expected.length !== actual.length || expected.some((title, index) => title !== actual[index])) {
      report(`${name}: cases ${JSON.stringify(actual)} do not match the knownGapTest titles ${JSON.stringify(expected)}`);
    }

    if (parentDocs) {
      if (!isNew && Number.isInteger(entry.finding)
        && !new RegExp(`^### ${entry.finding}\\.`, 'm').test(parentDocs.review)) {
        report(`${name}: finding ${entry.finding} has no "### ${entry.finding}." heading in the review`);
      }
      if (typeof entry.fixedBy === 'string' && entry.fixedBy.trim() !== '') {
        if (!taskTitles.has(entry.fixedBy)) {
          report(`${name}: fixedBy "${entry.fixedBy}" is not a roadmap task title`);
        } else if (!isNew && Number.isInteger(entry.finding)) {
          const listed = orderTableFindings(parentDocs.roadmap, entry.fixedBy);
          if (!listed || !listed.includes(entry.finding as number)) {
            report(`${name}: the roadmap's order table does not list finding ${entry.finding} for "${entry.fixedBy}"`);
          }
        }
      }
    }
  }

  for (const id of marked.keys()) {
    if (!entries.some((entry) => entry.id === id)) {
      report(`"${id}": used by knownGapTest but not listed in knownGaps.ts`);
    }
  }

  if (!parentDocs) {
    notices.push('Known-gap references not checked against the review: the parent repository is not present.');
  }
  return { violations, notices };
}

/**
 * Decides a marked case's result from the error it threw (null when it passed):
 * returns when the error carries the entry's signature, rethrows any other
 * error, and fails a case that now passes.
 */
export function knownGapOutcome(entry: KnownGap, title: string, error: Error | null): void {
  if (error === null) {
    throw new Error(
      `STALE KNOWN GAP: ${entry.id} (${entry.review} finding ${entry.finding}, fixed by "${entry.fixedBy}"): ` +
      `"${title}" now passes; remove the knownGapTest marker and the entry from src/test/harness/knownGaps.ts`
    );
  }
  if (!error.message.includes(entry.signature)) {
    throw error;
  }
}

/**
 * Lines for scratch directories left behind: each entry present after the run
 * and not before it, then the scratch home's configuration directory when it
 * exists (`scratchHomeTheSeedPath` is its path, or null when it does not).
 */
export function compareLeftovers(
  before: readonly string[],
  after: readonly string[],
  scratchHomeTheSeedPath: string | null
): string[] {
  const known = new Set(before);
  const lines = after.filter((entry) => !known.has(entry)).map((entry) => `LEFTOVER: ${entry}`);
  if (scratchHomeTheSeedPath !== null) {
    lines.push(`LEFTOVER: ${scratchHomeTheSeedPath}`);
  }
  return lines;
}

export interface RealHomeGuard {
  /** SHA-256 hex of the configuration file, or 'absent'. */
  configHash: string;
  /** Modification time in milliseconds of each name directly inside the configuration directory. */
  entries: Record<string, number>;
}

/** Lines for every difference between two recordings of the real home's configuration directory. */
export function compareRealHome(before: RealHomeGuard, after: RealHomeGuard): string[] {
  const prefix = 'REAL HOME CHANGED: ';
  const lines: string[] = [];
  if (before.configHash !== after.configHash) {
    if (before.configHash === 'absent') {
      lines.push(`${prefix}config.json was absent and now exists`);
    } else if (after.configHash === 'absent') {
      lines.push(`${prefix}config.json existed and is now absent`);
    } else {
      lines.push(`${prefix}config.json checksum changed (${before.configHash} to ${after.configHash})`);
    }
  }
  for (const name of Object.keys(after.entries)) {
    if (!(name in before.entries)) {
      lines.push(`${prefix}${name} was added`);
    } else if (before.entries[name] !== after.entries[name]) {
      lines.push(`${prefix}${name} modification time changed`);
    }
  }
  for (const name of Object.keys(before.entries)) {
    if (!(name in after.entries)) {
      lines.push(`${prefix}${name} was removed`);
    }
  }
  return lines;
}
