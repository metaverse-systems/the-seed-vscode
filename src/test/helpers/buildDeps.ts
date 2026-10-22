import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const NATIVE_TRIPLET = 'x86_64-linux-gnu';
const WINDOWS_TRIPLET = 'x86_64-w64-mingw32';

export interface BuildDeps {
  /** pkg-config directories holding libecs-cpp and libthe-seed for the Linux build */
  nativePkgConfig: string[];
  /** Directory holding libecs-cpp and libthe-seed built for Windows (bin, include, lib) */
  windowsRoot: string;
}

function isDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Where the libraries a scaffolded project is built against were installed.
 * THE_SEED_TEST_DEPS names the directory they were installed under: the Linux
 * build in its lib/pkgconfig (or <triplet>/lib/pkgconfig, the layout the tool
 * uses) and the Windows build in x86_64-w64-mingw32/. Without it the first
 * PKG_CONFIG_PATH entry that holds ecs-cpp.pc names that directory.
 * Throws an error that says what to set when they cannot be found.
 */
export function locateBuildDeps(): BuildDeps {
  let root = process.env.THE_SEED_TEST_DEPS;
  if (!root) {
    for (const entry of (process.env.PKG_CONFIG_PATH ?? '').split(path.delimiter)) {
      if (entry && fs.existsSync(path.join(entry, 'ecs-cpp.pc'))) {
        root = path.resolve(entry, '..', '..');
        break;
      }
    }
  }
  if (!root) {
    throw new Error('The real build cases need libecs-cpp and libthe-seed installed for Linux and for Windows; set THE_SEED_TEST_DEPS to the directory they are installed under');
  }
  const nativePkgConfig = [path.join(root, 'lib', 'pkgconfig'), path.join(root, NATIVE_TRIPLET, 'lib', 'pkgconfig')]
    .filter((dir) => fs.existsSync(path.join(dir, 'ecs-cpp.pc')) && fs.existsSync(path.join(dir, 'the-seed.pc')));
  const windowsRoot = path.join(root, WINDOWS_TRIPLET);
  const windowsPkgConfig = path.join(windowsRoot, 'lib', 'pkgconfig');
  if (nativePkgConfig.length === 0) {
    throw new Error(`libecs-cpp and libthe-seed are not installed for Linux under ${root}`);
  }
  if (!fs.existsSync(path.join(windowsPkgConfig, 'ecs-cpp.pc')) || !fs.existsSync(path.join(windowsPkgConfig, 'the-seed.pc'))) {
    throw new Error(`libecs-cpp and libthe-seed are not installed for Windows under ${windowsRoot}`);
  }
  return { nativePkgConfig, windowsRoot };
}

/** Throws unless the program can be started (it is found on the path and answers --version). */
export function requireProgram(program: string, hint: string): void {
  const found = cp.spawnSync(program, ['--version'], { stdio: 'ignore' });
  if (found.error || found.status !== 0) {
    throw new Error(`${program} is needed by the real build cases: ${hint}`);
  }
}

/** The first bytes of a file, to tell an ELF image from a Windows (MZ) one. */
export function leadingBytes(file: string, count: number): Buffer {
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(count);
    const read = fs.readSync(fd, buffer, 0, count, 0);
    return buffer.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

export function isElf(file: string): boolean {
  return leadingBytes(file, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
}

export function isWindowsImage(file: string): boolean {
  return leadingBytes(file, 2).toString('latin1') === 'MZ';
}
