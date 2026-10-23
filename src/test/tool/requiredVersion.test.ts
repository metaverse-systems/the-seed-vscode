import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { EXPORT_TABLE } from '../../tool/toolApi';
import { DEV_DEPENDENCY_DIR } from '../helpers/stubTool';

// The version policy is pure: no editor API, no file system. The module is loaded when a case runs.
type Verdict = 'compatible' | 'tooOld' | 'tooNew' | 'unparsable';

interface RequiredVersionModule {
  REQUIRED_TOOL_VERSION: string;
  SUPPORTED_RANGE_TEXT: string;
  INSTALL_COMMAND: string;
  TOOL_PACKAGE_NAME: string;
  TOOL_SETTING: string;
  classifyVersion(version: string): Verdict;
}

const policy = (): RequiredVersionModule => require('../../tool/requiredVersion') as RequiredVersionModule;

suite('required tool version', () => {
  const rows: Array<[Verdict, string[]]> = [
    ['tooOld', ['1.2.1', '0.9.0', '2.0.0-rc.1', '2.0.0-alpha']],
    ['compatible', ['2.0.0', '2.0.1', '2.3.1', '2.1.0-beta.2', '2.0.0+build.5']],
    ['tooNew', ['3.0.0', '3.0.0-rc.1', '10.0.0']],
    ['unparsable', ['2', 'v2.0.0', 'latest', '']],
  ];

  for (const [verdict, versions] of rows) {
    for (const version of versions) {
      test(`"${version}" is ${verdict}`, () => {
        assert.strictEqual(policy().classifyVersion(version), verdict);
      });
    }
  }

  test('numbers are compared as numbers, not as text', () => {
    assert.strictEqual(policy().classifyVersion('2.0.10'), 'compatible');
    assert.strictEqual(policy().classifyVersion('2.10.0'), 'compatible');
    assert.strictEqual(policy().classifyVersion('1.99.99'), 'tooOld');
    assert.strictEqual(policy().classifyVersion('9.0.0'), 'tooNew');
  });

  test('every prerelease of the required version is older than it', () => {
    // Numeric identifiers rank below alphanumeric ones, numbers compare as numbers, and a shorter
    // set ranks lower when everything before it is equal; all of these stay below 2.0.0 itself.
    for (const version of ['2.0.0-0', '2.0.0-1.2.3', '2.0.0-alpha.beta', '2.0.0-alpha.1', '2.0.0-rc.1.x', '2.0.0-0.0.0', '2.0.0-x-y-z.--']) {
      assert.strictEqual(policy().classifyVersion(version), 'tooOld', version);
    }
  });

  test('a prerelease of the next major is older than that major but still too new', () => {
    for (const version of ['3.0.0-0', '3.0.0-alpha', '3.0.0-alpha.1', '4.0.0-rc.1']) {
      assert.strictEqual(policy().classifyVersion(version), 'tooNew', version);
    }
  });

  test('build metadata is ignored', () => {
    assert.strictEqual(policy().classifyVersion('2.0.0+build.5'), 'compatible');
    assert.strictEqual(policy().classifyVersion('3.0.0+build.5'), 'tooNew');
    assert.strictEqual(policy().classifyVersion('1.9.9+build.5'), 'tooOld');
    assert.strictEqual(policy().classifyVersion('2.0.0-rc.1+build.5'), 'tooOld');
  });

  test('text that is not a version is unparsable', () => {
    for (const version of ['2.0', '2.0.0.0', ' 2.0.0', '2.0.0 ', '2.0.0-', '2.0.0+', '2.x', '^2.0.0', '>=2.0.0', 'two', '2.0.0-rc_1', '-1.0.0', '1.-2.3']) {
      assert.strictEqual(policy().classifyVersion(version), 'unparsable', JSON.stringify(version));
    }
  });

  test('the constants derive from the required version', () => {
    const constants = policy();
    assert.strictEqual(constants.REQUIRED_TOOL_VERSION, '2.0.0');
    assert.strictEqual(constants.SUPPORTED_RANGE_TEXT, '2.0.0 or a later 2.x');
    assert.strictEqual(constants.INSTALL_COMMAND, 'npm install -g --foreground-scripts @metaverse-systems/the-seed@2');
    assert.strictEqual(constants.TOOL_PACKAGE_NAME, '@metaverse-systems/the-seed');
    assert.strictEqual(constants.TOOL_SETTING, 'the-seed.toolPath');
  });

  test('the required version itself is compatible and the install command names its major', () => {
    const constants = policy();
    assert.strictEqual(constants.classifyVersion(constants.REQUIRED_TOOL_VERSION), 'compatible');
    const major = constants.REQUIRED_TOOL_VERSION.split('.')[0];
    assert.ok(constants.INSTALL_COMMAND.endsWith(`${constants.TOOL_PACKAGE_NAME}@${major}`), constants.INSTALL_COMMAND);
    assert.ok(constants.SUPPORTED_RANGE_TEXT.startsWith(constants.REQUIRED_TOOL_VERSION), constants.SUPPORTED_RANGE_TEXT);
    assert.ok(constants.SUPPORTED_RANGE_TEXT.includes(`${major}.x`), constants.SUPPORTED_RANGE_TEXT);
  });

  suite('development dependency', () => {
    const extensionRoot = path.resolve(__dirname, '..', '..', '..');
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const name = '@metaverse-systems/the-seed';

    test('package.json pins the tool in devDependencies to the required version', () => {
      assert.strictEqual(manifest.devDependencies?.[name], policy().REQUIRED_TOOL_VERSION);
    });

    test('the tool is not a runtime dependency', () => {
      assert.strictEqual(manifest.dependencies?.[name], undefined);
    });

    test('the installed copy is the required version', () => {
      const installed = JSON.parse(fs.readFileSync(path.join(DEV_DEPENDENCY_DIR, 'package.json'), 'utf8')) as { version: string };
      assert.strictEqual(installed.version, policy().REQUIRED_TOOL_VERSION);
    });

    test('every member of the export table loads from the installed copy', () => {
      const requireFromTool = createRequire(path.join(fs.realpathSync(DEV_DEPENDENCY_DIR), 'package.json'));
      for (const item of EXPORT_TABLE) {
        const loaded = requireFromTool(`${name}/${item.subpath}`) as Record<string, unknown>;
        assert.notStrictEqual(loaded[item.exportName], undefined, `${item.subpath}.${item.exportName}`);
      }
    });
  });
});
