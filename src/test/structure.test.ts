// Each operation exists in one place: the host sources (everything under src/
// except the tests and the webview page) are read and checked for the shapes
// that would mean a second copy of an operation.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '..', '..', 'src');
const EXCLUDED = [path.join(SRC, 'test'), path.join(SRC, 'webview')];

/** Every TypeScript file of the extension host, as a path relative to src/ with forward slashes. */
function hostSources(dir: string = SRC): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED.includes(full)) {
        found.push(...hostSources(full));
      }
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      found.push(path.relative(SRC, full).split(path.sep).join('/'));
    }
  }
  return found.sort();
}

function read(relative: string): string {
  return fs.readFileSync(path.join(SRC, relative), 'utf-8');
}

suite('Structure: each operation exists in one place', () => {
  test('the host sources are found', () => {
    const sources = hostSources();
    for (const expected of ['extension.ts', 'panels/messageHandler.ts', 'build/buildStart.ts']) {
      assert.ok(sources.includes(expected), `${expected} is among the host sources`);
    }
    assert.ok(!sources.some((source) => source.startsWith('test/') || source.startsWith('webview/')), 'tests and the webview page are not host sources');
  });

  test('the sidebar\'s message handler does not install dependencies itself', () => {
    const handler = read('panels/messageHandler.ts');
    for (const name of ['getInstallSteps', 'acquireOperationLock', 'runInstallSteps']) {
      assert.ok(!new RegExp(`\\b${name}\\s*\\(`).test(handler), `messageHandler.ts calls ${name}`);
    }
  });

  test('the project search is written once, in the build start', () => {
    const search = /findFiles\(\s*['"`]\*\*\/package\.json/;
    const users = hostSources().filter((source) => search.test(read(source)));
    assert.deepStrictEqual(users, ['build/buildStart.ts']);
  });

  test('no command is written inline in extension.ts', () => {
    assert.ok(!/wrapCommand\(\s*async\b/.test(read('extension.ts')), 'extension.ts contains wrapCommand(async');
  });
});
