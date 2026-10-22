import * as fs from 'fs';
import * as path from 'path';
import Mocha = require('mocha');

interface RecordedCase {
  title: string;
  file: string;
  state: 'passed' | 'failed' | 'pending';
  error: string | null;
  knownGap: string | null;
  platformSkip?: { capability: string; reason: string };
}

type ExtendedTest = Mocha.Test & {
  knownGap?: string;
  platformSkip?: { capability: string; reason: string };
};

/** Prints Mocha's spec output and writes the per-case results file named by THE_SEED_TEST_RESULTS. */
class HostReporter extends Mocha.reporters.Spec {
  constructor(runner: Mocha.Runner, options?: Mocha.MochaOptions) {
    super(runner, options);
    const cases: RecordedCase[] = [];
    const extensionRoot = path.resolve(__dirname, '..', '..', '..');

    const record = (test: Mocha.Runnable, state: RecordedCase['state'], error?: Error): void => {
      const extended = test as ExtendedTest;
      const file = test.file ? path.relative(extensionRoot, test.file).split(path.sep).join('/') : '';
      const entry: RecordedCase = {
        title: test.fullTitle(),
        file,
        state,
        error: error ? (error.message ?? String(error)) : null,
        knownGap: extended.knownGap ?? null,
      };
      if (extended.platformSkip) {
        entry.platformSkip = extended.platformSkip;
      }
      cases.push(entry);
    };

    runner.on('pass', (test) => record(test, 'passed'));
    runner.on('pending', (test) => record(test, 'pending'));
    runner.on('fail', (test, error) => {
      const alreadyRecorded = cases.some((entry) => entry.title === test.fullTitle() && entry.state === 'failed');
      if (!alreadyRecorded) {
        record(test, 'failed', error);
      }
    });
    runner.once('end', () => {
      const target = process.env.THE_SEED_TEST_RESULTS;
      if (!target) {
        return;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify({ platform: process.platform, cases }, null, 2));
    });
  }
}

export = HostReporter;
