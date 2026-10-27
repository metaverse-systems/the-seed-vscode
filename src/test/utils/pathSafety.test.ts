// The path checks that keep packaging from writing over a project or a
// workspace folder, with POSIX and Windows paths.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { canonical, isSameOrInside, outputConflict } from '../../utils/pathSafety';
import { makeScratchDir } from '../helpers/workspaceStub';

suite('pathSafety: isSameOrInside', () => {
  const posix: [string, string, boolean][] = [
    ['/a/proj', '/a/proj', true],
    ['/a/proj/dist', '/a/proj', true],
    ['/a/project', '/a/proj', false],
    ['/a/proj', '/a/project', false],
    ['/a/proj/../other', '/a/proj', false],
    ['/a/proj/sub/..', '/a/proj', true],
    ['/a/proj/', '/a/proj', true],
    ['/a/proj/dist/', '/a/proj/', true],
    ['/a/my proj/release files', '/a/my proj', true],
    ['/a/My Proj', '/a/my proj', false],
    ['/a/proj/..data', '/a/proj', true],
    ['/', '/a', false],
    ['/a', '/', true],
  ];
  for (const [child, parent, expected] of posix) {
    test(`posix: ${child} in ${parent} is ${expected}`, () => {
      assert.strictEqual(isSameOrInside(child, parent, path.posix), expected);
    });
  }

  const win32: [string, string, boolean][] = [
    ['C:\\Work\\Proj', 'C:\\Work\\Proj', true],
    ['c:\\work\\proj\\dist', 'C:\\Work\\Proj', true],
    ['C:\\Work\\Project', 'C:\\Work\\Proj', false],
    ['C:\\Work\\Proj\\..\\Other', 'C:\\Work\\Proj', false],
    ['C:\\Work\\Proj\\', 'c:\\work\\proj', true],
    ['C:\\Work\\My Proj\\release files', 'c:\\work\\my proj', true],
    ['C:\\Work', 'C:\\', true],
    ['D:\\Work', 'C:\\', false],
    ['C:\\', 'C:\\Work', false],
  ];
  for (const [child, parent, expected] of win32) {
    test(`win32: ${child} in ${parent} is ${expected}`, () => {
      assert.strictEqual(isSameOrInside(child, parent, path.win32), expected);
    });
  }
});

suite('pathSafety: outputConflict', () => {
  test('posix: an output that is a project is refused', () => {
    assert.strictEqual(
      outputConflict('/w/one', ['/w/one', '/w/two'], ['/w'], path.posix),
      'Cannot package into "/w/one": it is the project "/w/one".'
    );
  });

  test('posix: an output that contains a project is refused', () => {
    assert.strictEqual(
      outputConflict('/elsewhere', ['/elsewhere/games/one'], ['/w'], path.posix),
      'Cannot package into "/elsewhere": it contains the project "/elsewhere/games/one".'
    );
  });

  test('posix: an output that contains one of several workspace folders is refused', () => {
    assert.strictEqual(
      outputConflict('/b', ['/a/one'], ['/a', '/b/second'], path.posix),
      'Cannot package into "/b": it contains the workspace folder "/b/second".'
    );
  });

  test('posix: a workspace folder chosen as the output is refused', () => {
    assert.strictEqual(
      outputConflict('/w', ['/w/one'], ['/w'], path.posix),
      'Cannot package into "/w": it contains the project "/w/one".'
    );
    assert.strictEqual(
      outputConflict('/w', ['/other/one'], ['/w'], path.posix),
      'Cannot package into "/w": it contains the workspace folder "/w".'
    );
  });

  test('posix: an output inside a project, or beside the projects, is allowed', () => {
    assert.strictEqual(outputConflict('/w/one/dist', ['/w/one'], ['/w'], path.posix), null);
    assert.strictEqual(outputConflict('/w/release files', ['/w/one', '/w/two'], ['/w/one', '/w/two'], path.posix), null);
    assert.strictEqual(outputConflict('/w/project', ['/w/proj'], ['/w/proj'], path.posix), null);
  });

  test('win32: case does not hide a conflict', () => {
    assert.strictEqual(
      outputConflict('c:\\work', ['C:\\Work\\Proj'], ['D:\\ws'], path.win32),
      'Cannot package into "c:\\work": it contains the project "C:\\Work\\Proj".'
    );
    assert.strictEqual(
      outputConflict('C:\\WORK\\PROJ', ['c:\\work\\proj'], ['D:\\ws'], path.win32),
      'Cannot package into "C:\\WORK\\PROJ": it is the project "c:\\work\\proj".'
    );
    assert.strictEqual(
      outputConflict('C:\\', ['D:\\one'], ['c:\\ws'], path.win32),
      'Cannot package into "C:\\": it contains the workspace folder "c:\\ws".'
    );
    assert.strictEqual(outputConflict('C:\\Work\\Proj\\dist', ['c:\\work\\proj'], ['c:\\work\\proj'], path.win32), null);
  });

  test('an output that is a file is refused', () => {
    const dir = makeScratchDir('pathsafety-file');
    try {
      const file = path.join(dir, 'out');
      fs.writeFileSync(file, 'not a directory');
      assert.strictEqual(outputConflict(file, [path.join(dir, 'one')], [dir]), `Cannot package into "${file}": it is a file.`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

suite('pathSafety: canonical', () => {
  let dir: string;

  setup(() => {
    dir = fs.realpathSync(makeScratchDir('pathsafety'));
  });

  teardown(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a link into a project resolves to the project, so the check sees it', function () {
    const project = path.join(dir, 'project');
    fs.mkdirSync(path.join(project, 'src'), { recursive: true });
    const link = path.join(dir, 'link');
    try {
      fs.symlinkSync(project, link, 'dir');
    } catch {
      this.skip();
    }

    assert.strictEqual(canonical(link), project);
    assert.strictEqual(canonical(path.join(link, 'src')), path.join(project, 'src'));
    assert.match(
      outputConflict(canonical(link), [project], []) ?? '',
      /it is the project/
    );
  });

  test('a path whose last two parts do not exist keeps them after the resolved part', () => {
    assert.strictEqual(canonical(path.join(dir, 'new', 'release files')), path.join(dir, 'new', 'release files'));
  });

  test('.. and a trailing separator are resolved', () => {
    fs.mkdirSync(path.join(dir, 'a'));
    assert.strictEqual(canonical(path.join(dir, 'a', '..', 'a') + path.sep), path.join(dir, 'a'));
  });
});
