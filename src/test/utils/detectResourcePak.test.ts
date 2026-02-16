import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectResourcePak } from '../../utils/detectResourcePak';

suite('detectResourcePak', () => {
  let tempDir: string;

  setup(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-rpak-'));
  });

  teardown(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('detects a valid ResourcePak directory', () => {
    const pkg = {
      name: '@studio/my-assets',
      version: '0.0.1',
      resources: [
        { name: 'texture', filename: 'tex.png', size: 1024 },
        { name: 'sound', filename: 'sfx.wav', size: 2048 },
      ],
    };
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify(pkg));

    const result = detectResourcePak(tempDir);
    assert.ok(result, 'Should detect ResourcePak');
    assert.strictEqual(result!.detected, true);
    assert.strictEqual(result!.pakName, '@studio/my-assets');
    assert.strictEqual(result!.scope, '@studio');
    assert.strictEqual(result!.displayName, 'my-assets');
    assert.strictEqual(result!.resourceCount, 2);
    assert.strictEqual(result!.packageDir, tempDir);
  });

  test('detects ResourcePak with empty resources array', () => {
    const pkg = {
      name: '@dev/empty-pak',
      version: '0.0.1',
      resources: [],
    };
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify(pkg));

    const result = detectResourcePak(tempDir);
    assert.ok(result, 'Should detect ResourcePak with empty resources');
    assert.strictEqual(result!.detected, true);
    assert.strictEqual(result!.resourceCount, 0);
  });

  test('returns null for non-ResourcePak directory', () => {
    const pkg = {
      name: 'regular-package',
      version: '1.0.0',
      main: 'index.js',
    };
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify(pkg));

    const result = detectResourcePak(tempDir);
    assert.strictEqual(result, null);
  });

  test('returns null for missing package.json', () => {
    const result = detectResourcePak(tempDir);
    assert.strictEqual(result, null);
  });

  test('returns null for malformed JSON', () => {
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{ invalid json }');

    const result = detectResourcePak(tempDir);
    assert.strictEqual(result, null);
  });

  test('returns null when resources is not an array', () => {
    const pkg = {
      name: '@test/not-array',
      version: '0.0.1',
      resources: 'not-an-array',
    };
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify(pkg));

    const result = detectResourcePak(tempDir);
    assert.strictEqual(result, null);
  });

  test('handles unscoped package name', () => {
    const pkg = {
      name: 'flat-pak',
      version: '0.0.1',
      resources: [],
    };
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify(pkg));

    const result = detectResourcePak(tempDir);
    assert.ok(result, 'Should detect ResourcePak');
    assert.strictEqual(result!.pakName, 'flat-pak');
    assert.strictEqual(result!.scope, '');
    assert.strictEqual(result!.displayName, 'flat-pak');
  });

  test('returns null for non-existent directory', () => {
    const result = detectResourcePak('/tmp/non-existent-dir-' + Date.now());
    assert.strictEqual(result, null);
  });
});
