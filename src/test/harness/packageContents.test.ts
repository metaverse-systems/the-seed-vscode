// Pure-function cases for the package and bundle checks: no editor API.
import * as assert from 'assert';
import {
  EXPECTED_PACKAGE_FILES,
  ALLOWED_BUNDLE_LIBRARIES,
  readZipEntryNames,
  scanPackagerOutput,
  compareFileList,
  checkManifest,
  packageReportLines,
  bundleInputFailures,
  PackageReport,
} from './packageContents';

// A zip of stored (uncompressed) entries: local headers with data, a central
// directory, then the end-of-central-directory record. The reader looks at
// names only, so checksums are left zero.
function makeZip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + data.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const count = Object.keys(entries).length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, end]);
}

const EXPECTED_ENTRIES = [
  '[Content_Types].xml',
  'extension.vsixmanifest',
  'extension/LICENSE.txt',
  'extension/changelog.md',
  'extension/dist/extension.js',
  'extension/dist/webview/assets/index.css',
  'extension/dist/webview/assets/index.js',
  'extension/media/icon.png',
  'extension/media/the-seed-icon.svg',
  'extension/package.json',
  'extension/readme.md',
];

suite('Package contents: expected file set', () => {
  test('EXPECTED_PACKAGE_FILES is sorted and has no duplicates', () => {
    const sorted = [...EXPECTED_PACKAGE_FILES].sort();
    assert.deepStrictEqual([...EXPECTED_PACKAGE_FILES], sorted);
    assert.strictEqual(new Set(EXPECTED_PACKAGE_FILES).size, EXPECTED_PACKAGE_FILES.length);
  });

  test('EXPECTED_PACKAGE_FILES is the eleven entries of the shipped package', () => {
    assert.strictEqual(EXPECTED_PACKAGE_FILES.length, 11);
    assert.deepStrictEqual([...EXPECTED_PACKAGE_FILES], EXPECTED_ENTRIES);
  });
});

suite('Package contents: readZipEntryNames', () => {
  test('returns the entry names in order', () => {
    const zip = makeZip({
      '[Content_Types].xml': '<Types/>',
      'extension/package.json': '{}',
      'extension/dist/extension.js': 'exports.activate = () => {};',
    });
    assert.deepStrictEqual(readZipEntryNames(zip), [
      '[Content_Types].xml',
      'extension/package.json',
      'extension/dist/extension.js',
    ]);
  });

  test('returns no names for an archive with no entries', () => {
    assert.deepStrictEqual(readZipEntryNames(makeZip({})), []);
  });

  test('throws on a truncated buffer', () => {
    const zip = makeZip({ 'extension/package.json': '{}', 'extension/readme.md': 'hello' });
    assert.throws(() => readZipEntryNames(zip.subarray(0, zip.length - 10)));
    assert.throws(() => readZipEntryNames(zip.subarray(0, 10)));
    assert.throws(() => readZipEntryNames(Buffer.alloc(0)));
  });
});

suite('Package contents: scanPackagerOutput', () => {
  const output = [
    ' INFO  Files included in the VSIX:',
    ` WARNING  A 'repository' field is missing from the 'package.json' manifest file.`,
    'Do you want to continue? [y/N]',
    ' WARNING  LICENSE, LICENSE.md, or LICENSE.txt not found',
    ' WARNING  This extension consists of 4628 files, out of which 2676 are JavaScript files. For performance reasons, you should bundle your extension.',
    ' ERROR  invalid relative path: extension/../outside.txt',
    ' DONE  Packaged: the-seed-vscode-0.3.0.vsix (4628 files, 34.06 MB)',
  ].join('\n');

  test('finds the three warning lines and the invalid relative path error', () => {
    const found = scanPackagerOutput(output);
    assert.strictEqual(found.warnings.length, 3);
    assert.ok(found.warnings[0].includes("'repository' field is missing"));
    assert.ok(found.warnings[1].includes('LICENSE'));
    assert.ok(found.warnings[2].includes('you should bundle your extension'));
    assert.strictEqual(found.errors.length, 1);
    assert.ok(found.errors[0].includes('invalid relative path'));
  });

  test('ignores INFO and DONE lines and file names containing warning', () => {
    const found = scanPackagerOutput([
      ' INFO  Files included in the VSIX:',
      ' INFO  extension/media/warning.png',
      ' INFO  extension/error-handling.md',
      ' DONE  Packaged: the-seed-vscode-0.3.0.vsix (11 files, 160.5 KB)',
    ].join('\n'));
    assert.deepStrictEqual(found, { warnings: [], errors: [] });
  });

  test('reports nothing for empty output', () => {
    assert.deepStrictEqual(scanPackagerOutput(''), { warnings: [], errors: [] });
  });
});

suite('Package contents: compareFileList', () => {
  test('equal lists report nothing, whatever the order', () => {
    assert.deepStrictEqual(compareFileList(['a', 'b', 'c'], ['c', 'a', 'b']), { missing: [], extra: [] });
  });

  test('reports missing and extra separately', () => {
    const result = compareFileList(['a', 'b', 'c'], ['c', 'd', 'a']);
    assert.deepStrictEqual(result.missing, ['b']);
    assert.deepStrictEqual(result.extra, ['d']);
  });

  test('reports every entry as missing when nothing is present', () => {
    const result = compareFileList(['a', 'b'], []);
    assert.deepStrictEqual([...result.missing].sort(), ['a', 'b']);
    assert.deepStrictEqual(result.extra, []);
  });
});

suite('Package contents: checkManifest', () => {
  const testConfig = "export default defineConfig({\n\tversion: '1.143.0',\n});\n";

  test('passes with an empty dependencies object', () => {
    assert.deepStrictEqual(checkManifest({ dependencies: {}, engines: { vscode: '^1.143.0' } }, testConfig), []);
  });

  test('passes with no dependencies field', () => {
    assert.deepStrictEqual(checkManifest({ engines: { vscode: '^1.143.0' } }, testConfig), []);
  });

  test('a runtime dependency gives one PACKAGE DEPENDENCY line naming it', () => {
    const lines = checkManifest({ dependencies: { react: '^19' }, engines: { vscode: '^1.143.0' } }, testConfig);
    assert.strictEqual(lines.length, 1);
    assert.ok(lines[0].startsWith('PACKAGE DEPENDENCY: react '), lines[0]);
  });

  test('an engine range below the tested version gives one PACKAGE ENGINE line', () => {
    const lines = checkManifest({ engines: { vscode: '^1.97.0' } }, testConfig);
    assert.strictEqual(lines.length, 1);
    assert.ok(lines[0].startsWith('PACKAGE ENGINE: '), lines[0]);
    assert.ok(lines[0].includes('^1.97.0'));
    assert.ok(lines[0].includes('1.143.0'));
  });

  test('an engine range equal to the tested version passes', () => {
    assert.deepStrictEqual(checkManifest({ engines: { vscode: '^1.143.0' } }, testConfig), []);
  });
});

suite('Package contents: packageReportLines', () => {
  function passingReport(): PackageReport {
    return {
      file: 'the-seed-vscode-0.3.0.vsix',
      exitCode: 0,
      warnings: [],
      errors: [],
      dependencies: [],
      engineFloor: '1.143.0',
      testedVersion: '1.143.0',
      missing: [],
      extra: [],
      entries: 11,
      bytes: 164000,
    };
  }

  test('a clean report passes with no failure lines', () => {
    assert.deepStrictEqual(packageReportLines(passingReport()), { failures: [], passed: true });
  });

  test('a non-zero exit status fails with the status in the line', () => {
    const result = packageReportLines({ ...passingReport(), exitCode: 2 });
    assert.strictEqual(result.passed, false);
    assert.deepStrictEqual(result.failures, ['PACKAGE ERROR: vsce exited with status 2']);
  });

  test('each failure kind gives one line with its fixed prefix', () => {
    const result = packageReportLines({
      ...passingReport(),
      warnings: ['WARNING  LICENSE not found', 'WARNING  repository missing'],
      errors: ['ERROR  invalid relative path'],
      dependencies: ['react'],
      missing: ['extension/LICENSE.txt'],
      extra: ['extension/notes.md'],
    });
    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.failures.length, 6);
    assert.strictEqual(result.failures.filter((line) => line.startsWith('PACKAGE WARNING: ')).length, 2);
    assert.strictEqual(result.failures.filter((line) => line.startsWith('PACKAGE ERROR: ')).length, 1);
    assert.ok(result.failures.some((line) => line.startsWith('PACKAGE DEPENDENCY: react ')));
    assert.ok(result.failures.includes('PACKAGE MISSING: extension/LICENSE.txt'));
    assert.ok(result.failures.includes('PACKAGE EXTRA: extension/notes.md'));
  });

  test('an engine floor that differs from the tested version fails with a PACKAGE ENGINE line', () => {
    const result = packageReportLines({ ...passingReport(), engineFloor: '1.97.0' });
    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.failures.length, 1);
    assert.ok(result.failures[0].startsWith('PACKAGE ENGINE: '), result.failures[0]);
  });
});

suite('Package contents: bundleInputFailures', () => {
  test('ALLOWED_BUNDLE_LIBRARIES is empty', () => {
    assert.deepStrictEqual([...ALLOWED_BUNDLE_LIBRARIES], []);
  });

  test('inputs outside node_modules pass', () => {
    assert.deepStrictEqual(
      bundleInputFailures(['src/extension.ts', 'src/tool/toolService.ts'], 'module.exports = {};', []),
      []
    );
  });

  test('a library input gives one BUNDLE INPUT line naming it', () => {
    const lines = bundleInputFailures(['src/extension.ts', 'node_modules/fs-extra/lib/index.js'], '', []);
    assert.strictEqual(lines.length, 1);
    assert.ok(lines[0].startsWith('BUNDLE INPUT'), lines[0]);
    assert.ok(lines[0].includes('fs-extra'));
  });

  test('several inputs from one library still name each failing input once', () => {
    const lines = bundleInputFailures(
      ['node_modules/fs-extra/lib/index.js', 'node_modules/graceful-fs/graceful-fs.js'],
      '',
      []
    );
    assert.strictEqual(lines.length, 2);
  });

  test('an allowed library passes', () => {
    assert.deepStrictEqual(bundleInputFailures(['node_modules/fs-extra/lib/index.js'], '', ['fs-extra']), []);
  });

  test('a scoped library is matched by its scope and name', () => {
    const inputs = ['node_modules/@scope/name/lib/index.js'];
    assert.deepStrictEqual(bundleInputFailures(inputs, '', ['@scope/name']), []);
    assert.strictEqual(bundleInputFailures(inputs, '', ['name']).length, 1);
    assert.strictEqual(bundleInputFailures(inputs, '', ['@scope/other']).length, 1);
  });

  test('a require of the tool in the output gives one BUNDLE TOOL line', () => {
    const lines = bundleInputFailures(
      ['src/extension.ts'],
      'var tool = require("@metaverse-systems/the-seed/lib/index.js");',
      []
    );
    assert.strictEqual(lines.length, 1);
    assert.ok(lines[0].startsWith('BUNDLE TOOL'), lines[0]);
  });

  test('output without a require of the tool passes', () => {
    assert.deepStrictEqual(
      bundleInputFailures(['src/extension.ts'], 'var m = require("node:module"); // the-seed', []),
      []
    );
  });
});
