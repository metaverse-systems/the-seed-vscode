import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { makeScratchDir } from '../helpers/workspaceStub';
import { packageStatusFrom, packageNotification } from '../../build/packageOutcome';
import { onPlatform } from '../harness/platform';
import type { PackageResult } from '@metaverse-systems/the-seed/types';
import { testTool } from '../helpers/tool';

// Choices made where the contract leaves a detail open (the implementation matches these):
// - `packageStatusFrom` returns exactly the keys the contract lists (no `currentFile`), compared
//   with deepStrictEqual.
// - The notification text on a refusal uses the text before the first newline of `message`, and
//   `Packaging failed` alone when `message` is null or empty.

suite('packageOutcome', () => {
  const timestamp = '2026-01-02T03:04:05.000Z';

  function result(overrides: Partial<PackageResult>): PackageResult {
    return {
      success: true,
      message: null,
      outputDir: '/x/dist',
      projects: ['/x/app'],
      files: ['app', 'libfoo.so.1'],
      signatures: 2,
      fileCount: 4,
      notPackaged: [],
      ...overrides,
    };
  }

  test('success maps fileCount, signatures included, to filesCopied and totalFiles', () => {
    assert.deepStrictEqual(packageStatusFrom(result({}), timestamp), {
      state: 'completed',
      filesCopied: 4,
      totalFiles: 4,
      timestamp,
    });
  });

  test('success notification names the count', () => {
    assert.deepStrictEqual(packageNotification(result({})), { kind: 'info', text: 'Packaged 4 files into dist/' });
  });

  test('a refusal maps the message to errorMessage with no files copied', () => {
    const message = 'Two different files would be packaged as app:\n  build of @t/one\n  build of @t/two\nNothing was written.';
    const refused = result({ success: false, message, files: [], signatures: 0, fileCount: 0, projects: [] });
    assert.deepStrictEqual(packageStatusFrom(refused, timestamp), {
      state: 'failed',
      errorMessage: message,
      filesCopied: 0,
      timestamp,
    });
  });

  test('a refusal notification shows the first line of the message', () => {
    const message = 'Two different files would be packaged as app:\n  build of @t/one';
    const refused = result({ success: false, message, fileCount: 0 });
    assert.deepStrictEqual(packageNotification(refused), {
      kind: 'error',
      text: 'Packaging failed: Two different files would be packaged as app:',
    });
  });

  test('a failure with a null message says only Packaging failed', () => {
    const failed = result({ success: false, message: null, fileCount: 0 });
    assert.deepStrictEqual(packageStatusFrom(failed, timestamp), {
      state: 'failed',
      errorMessage: 'Packaging failed',
      filesCopied: 0,
      timestamp,
    });
    assert.deepStrictEqual(packageNotification(failed), { kind: 'error', text: 'Packaging failed' });
  });

  suite('with the linked tool', () => {
    let tmpDir: string;

    setup(() => {
      tmpDir = makeScratchDir('package-outcome');
    });

    teardown(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('a real collision between two build outputs is a failed status and writes nothing', async function () {
      this.timeout(5000);
      const dirs = ['one', 'two'].map((name) => {
        const projectDir = path.join(tmpDir, name);
        fs.mkdirSync(path.join(projectDir, 'src', '.libs'), { recursive: true });
        fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: '@t/' + name, version: '1.0.0' }));
        fs.writeFileSync(path.join(projectDir, 'src', 'Makefile.am'), 'bin_PROGRAMS = app\napp_SOURCES = app.cpp\n');
        fs.writeFileSync(path.join(projectDir, 'src', '.libs', 'app'), 'content of ' + name);
        return projectDir;
      });
      const configDir = path.join(tmpDir, 'config');
      const config = new (testTool().Config)(configDir);
      config.config.prefix = path.join(tmpDir, 'prefix');
      const outputDir = path.join(tmpDir, 'dist');

      const packaged: PackageResult = await new (testTool().Package)(config).run(outputDir, dirs, { log: () => undefined });

      assert.strictEqual(packaged.success, false);
      const status = packageStatusFrom(packaged, timestamp);
      assert.strictEqual(status.state, 'failed');
      assert.strictEqual(status.filesCopied, 0);
      await onPlatform({
        win32: () => {
          assert.strictEqual(packaged.message, testTool().nativeComponentMessage());
          assert.strictEqual(status.errorMessage, testTool().nativeComponentMessage());
        },
        other: () => {
          assert.ok((status.errorMessage ?? '').includes('Two different files would be packaged as app:'), String(status.errorMessage));
          assert.ok(packageNotification(packaged).text.startsWith('Packaging failed: Two different files'));
        },
      });
      assert.strictEqual(fs.existsSync(outputDir), false);
    });
  });
});
