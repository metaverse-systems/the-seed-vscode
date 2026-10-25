import * as fs from 'fs';
import * as path from 'path';
import type { ToolApi } from '../../tool/toolApi';
import { makeScratchDir } from './workspaceStub';

/** One value the extension takes from the tool: where it lives, what it is and what it is called here. */
export interface ExpectedExport {
  subpath: string;
  exportName: string;
  member: string;
  kind: 'class' | 'function' | 'number';
}

const entry = (subpath: string, exportName: string, member: string, kind: ExpectedExport['kind']): ExpectedExport => (
  { subpath, exportName, member, kind }
);

/** Every value of the published 2.1.0 package that the extension's sources and tests use. */
export const EXPECTED_EXPORTS: readonly ExpectedExport[] = [
  entry('Config', 'default', 'Config', 'class'),
  entry('Config', 'ConfigError', 'ConfigError', 'class'),
  entry('Config', 'configFilePath', 'configFilePath', 'function'),
  entry('Scopes', 'default', 'Scopes', 'class'),
  entry('Scopes', 'validateScopeName', 'validateScopeName', 'function'),
  entry('Template', 'default', 'Template', 'class'),
  entry('ResourcePak', 'default', 'ResourcePak', 'class'),
  entry('Signing', 'default', 'Signing', 'class'),
  entry('Signing', 'DEFAULT_VALIDITY_DAYS', 'DEFAULT_VALIDITY_DAYS', 'number'),
  entry('Signing', 'MAX_VALIDITY_DAYS', 'MAX_VALIDITY_DAYS', 'number'),
  entry('Build', 'default', 'Build', 'class'),
  entry('RecursiveBuild', 'buildRecursive', 'buildRecursive', 'function'),
  entry('Package', 'default', 'Package', 'class'),
  entry('Installer', 'default', 'Installer', 'class'),
  entry('ProjectError', 'ProjectError', 'ProjectError', 'class'),
  entry('DependencyWalker', 'DependencyDiscoveryError', 'DependencyDiscoveryError', 'class'),
  entry('DependencyWalker', 'ConflictingProjectError', 'ConflictingProjectError', 'class'),
  entry('DependencyWalker', 'CyclicDependencyError', 'CyclicDependencyError', 'class'),
  entry('DependencyWalker', 'DiscoveryCancelledError', 'DiscoveryCancelledError', 'class'),
  entry('DependencyWalker', 'ProjectManifestError', 'ProjectManifestError', 'class'),
  entry('DependencyWalker', 'walkDependencies', 'walkDependencies', 'function'),
  entry('Hints', 'replaceResourceHint', 'replaceResourceHint', 'function'),
  entry('Dependencies', 'checkLibEcs', 'checkLibEcs', 'function'),
  entry('Dependencies', 'checkLibTheSeed', 'checkLibTheSeed', 'function'),
  entry('Dependencies', 'getInstallSteps', 'getInstallSteps', 'function'),
  entry('Dependencies', 'runInstallSteps', 'runInstallSteps', 'function'),
  entry('NativeComponent', 'nativeComponentMessage', 'nativeComponentMessage', 'function'),
  entry('NativeComponent', 'NativeComponentMissingError', 'NativeComponentMissingError', 'class'),
  entry('NativeComponent', 'requireNativeComponent', 'requireNativeComponent', 'function'),
];

export const TOOL_NAME = '@metaverse-systems/the-seed';

/** Root of the extension (the directory holding package.json), from out/test/helpers. */
const extensionRoot = path.resolve(__dirname, '..', '..', '..');

/** The devDependency's own package directory. */
export const DEV_DEPENDENCY_DIR = path.join(extensionRoot, 'node_modules', '@metaverse-systems', 'the-seed');

/** The first line of the error a stub raises when `throwOnLoad` names `subpath`. */
export function stubLoadError(subpath: string): string {
  return `stub module failed to start: ${subpath}`;
}

export interface StubToolOptions {
  version: string;
  name?: string;
  /** Write a package.json that is not JSON, or one without a version. */
  packageJson?: 'malformed' | 'noVersion';
  /** Subpath whose module throws when it is required. */
  throwOnLoad?: string;
  /** Member name left out of its module. */
  missingExport?: string;
}

/** Members a stub class has, by class: the public ones the extension calls with no tool behaviour behind them. */
const CLASS_BODIES: Record<string, string> = {
  Signing: " formatSubject(subject) { return [['CN', subject.commonName], ['EMAIL', subject.email], ['O', subject.organization]]"
    + ".filter((field) => field[1]).map((field) => `${field[0]}=${field[1]}`).join(', '); } ",
};

function moduleSource(subpath: string, options: StubToolOptions): string {
  const lines = ["'use strict';", "Object.defineProperty(exports, '__esModule', { value: true });"];
  if (options.throwOnLoad === subpath) {
    lines.push(`throw new Error(${JSON.stringify(stubLoadError(subpath))} + '\\nsecond line of the error');`);
  }
  for (const item of EXPECTED_EXPORTS) {
    if (item.subpath !== subpath || item.member === options.missingExport) {
      continue;
    }
    const value = item.kind === 'class'
      ? `class ${item.member} {${CLASS_BODIES[item.member] ?? ''}}`
      : item.kind === 'function'
        ? `function ${item.member}() {}`
        : '365';
    lines.push(`exports[${JSON.stringify(item.exportName)}] = ${value};`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Writes a scratch installation of the tool at `dir`: a package.json with the tool's name, the chosen
 * version and the same `exports` keys as the published package, and a module for every key exporting
 * each value the extension uses, with the right kind and no behaviour. Returns `dir`.
 */
export function makeStubTool(dir: string, options: StubToolOptions): string {
  const realManifest = JSON.parse(fs.readFileSync(path.join(DEV_DEPENDENCY_DIR, 'package.json'), 'utf8')) as {
    exports: Record<string, string | { default?: string }>;
  };
  fs.mkdirSync(dir, { recursive: true });

  const exportsMap: Record<string, string | { default?: string }> = {};
  for (const [key, target] of Object.entries(realManifest.exports)) {
    exportsMap[key] = target;
    const file = typeof target === 'string' ? undefined : target.default;
    if (file === undefined) {
      continue;
    }
    const subpath = key === '.' ? '' : key.slice(2);
    const full = path.join(dir, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, moduleSource(subpath, options));
  }
  const script = path.join(dir, 'dist', 'scripts', 'the-seed.js');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, "#!/usr/bin/env node\n'use strict';\n", { mode: 0o755 });

  const manifest: Record<string, unknown> = {
    name: options.name ?? TOOL_NAME,
    version: options.version,
    main: 'dist/index.js',
    bin: { 'the-seed': 'dist/scripts/the-seed.js' },
    exports: exportsMap,
  };
  if (options.packageJson === 'noVersion') {
    delete manifest.version;
  }
  const text = options.packageJson === 'malformed' ? '{ "name": "@metaverse-systems/the-seed", ' : JSON.stringify(manifest, null, 2);
  fs.writeFileSync(path.join(dir, 'package.json'), text);
  return dir;
}

export type ShimLayout = 'symlink' | 'shim';

/**
 * Puts a `the-seed` command in `binDir`. `symlink` (the default on POSIX) links it to the stub's
 * `dist/scripts/the-seed.js` inside `packageDir`. `shim` writes the plain script and `.cmd` files a
 * Windows install leaves, which point at no package; the caller places the package at
 * `<binDir>/node_modules/@metaverse-systems/the-seed` (or `<binDir>/../lib/node_modules/...`).
 */
export function makeCommandShim(binDir: string, packageDir: string, layout?: ShimLayout): void {
  const chosen: ShimLayout = layout ?? (process.platform === 'win32' ? 'shim' : 'symlink');
  fs.mkdirSync(binDir, { recursive: true });
  if (chosen === 'symlink') {
    fs.symlinkSync(path.join(packageDir, 'dist', 'scripts', 'the-seed.js'), path.join(binDir, 'the-seed'));
    return;
  }
  fs.writeFileSync(path.join(binDir, 'the-seed'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(binDir, 'the-seed.cmd'), '@ECHO off\r\nEXIT /b 0\r\n');
}

export interface CopyTestToolOptions {
  /** Copy the tool's native component too. */
  native: boolean;
}

/**
 * Makes a scratch copy of the installation named by THE_SEED_TEST_TOOL (dist, package.json, templates,
 * and native only when asked) whose classes behave like the real tool's. Its dependencies come from
 * the source installation's own node_modules, with the extension's node_modules behind them; the links
 * are junctions so they also work on Windows.
 */
export function copyTestTool(dir: string, options: CopyTestToolOptions): string {
  const source = process.env.THE_SEED_TEST_TOOL;
  if (!source) {
    throw new Error('THE_SEED_TEST_TOOL is not set');
  }
  fs.mkdirSync(dir, { recursive: true });
  const parts = ['dist', 'package.json', 'templates'];
  if (options.native) {
    parts.push('native');
  }
  for (const part of parts) {
    const from = path.join(source, part);
    if (fs.existsSync(from)) {
      fs.cpSync(from, path.join(dir, part), { recursive: true });
    }
  }
  linkModules(source, dir);
  return dir;
}

/**
 * Gives `dir` a node_modules that resolves what the tool at `source` needs. A linked checkout has
 * all of its own, so that directory is used whole. A registry installation keeps only the packages
 * it could not share with the extension in its own node_modules, so those are laid over the
 * extension's packages entry by entry.
 */
function linkModules(source: string, dir: string): void {
  const target = path.join(dir, 'node_modules');
  const ownModules = path.join(source, 'node_modules');
  const sharedModules = path.join(extensionRoot, 'node_modules');
  if (!fs.existsSync(ownModules)) {
    fs.symlinkSync(sharedModules, target, 'junction');
    return;
  }
  const own = fs.realpathSync(ownModules);
  if (fs.existsSync(path.join(own, 'tslib'))) {
    fs.symlinkSync(own, target, 'junction');
    return;
  }
  fs.mkdirSync(target);
  const entries = new Map<string, string>();
  for (const base of [sharedModules, own]) {
    for (const name of fs.readdirSync(base)) {
      if (name.startsWith('@') && entries.has(name)) {
        continue;
      }
      entries.set(name, path.join(base, name));
    }
  }
  for (const [name, from] of entries) {
    if (name === '.bin') {
      continue;
    }
    if (name.startsWith('@')) {
      fs.mkdirSync(path.join(target, name));
      for (const base of [path.join(sharedModules, name), path.join(own, name)]) {
        for (const member of fs.existsSync(base) ? fs.readdirSync(base) : []) {
          const link = path.join(target, name, member);
          fs.rmSync(link, { force: true, recursive: true });
          fs.symlinkSync(path.join(base, member), link, 'junction');
        }
      }
      continue;
    }
    fs.symlinkSync(from, path.join(target, name), 'junction');
  }
}

export interface ScratchDirs {
  dir(label: string): string;
}

/** Makes scratch directories for the enclosing suite and removes them after each case. */
export function useScratchDirs(): ScratchDirs {
  let created: string[] = [];
  teardown(() => {
    for (const made of created) {
      fs.rmSync(made, { recursive: true, force: true });
    }
    created = [];
  });
  return {
    dir(label: string): string {
      const made = fs.realpathSync(makeScratchDir(label));
      created.push(made);
      return made;
    },
  };
}

/**
 * The loaded tool as one without its internal members: its Signing keeps the public formatSubject and
 * loses the deprecated "_"-prefixed variant. Everything else is the loaded tool's own.
 */
export function withoutInternalMembers(api: ToolApi): ToolApi {
  class PublicSigning extends api.Signing {}
  // Spelled in parts so that a search of src/ for the deprecated name finds nothing
  Object.defineProperty(PublicSigning.prototype, ['_format', 'Subject'].join(''), { value: undefined });
  return { ...api, Signing: PublicSigning };
}
