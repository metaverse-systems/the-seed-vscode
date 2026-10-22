import * as fs from 'fs';
import * as path from 'path';
import { getOperationLock, releaseOperationLock } from '../../operationLock';

/**
 * Root-level hook, loaded before every suite: after each case (and after the
 * suite's own teardown) it fails the case if the scratch state leaked. The
 * leaked state is cleaned up first so the next case starts clean.
 */
teardown(function () {
  const scratchHome = process.env.THE_SEED_TEST_HOME;
  const problems: string[] = [];

  if (scratchHome !== undefined && (process.env.HOME !== scratchHome || process.env.USERPROFILE !== scratchHome)) {
    problems.push('scratch home not restored');
    process.env.HOME = scratchHome;
    process.env.USERPROFILE = scratchHome;
  }

  if (scratchHome !== undefined) {
    const written = path.join(scratchHome, 'the-seed');
    if (fs.existsSync(written)) {
      problems.push("configuration written outside the suite's scratch state");
      fs.rmSync(written, { recursive: true, force: true });
    }
  }

  const lock = getOperationLock();
  if (lock.active) {
    problems.push(`operation lock still held by ${lock.type}`);
    releaseOperationLock();
  }

  if (problems.length > 0) {
    throw new Error(problems.join('; '));
  }
});
