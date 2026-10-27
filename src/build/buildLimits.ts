// The build limits: checking a typed or saved value, and working out what a
// build will use, by the same rules as the-seed's `--parallel` and `--jobs`.
// The tool does not export these rules, so they are copied here and pinned to
// the tool by the parity tests.
import * as os from 'os';

export type LimitName = 'parallel' | 'jobs';
export type LimitSource = 'this build' | 'workspace default';

export interface RequestedLimit {
  value: number;
  source: LimitSource;
}

/** What one build asks for, before the tool reduces anything. An absent limit is not passed to the tool. */
export interface BuildLimitRequest {
  parallel?: RequestedLimit;
  jobs?: RequestedLimit;
}

export type ReductionCause = 'the processor count' | 'the job limit';

export interface Reduction {
  requested: number;
  to: number;
  cause: ReductionCause;
}

/** What a build uses, for reporting only: the tool is given the requested values. */
export interface EffectiveLimits {
  jobs: number;
  jobsSource: LimitSource | 'processor count';
  /** Recursive builds only. */
  parallel?: number;
  parallelSource?: LimitSource | 'default';
  reductions: Reduction[];
}

export type Parsed = { ok: true; value: number } | { ok: false; message: string };

export const SETTING_NAMES: Record<LimitName, 'the-seed.build.parallel' | 'the-seed.build.jobs'> = {
  parallel: 'the-seed.build.parallel',
  jobs: 'the-seed.build.jobs',
};

const LABELS: Record<LimitName, string> = {
  parallel: 'the project count',
  jobs: 'the job limit',
};

/** What a build uses in place of an invalid saved value. */
const FALLBACKS: Record<LimitName, string> = {
  parallel: '1 project at a time',
  jobs: 'the processor count',
};

/** How a limit is named in messages. */
export function limitLabel(name: LimitName): string {
  return LABELS[name];
}

/** Text typed by the user: surrounding whitespace is ignored, then it must be a positive whole number. */
export function parseLimitText(raw: string, name: LimitName): Parsed {
  const text = raw.trim();
  if (/^[1-9][0-9]*$/.test(text)) {
    const value = Number(text);
    if (Number.isSafeInteger(value)) {
      return { ok: true, value };
    }
  }
  return { ok: false, message: `Invalid value "${raw}" for ${LABELS[name]}; expected a positive whole number.` };
}

/** A stored value, shown as it would appear in the settings file. */
function showValue(raw: unknown): string {
  if (typeof raw === 'number' && !Number.isFinite(raw)) {
    return String(raw);
  }
  try {
    return JSON.stringify(raw) ?? String(raw);
  } catch {
    return String(raw);
  }
}

/** A saved setting value. Missing or null means no value; anything but a positive whole number is an error. */
export function parseLimitSetting(
  raw: unknown,
  name: LimitName
): { ok: true; value: number | undefined } | { ok: false; message: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, value: undefined };
  }
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 1) {
    return { ok: true, value: raw };
  }
  return {
    ok: false,
    message: `The setting "${SETTING_NAMES[name]}" is ${showValue(raw)}; expected a positive whole number. Using ${FALLBACKS[name]} for this build.`,
  };
}

/** The processor count, as the tool works it out. */
export function processorCount(): number {
  return Math.max(1, os.availableParallelism());
}

/**
 * The limits a build uses. The job limit is used as given, or the processor count. A recursive build's
 * project count (1 when not given) is reduced to the processor count and to the job limit.
 */
export function effectiveLimits(request: BuildLimitRequest, recursive: boolean, processors: number): EffectiveLimits {
  const jobs = request.jobs?.value ?? processors;
  const jobsSource = request.jobs?.source ?? 'processor count';
  if (!recursive) {
    return { jobs, jobsSource, reductions: [] };
  }

  const requested = request.parallel?.value ?? 1;
  const parallel = Math.min(requested, processors, jobs);
  const reductions: Reduction[] = [];
  if (parallel < requested) {
    const cause: ReductionCause = request.jobs !== undefined && jobs <= processors ? 'the job limit' : 'the processor count';
    reductions.push({ requested, to: parallel, cause });
  }
  return { jobs, jobsSource, parallel, parallelSource: request.parallel?.source ?? 'default', reductions };
}

/** The output-panel line stating the limits a build uses. */
export function limitsLine(effective: EffectiveLimits): string {
  const jobs = `${effective.jobs} compile ${effective.jobs === 1 ? 'job' : 'jobs'} (${effective.jobsSource})`;
  if (effective.parallel === undefined) {
    return `Build limits: ${jobs}`;
  }
  const projects = effective.parallel === 1 ? '1 project at a time' : `up to ${effective.parallel} projects at once`;
  const reduction = effective.reductions[0];
  const why = reduction
    ? `requested ${reduction.requested}, reduced to ${reduction.cause}`
    : effective.parallelSource ?? 'default';
  return `Build limits: ${projects} (${why}), ${jobs}`;
}
