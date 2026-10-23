// Checks that the suite runs against the single host bundle the editor activates.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const BUNDLE_PATH = path.join(ROOT, 'dist', 'extension.js');

interface Bundle {
  bundledModules: Record<string, unknown>;
}

// Relative paths (forward slashes, no extension) of every file under a directory with the extension.
function listModules(directory: string, extension: string, skip: (relative: string) => boolean): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const relative = path.relative(directory, full).split(path.sep).join('/');
      if (skip(relative)) {
        continue;
      }
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(extension)) {
        found.push(relative.slice(0, relative.length - extension.length));
      }
    }
  };
  walk(directory);
  return found.sort();
}

suite('Bundle: the suite runs against dist/extension.js', () => {
  let bundle: Bundle;

  suiteSetup(() => {
    bundle = require(BUNDLE_PATH) as Bundle;
  });

  test('a compiled module is the bundle\'s module, not a second copy', () => {
    const compiled = require('../../operationLock');
    assert.ok(bundle.bundledModules['operationLock'], 'the bundle has no operationLock entry');
    assert.strictEqual(compiled, bundle.bundledModules['operationLock']);
  });

  test('the tool service the tests see is the one the editor activated', () => {
    const { activeToolService } = require('../../tool/toolService') as typeof import('../../tool/toolService');
    const bundled = bundle.bundledModules['tool/toolService'] as typeof import('../../tool/toolService');
    assert.strictEqual(activeToolService(), bundled.activeToolService());
    assert.strictEqual(activeToolService().status.state, 'usable');
  });

  test('every compiled host file has a bundle entry and every entry has a source file', () => {
    const compiled = listModules(
      path.join(ROOT, 'out'),
      '.js',
      (relative) => relative === 'test' || relative === 'webview'
    );
    const sources = listModules(
      path.join(ROOT, 'src'),
      '.ts',
      (relative) => relative === 'test' || relative === 'webview' || relative.endsWith('.d.ts')
    );
    const keys = Object.keys(bundle.bundledModules).sort();
    assert.deepStrictEqual(
      compiled.filter((name) => !keys.includes(name)),
      [],
      'compiled host files with no bundle entry'
    );
    assert.deepStrictEqual(
      keys.filter((name) => !sources.includes(name)),
      [],
      'bundle entries with no source file'
    );
  });

  test('the bundle does not contain the tool and has no source map reference', () => {
    const text = fs.readFileSync(BUNDLE_PATH, 'utf8');
    assert.ok(!text.includes('require("@metaverse-systems/the-seed'), 'the bundle requires the tool by name');
    assert.ok(!text.includes('sourceMappingURL'), 'the bundle refers to a source map');
  });
});
