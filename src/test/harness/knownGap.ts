import { KnownGap, KNOWN_GAPS } from './knownGaps';
import { knownGapOutcome } from './results';

type MarkedTest = Mocha.Test & { knownGap?: string };

/**
 * Registers a case that is expected to fail with the signature recorded for
 * `id` in `KNOWN_GAPS`. An unknown id throws while the file loads.
 */
export function knownGapTest(id: string, title: string, fn: (this: Mocha.Context) => void | Promise<void>): void {
  const entry: KnownGap | undefined = KNOWN_GAPS.find((candidate) => candidate.id === id);
  if (!entry) {
    throw new Error(`unknown known gap: ${id} (add it to src/test/harness/knownGaps.ts)`);
  }
  const marked = test(`${title} [known gap: ${entry.review} finding ${entry.finding}]`, async function (this: Mocha.Context) {
    let failure: Error | null = null;
    try {
      await fn.call(this);
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
    }
    knownGapOutcome(entry, title, failure);
  }) as MarkedTest;
  marked.knownGap = id;
}
