// A fake `git` first on PATH for the length of a case, and a pkg-config search
// that sees only what the case provides, so dependency installation runs real
// steps without the network and without the libraries the machine already has.
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { makeScratchDir } from './workspaceStub';

/** The line the failing `git` prints on stdout. */
export const FAILING_STDOUT = 'fake git: cloning the repository';
/** The line the failing `git` prints on stderr. */
export const FAILING_STDERR = 'fake git: fatal: could not read from the remote repository';

export interface FakeGit {
  /** Prints `FAILING_STDOUT` on stdout and `FAILING_STDERR` on stderr, then exits 1. */
  failing(): void;
  /** Sleeps for `seconds`, then fails as `failing` does; for cancel, lock and replay cases. */
  slow(seconds: number): void;
  /**
   * `clone <repo> <dir>` writes a tree whose `autogen.sh` and `configure` exit 0
   * and whose `Makefile` has `all` and `install` targets that do nothing; every
   * other use exits 0.
   */
  succeeding(): void;
  /** No `git` at all: PATH holds only links to `sh`, `pkg-config`, `which` and `sleep`. */
  absent(): void;
  /** Writes `.pc` files for both libraries into the pkg-config directory, so nothing is missing. */
  provideLibraries(): void;
  /** The scratch directory `PKG_CONFIG_LIBDIR` points at for the case. */
  readonly pkgConfigDir: string;
}

const LIBRARIES = [
  { name: 'ecs-cpp', lib: '-lecs-cpp' },
  { name: 'the-seed', lib: '-lthe-seed' },
];

/**
 * Call inside a `suite` body. Each case starts with the real PATH, no
 * `PKG_CONFIG_PATH` and `PKG_CONFIG_LIBDIR` at an empty scratch directory (the
 * hosted jobs export a `PKG_CONFIG_PATH` that holds both libraries); teardown
 * restores all three and removes the scratch directories.
 */
export function useFakeGit(): FakeGit {
  let saved: { PATH?: string; PKG_CONFIG_PATH?: string; PKG_CONFIG_LIBDIR?: string } = {};
  let made: string[] = [];
  let pkgConfigDir = '';

  const scratch = (label: string): string => {
    const dir = makeScratchDir(label);
    made.push(dir);
    return dir;
  };

  const install = (script: string): void => {
    const bin = scratch('git-bin');
    const git = path.join(bin, 'git');
    fs.writeFileSync(git, `#!/bin/sh\n${script}`);
    fs.chmodSync(git, 0o755);
    process.env.PATH = `${bin}${path.delimiter}${saved.PATH ?? ''}`;
  };

  const failingScript = `echo '${FAILING_STDOUT}'\nsleep 0.1\necho '${FAILING_STDERR}' >&2\nexit 1\n`;

  setup(() => {
    saved = { PATH: process.env.PATH, PKG_CONFIG_PATH: process.env.PKG_CONFIG_PATH, PKG_CONFIG_LIBDIR: process.env.PKG_CONFIG_LIBDIR };
    made = [];
    pkgConfigDir = scratch('pkgconfig');
    delete process.env.PKG_CONFIG_PATH;
    process.env.PKG_CONFIG_LIBDIR = pkgConfigDir;
  });

  teardown(() => {
    for (const name of ['PATH', 'PKG_CONFIG_PATH', 'PKG_CONFIG_LIBDIR'] as const) {
      const value = saved[name];
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    for (const dir of made) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    made = [];
  });

  return {
    get pkgConfigDir() {
      return pkgConfigDir;
    },
    failing: () => install(failingScript),
    slow: (seconds) => install(`sleep ${seconds}\n${failingScript}`),
    succeeding: () => install([
      'if [ "$1" = clone ]; then',
      '  dir="$3"',
      '  mkdir -p "$dir"',
      `  printf '#!/bin/sh\\nexit 0\\n' > "$dir/autogen.sh"`,
      `  printf '#!/bin/sh\\nexit 0\\n' > "$dir/configure"`,
      '  chmod +x "$dir/autogen.sh" "$dir/configure"',
      `  printf 'all:\\n\\t@true\\ninstall:\\n\\t@true\\n' > "$dir/Makefile"`,
      'fi',
      'exit 0',
      '',
    ].join('\n')),
    absent: () => {
      const bin = scratch('no-git-bin');
      for (const program of ['sh', 'pkg-config', 'which', 'sleep']) {
        let found = '';
        try {
          found = execFileSync('/bin/sh', ['-c', `command -v ${program}`], { encoding: 'utf8', env: { PATH: saved.PATH ?? '' } }).trim();
        } catch {
          continue;
        }
        if (found) {
          fs.symlinkSync(found, path.join(bin, program));
        }
      }
      process.env.PATH = bin;
    },
    provideLibraries: () => {
      for (const { name, lib } of LIBRARIES) {
        // A version above any the tool requires, so the library counts as installed.
        fs.writeFileSync(path.join(pkgConfigDir, `${name}.pc`), [
          'prefix=/nonexistent',
          `Name: ${name}`,
          `Description: ${name} for the test`,
          'Version: 99.0.0',
          `Libs: -L\${prefix}/lib ${lib}`,
          'Cflags: -I${prefix}/include',
          '',
        ].join('\n'));
      }
    },
  };
}
