// Each operation exists in one place: the host sources (everything under src/
// except the tests and the webview page) are read and checked for the shapes
// that would mean a second copy of an operation. The repository is also checked
// for leftovers: generator files, dead test directories, ignore rules that
// negate nothing and devDependencies nothing imports.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { EXPECTED_PACKAGE_FILES } from './harness/packageContents';

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

  test('no host source assigns console.log, console.error or console.warn', () => {
    // The console is shared with every other extension in the host; the tool's output is taken through its run options
    const assignment = /\bconsole\s*(?:\.\s*(?:log|error|warn)|\[\s*['"`](?:log|error|warn)['"`]\s*\])\s*=(?!=)/;
    const assigning = hostSources().filter((source) => assignment.test(read(source)));
    assert.deepStrictEqual(assigning, [], 'host sources that assign a console method');
  });

  test('dependency installation has no step runner of its own', () => {
    // The install steps are run by the tool's runInstallSteps. The removed names are spelled in
    // parts so that a search of src/ for them finds nothing, this rule included.
    const module = ['build', 'Runner'].join('');
    const runner = ['run', 'Build', 'Steps'].join('');
    assert.ok(!fs.existsSync(path.join(SRC, 'build', `${module}.ts`)), `src/build/${module}.ts exists`);
    const users = hostSources().filter((source) => new RegExp(`\\b(?:${runner}|${module})\\b`).test(read(source)));
    assert.deepStrictEqual(users, [], `host sources that name ${runner} or ${module}`);
  });

  test('no command is written inline in extension.ts', () => {
    assert.ok(!/wrapCommand\(\s*async\b/.test(read('extension.ts')), 'extension.ts contains wrapCommand(async');
  });
});

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'out');

/** Every file under a directory, as paths relative to it with forward slashes. */
function filesUnder(dir: string, base: string = dir): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...filesUnder(full, base));
    } else if (entry.isFile()) {
      found.push(path.relative(base, full).split(path.sep).join('/'));
    }
  }
  return found.sort();
}

/** The non-comment, non-empty lines of an ignore file at the extension root. */
function ignoreRules(name: string): string[] {
  return fs.readFileSync(path.join(ROOT, name), 'utf-8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

suite('Repository hygiene', () => {
  test('the generator\'s quick-start notes are not kept', () => {
    assert.ok(!fs.existsSync(path.join(ROOT, 'vsc-extension-quickstart.md')), 'vsc-extension-quickstart.md exists');
  });

  test('there is no test directory at the extension root', () => {
    assert.ok(!fs.existsSync(path.join(ROOT, 'test')), 'a test/ directory exists at the extension root');
  });

  test('every compiled test comes from a source under src/test', () => {
    const outside = filesUnder(OUT).filter((file) => file.endsWith('.test.js') && !file.startsWith('test/'));
    assert.deepStrictEqual(outside, [], 'compiled tests outside out/test');
    const orphans = filesUnder(path.join(OUT, 'test'))
      .filter((file) => file.endsWith('.js'))
      .filter((file) => !fs.existsSync(path.join(SRC, 'test', file.replace(/\.js$/, '.ts'))));
    assert.deepStrictEqual(orphans, [], 'compiled files under out/test with no source under src/test');
  });

  test('every negation in .vscodeignore names a shipped file', () => {
    const shipped = new Set(EXPECTED_PACKAGE_FILES
      .filter((entry) => entry.startsWith('extension/'))
      .map((entry) => entry.slice('extension/'.length).toLowerCase())
      .map((name) => (name === 'license.txt' ? 'license' : name)));
    const unknown = ignoreRules('.vscodeignore')
      .filter((rule) => rule.startsWith('!'))
      .map((rule) => rule.slice(1))
      .filter((name) => !shipped.has(name.toLowerCase()));
    assert.deepStrictEqual(unknown, [], '.vscodeignore negations that name no shipped file');
  });

  test('.gitignore has no negations', () => {
    const negations = ignoreRules('.gitignore').filter((rule) => rule.startsWith('!'));
    assert.deepStrictEqual(negations, [], '.gitignore negations');
  });

  test('@vscode-elements/react-elements is not a devDependency unless something imports it', () => {
    const name = '@vscode-elements/react-elements';
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')) as { devDependencies?: Record<string, string> };
    if (!manifest.devDependencies || !(name in manifest.devDependencies)) {
      return;
    }
    const quoted = name.replace(/[/.-]/g, '\\$&');
    const usage = new RegExp(`(?:\\bfrom\\s*|\\bimport\\s*\\(?\\s*|\\brequire\\s*\\(\\s*)['"\`]${quoted}(?:/[^'"\`]*)?['"\`]`);
    const importers = [
      ...filesUnder(SRC).filter((file) => /\.tsx?$/.test(file)).map((file) => path.join(SRC, file)),
      path.join(ROOT, 'vite.config.webview.mts'),
    ].filter((file) => fs.existsSync(file) && usage.test(fs.readFileSync(file, 'utf-8')));
    assert.ok(importers.length > 0, `${name} is a devDependency that nothing imports`);
  });
});
