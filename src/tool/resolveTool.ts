import * as fs from 'fs';
import * as path from 'path';
import { classifyVersion, TOOL_PACKAGE_NAME, TOOL_SETTING } from './requiredVersion';

/** Everything the lookup reads from the machine, so tests can supply their own. */
export interface LookupEnvironment {
  platform: NodeJS.Platform;
  /** PATH, NPM_CONFIG_PREFIX, npm_config_prefix, APPDATA. */
  env: Record<string, string | undefined>;
  homedir: string;
  /** `npm root -g` output, trimmed; undefined on any failure. */
  runNpmRoot(): Promise<string | undefined>;
  /** The platform's default global roots. */
  defaultRoots: string[];
}

export type FoundThrough = 'setting' | 'global' | 'path';

export interface ToolCandidate {
  /** Real path of the package directory. */
  packageDir: string;
  foundThrough: FoundThrough;
  /** How it was found, in words that fit after "through the global installation (...)". */
  detail: string;
  version: string | undefined;
  verdict: 'compatible' | 'tooOld' | 'tooNew' | 'unreadable';
}

export interface LookupReport {
  /** Every place that was tried. */
  looked: string[];
  candidates: ToolCandidate[];
  settingValue: string | undefined;
  settingProblem: string | undefined;
}

const COMMAND_NAME = 'the-seed';

function isFile(target: string): boolean {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

function realPathOf(target: string): string | undefined {
  try {
    return fs.realpathSync(target);
  } catch {
    return undefined;
  }
}

interface PackageInfo {
  name: string | undefined;
  version: string | undefined;
}

function readPackage(dir: string): PackageInfo {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { name?: unknown; version?: unknown };
    return {
      name: typeof manifest.name === 'string' ? manifest.name : undefined,
      version: typeof manifest.version === 'string' ? manifest.version : undefined,
    };
  } catch {
    return { name: undefined, version: undefined };
  }
}

/** The nearest directory at or above `start` that holds a package.json. */
function nearestPackageDir(start: string): string | undefined {
  let dir = start;
  for (;;) {
    if (isFile(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

function makeCandidate(packageDir: string, foundThrough: FoundThrough, detail: string): ToolCandidate {
  const version = readPackage(packageDir).version;
  let verdict: ToolCandidate['verdict'] = 'unreadable';
  if (version !== undefined) {
    const classified = classifyVersion(version);
    verdict = classified === 'unparsable' ? 'unreadable' : classified;
  }
  return { packageDir, foundThrough, detail, version, verdict };
}

/** The package directories a command with no package around it can belong to. */
function shimLayouts(binDir: string): string[] {
  return [
    path.join(binDir, 'node_modules', TOOL_PACKAGE_NAME),
    path.join(binDir, '..', 'lib', 'node_modules', TOOL_PACKAGE_NAME),
  ];
}

function toolDirNear(commandPath: string, binDir: string): string | undefined {
  const real = realPathOf(commandPath);
  if (real) {
    const nearest = nearestPackageDir(path.dirname(real));
    if (nearest && readPackage(nearest).name === TOOL_PACKAGE_NAME) {
      return realPathOf(nearest);
    }
  }
  for (const layout of shimLayouts(binDir)) {
    if (readPackage(layout).name === TOOL_PACKAGE_NAME) {
      return realPathOf(layout);
    }
  }
  return undefined;
}

function isCommandName(file: string): boolean {
  const base = path.basename(file).toLowerCase();
  return base === COMMAND_NAME || base === `${COMMAND_NAME}.cmd`;
}

function expandHome(value: string, homedir: string): string {
  if (value === '~') {
    return homedir;
  }
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(homedir, value.slice(2));
  }
  return value;
}

function resolveSetting(value: string, lookup: LookupEnvironment): LookupReport {
  const report: LookupReport = { looked: [], candidates: [], settingValue: value, settingProblem: undefined };
  const problem = (text: string): LookupReport => {
    report.settingProblem = text;
    return report;
  };

  const expanded = expandHome(value, lookup.homedir);
  if (!path.isAbsolute(expanded)) {
    return problem('the path must be absolute');
  }
  const real = realPathOf(expanded);
  if (!real) {
    return problem('does not exist');
  }
  report.looked.push(`${TOOL_SETTING}: ${value}`);

  const onFile = isFile(real);
  const start = onFile ? path.dirname(real) : real;
  const nearest = nearestPackageDir(start);
  const nearestName = nearest ? readPackage(nearest).name : undefined;

  let packageDir: string | undefined;
  if (nearest && nearestName === TOOL_PACKAGE_NAME) {
    packageDir = realPathOf(nearest);
  } else if (onFile && isCommandName(expanded)) {
    packageDir = toolDirNear(expanded, path.dirname(expanded));
  }
  if (!packageDir) {
    if (!nearest) {
      return problem('no package.json in or above it');
    }
    return problem(nearestName === undefined ? 'its package.json has no name' : `it is the package ${nearestName}`);
  }
  report.candidates.push(makeCandidate(packageDir, 'setting', value));
  return report;
}

interface Root {
  root: string;
  via: string;
}

/** The prefix named by `prefix=` in the home directory's .npmrc; no other line is read into anything. */
function npmrcPrefix(homedir: string): string | undefined {
  let text: string;
  try {
    text = fs.readFileSync(path.join(homedir, '.npmrc'), 'utf8');
  } catch {
    return undefined;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*prefix\s*=\s*(.*?)\s*$/.exec(line);
    if (match && match[1].length > 0) {
      return match[1].replace(/^(["'])(.*)\1$/, '$2');
    }
  }
  return undefined;
}

async function npmRoot(lookup: LookupEnvironment): Promise<string | undefined> {
  try {
    const root = await lookup.runNpmRoot();
    return root && root.trim().length > 0 ? root.trim() : undefined;
  } catch {
    return undefined;
  }
}

function prefixRoot(prefix: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? path.join(prefix, 'node_modules') : path.join(prefix, 'lib', 'node_modules');
}

function findGlobal(looked: string[], roots: Root[]): ToolCandidate | undefined {
  for (const { root, via } of roots) {
    const packageDir = path.join(root, TOOL_PACKAGE_NAME);
    if (isFile(path.join(packageDir, 'package.json'))) {
      const real = realPathOf(packageDir);
      if (real) {
        return makeCandidate(real, 'global', `${via} (${root})`);
      }
    }
    looked.push(`${via}: ${root} (no the-seed there)`);
  }
  return undefined;
}

function findOnPath(lookup: LookupEnvironment, looked: string[]): ToolCandidate | undefined {
  const names = lookup.platform === 'win32' ? [`${COMMAND_NAME}.cmd`, COMMAND_NAME] : [COMMAND_NAME];
  const directories = (lookup.env.PATH ?? lookup.env.Path ?? '').split(path.delimiter).filter((entry) => entry.length > 0);
  for (const directory of directories) {
    for (const name of names) {
      const command = path.join(directory, name);
      if (!fs.existsSync(command)) {
        continue;
      }
      const packageDir = toolDirNear(command, directory);
      if (packageDir) {
        return makeCandidate(packageDir, 'path', command);
      }
      looked.push(`the-seed command on the path: ${command} (not inside the-seed)`);
      return undefined;
    }
  }
  looked.push(directories.length > 0
    ? `the-seed command on the path: not found in ${directories.join(', ')}`
    : 'the-seed command on the path: the path is empty');
  return undefined;
}

/**
 * Finds the installations of the tool. A non-empty `setting` is the only place looked at. Otherwise
 * the global installation and then the command on the path are tried, and both are reported when
 * they differ.
 */
export async function findCandidates(setting: string | undefined, lookup: LookupEnvironment): Promise<LookupReport> {
  const trimmed = setting?.trim() ?? '';
  if (trimmed.length > 0) {
    return resolveSetting(trimmed, lookup);
  }

  const looked: string[] = [];
  const roots: Root[] = [];

  const fromNpm = await npmRoot(lookup);
  if (fromNpm) {
    roots.push({ root: fromNpm, via: 'npm root -g' });
  } else {
    looked.push('npm root -g: npm could not be run');
  }

  let prefix: Root | undefined;
  for (const name of ['NPM_CONFIG_PREFIX', 'npm_config_prefix']) {
    const value = lookup.env[name];
    if (value && value.trim().length > 0) {
      prefix = { root: prefixRoot(value.trim(), lookup.platform), via: name };
      break;
    }
  }
  if (!prefix) {
    const fromFile = npmrcPrefix(lookup.homedir);
    if (fromFile) {
      prefix = { root: prefixRoot(fromFile, lookup.platform), via: 'prefix in .npmrc' };
    }
  }
  if (prefix) {
    roots.push(prefix);
  }
  if (!fromNpm && !prefix) {
    looked.push('global installation: npm could not be run and no npm prefix is configured');
  }
  for (const root of lookup.defaultRoots) {
    roots.push({ root, via: 'default global location' });
  }

  const candidates: ToolCandidate[] = [];
  const add = (candidate: ToolCandidate | undefined): void => {
    if (candidate && !candidates.some((existing) => existing.packageDir === candidate.packageDir)) {
      candidates.push(candidate);
    }
  };
  add(findGlobal(looked, roots));
  add(findOnPath(lookup, looked));

  return { looked, candidates, settingValue: undefined, settingProblem: undefined };
}
