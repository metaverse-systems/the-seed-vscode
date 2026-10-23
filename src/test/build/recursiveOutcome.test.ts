import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { makeScratchDir } from '../helpers/workspaceStub';
import { discoveryFailure } from '../../build/recursiveOutcome';
import { testTool } from '../helpers/tool';

// Choices made where the contract leaves a detail open (the implementation matches these):
// - `discoveryFailure` returns the object with exactly the keys `status`, `complete` and `message`,
//   compared here with deepStrictEqual, so no extra keys (such as `failedProject`) are added.
// - The status carries no step fields: only `state`, `target`, `errorMessage` and `timestamp`.

suite('recursiveOutcome', () => {
  const timestamp = '2026-01-02T03:04:05.000Z';

  function expectFailure(error: Error, target: 'native' | 'windows'): void {
    const outcome = discoveryFailure(error, target, timestamp, testTool());
    assert.ok(outcome, 'a discovery error gives an outcome');
    assert.deepStrictEqual(outcome.status, {
      state: 'failed',
      target: `${target} (recursive)`,
      errorMessage: error.message,
      timestamp,
    });
    assert.deepStrictEqual(outcome.complete, { success: false, completedCount: 0, totalCount: 0 });
    assert.strictEqual(outcome.message, error.message);
  }

  test('a cycle gives the failed status with the tool message', () => {
    const error = new (testTool().CyclicDependencyError)(['@t/a', '@t/b'], ['/x/a', '/x/b']);
    assert.ok(error.message.includes('@t/a'));
    expectFailure(error, 'native');
  });

  test('a conflicting project gives the failed status for the windows target', () => {
    expectFailure(new (testTool().ConflictingProjectError)('@t/a', '/x/one', '/x/two'), 'windows');
  });

  test('an unreadable manifest gives the failed status', () => {
    expectFailure(new (testTool().ProjectManifestError)('/x/package.json', 'no such file or directory'), 'native');
  });

  test('a plain Error gives null', () => {
    assert.strictEqual(discoveryFailure(new Error('boom'), 'native', timestamp, testTool()), null);
  });

  test('a cancelled discovery gives null', () => {
    assert.strictEqual(discoveryFailure(new (testTool().DiscoveryCancelledError)(), 'native', timestamp, testTool()), null);
  });

  test('a non-error value gives null', () => {
    assert.strictEqual(discoveryFailure('text', 'native', timestamp, testTool()), null);
    assert.strictEqual(discoveryFailure(undefined, 'windows', timestamp, testTool()), null);
  });

  suite('with the linked tool', () => {
    let tmpDir: string;
    const originalReadFile = fs.promises.readFile;

    setup(() => {
      tmpDir = makeScratchDir('recursive-outcome');
    });

    teardown(() => {
      fs.promises.readFile = originalReadFile;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function writeProject(dir: string, name: string, dependencies: Record<string, string>): void {
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', dependencies }));
      fs.writeFileSync(path.join(dir, 'src', 'Makefile.am'), 'lib_LTLIBRARIES = libx.la\nlibx_la_SOURCES = x.cpp\n');
    }

    function link(projectDir: string, name: string, target: string): void {
      const linkPath = path.join(projectDir, 'node_modules', name);
      fs.mkdirSync(path.dirname(linkPath), { recursive: true });
      fs.symlinkSync(target, linkPath, 'junction');
    }

    test('a real two-project cycle becomes a failed build, within 200 file reads', async function () {
      this.timeout(5000);
      const a = path.join(tmpDir, 'a');
      const b = path.join(tmpDir, 'b');
      writeProject(a, '@t/a', { '@t/b': '1.0.0' });
      writeProject(b, '@t/b', { '@t/a': '1.0.0' });
      link(a, '@t/b', b);
      link(b, '@t/a', a);

      let reads = 0;
      const previous = fs.promises.readFile;
      fs.promises.readFile = ((...args: Parameters<typeof previous>) => {
        reads++;
        if (reads > 200) {
          return Promise.reject(new Error('walk did not finish: more than 200 file reads'));
        }
        return previous(...args);
      }) as typeof previous;

      let caught: unknown;
      try {
        await testTool().walkDependencies(a);
      } catch (error) {
        caught = error;
      } finally {
        fs.promises.readFile = previous;
      }

      const outcome = discoveryFailure(caught, 'native', timestamp, testTool());
      assert.ok(outcome, `the rejection is a discovery error: ${String(caught)}`);
      assert.ok(outcome.message.includes('Dependency cycle'), outcome.message);
      assert.strictEqual(outcome.status.state, 'failed');
      assert.strictEqual(outcome.status.target, 'native (recursive)');
      assert.strictEqual(outcome.status.errorMessage, outcome.message);
      assert.strictEqual(outcome.complete.success, false);
    });
  });
});
