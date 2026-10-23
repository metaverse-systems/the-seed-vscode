import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { DEV_DEPENDENCY_DIR, EXPECTED_EXPORTS, makeStubTool, stubLoadError, useScratchDirs } from '../helpers/stubTool';

// Loading reads a package directory through its own entry points. The module is loaded when a case runs.
interface LoadFailureLike extends Error { firstLine: string }

interface LoadToolModule {
  loadInstallation(packageDir: string): Record<string, unknown>;
  LoadFailure: new (...args: never[]) => LoadFailureLike;
}

const loader = (): LoadToolModule => require('../../tool/loadTool') as LoadToolModule;

function isClass(value: unknown): boolean {
  return typeof value === 'function' && /^class[\s{]/.test(Function.prototype.toString.call(value));
}

function kindOf(value: unknown): string {
  if (isClass(value)) {
    return 'class';
  }
  return typeof value;
}

function failureOf(load: () => unknown): LoadFailureLike {
  try {
    load();
  } catch (error) {
    assert.ok(error instanceof loader().LoadFailure, `expected a LoadFailure, got ${String(error)}`);
    return error as LoadFailureLike;
  }
  assert.fail('loading did not fail');
}

suite('loading the tool', () => {
  const scratch = useScratchDirs();

  test('the extension\'s own copy loads into a frozen API with every member of the right kind', () => {
    const api = loader().loadInstallation(DEV_DEPENDENCY_DIR);
    assert.ok(Object.isFrozen(api), 'the API is not frozen');
    for (const item of EXPECTED_EXPORTS) {
      assert.ok(item.member in api, `missing member ${item.member}`);
      assert.strictEqual(kindOf(api[item.member]), item.kind, `${item.member} (${item.subpath}/${item.exportName})`);
    }
  });

  test('the members are the tool\'s own values, taken from the copy that was loaded', () => {
    const api = loader().loadInstallation(DEV_DEPENDENCY_DIR);
    const requireFromTool = require('module').createRequire(path.join(fs.realpathSync(DEV_DEPENDENCY_DIR), 'package.json')) as NodeRequire;
    const config = requireFromTool('@metaverse-systems/the-seed/Config') as { default: unknown; ConfigError: unknown };
    assert.strictEqual(api.Config, config.default);
    assert.strictEqual(api.ConfigError, config.ConfigError);
    const signing = requireFromTool('@metaverse-systems/the-seed/Signing') as { DEFAULT_VALIDITY_DAYS: number };
    assert.strictEqual(api.DEFAULT_VALIDITY_DAYS, signing.DEFAULT_VALIDITY_DAYS);
  });

  test('a stub with every export loads', () => {
    const dir = makeStubTool(scratch.dir('stub'), { version: '2.0.0' });
    const api = loader().loadInstallation(dir);
    assert.ok(Object.isFrozen(api));
    for (const item of EXPECTED_EXPORTS) {
      assert.strictEqual(kindOf(api[item.member]), item.kind, item.member);
    }
  });

  test('a module that throws when it loads is a load failure carrying the first line of the error', () => {
    const dir = makeStubTool(scratch.dir('stub'), { version: '2.0.0', throwOnLoad: 'Signing' });
    const failure = failureOf(() => loader().loadInstallation(dir));
    assert.strictEqual(failure.firstLine, stubLoadError('Signing'));
    assert.ok(!failure.firstLine.includes('\n'), 'the first line holds only one line');
  });

  test('a missing export is named with the subpath it should have come from', () => {
    const dir = makeStubTool(scratch.dir('stub'), { version: '2.0.0', missingExport: 'validateScopeName' });
    const failure = failureOf(() => loader().loadInstallation(dir));
    assert.strictEqual(failure.firstLine, 'missing export validateScopeName from Scopes');
  });

  test('a missing default export is named by its member', () => {
    const dir = makeStubTool(scratch.dir('stub'), { version: '2.0.0', missingExport: 'Template' });
    const failure = failureOf(() => loader().loadInstallation(dir));
    assert.ok(failure.firstLine.startsWith('missing export'), failure.firstLine);
    assert.ok(failure.firstLine.includes('Template'), failure.firstLine);
  });

  test('an export of the wrong kind is a load failure', () => {
    const dir = makeStubTool(scratch.dir('stub'), { version: '2.0.0' });
    const file = path.join(dir, 'dist', 'Scopes.js');
    fs.appendFileSync(file, "exports.validateScopeName = 'not a function';\n");
    const failure = failureOf(() => loader().loadInstallation(dir));
    assert.ok(failure.firstLine.includes('validateScopeName'), failure.firstLine);
  });

  test('a directory that is not an installation is a load failure', () => {
    const failure = failureOf(() => loader().loadInstallation(scratch.dir('empty')));
    assert.ok(failure.firstLine.length > 0);
  });

  suite('the loaded copies', () => {
    test('the same directory and version gives the same API', () => {
      const dir = makeStubTool(scratch.dir('stub'), { version: '2.0.0' });
      assert.strictEqual(loader().loadInstallation(dir), loader().loadInstallation(dir));
    });

    test('the same real path reached through a link gives the same API', function () {
      if (process.platform === 'win32') {
        this.skip();
      }
      const dir = makeStubTool(scratch.dir('stub'), { version: '2.0.0' });
      const link = path.join(scratch.dir('holder'), 'linked');
      fs.symlinkSync(dir, link);
      assert.strictEqual(loader().loadInstallation(dir), loader().loadInstallation(link));
    });

    test('a different directory gives a different API', () => {
      const first = makeStubTool(scratch.dir('first'), { version: '2.0.0' });
      const second = makeStubTool(scratch.dir('second'), { version: '2.0.0' });
      const one = loader().loadInstallation(first);
      const two = loader().loadInstallation(second);
      assert.notStrictEqual(one, two);
      assert.notStrictEqual(one.Config, two.Config);
    });

    test('a failure is not remembered: the same directory loads once it is fixed', () => {
      const dir = makeStubTool(scratch.dir('stub'), { version: '2.0.0', throwOnLoad: 'Config' });
      failureOf(() => loader().loadInstallation(dir));
      makeStubTool(dir, { version: '2.0.0' });
      const api = loader().loadInstallation(dir);
      assert.strictEqual(kindOf(api.Config), 'class');
    });
  });
});
