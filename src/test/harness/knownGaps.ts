/**
 * A test case that fails today because of a defect recorded in a review and
 * scheduled to be fixed by a later roadmap task. The case is marked with
 * `knownGapTest(id, title, fn)`; while it fails with `signature` it passes and
 * is counted as a known gap, and once it passes it fails until the marker and
 * the entry are removed.
 */
export interface KnownGap {
  /** Kebab-case, unique. */
  id: string;
  review: 'the-seed-vscode-1';
  /** 1 to 12, or 'new' for a defect the review does not record. */
  finding: number | 'new';
  /** Required when finding is 'new'. */
  description?: string;
  /** Roadmap task title, exactly as in the roadmap, never a number. */
  fixedBy: string;
  /** At least 12 characters; must appear in the failure message. */
  signature: string;
  /** One sentence: why this case fails today. */
  reason: string;
  /** The titles passed to knownGapTest for this id. */
  cases: string[];
}

export const KNOWN_GAPS: readonly KnownGap[] = [];
