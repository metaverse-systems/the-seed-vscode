// The checks behind the bundle and package stages of scripts/run-checks.js:
// the expected contents of the .vsix, a reader for its entry names, and the
// lines each failure is reported with. Pure functions, Node built-ins only.

/**
 * The entries of the shipped package, sorted. `vsce` renames `README.md`,
 * `CHANGELOG.md` and `LICENSE` to `readme.md`, `changelog.md` and
 * `LICENSE.txt`, and writes the two root entries itself.
 */
export const EXPECTED_PACKAGE_FILES: readonly string[] = [
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

/**
 * Package names the host bundle may inline from `node_modules`. Empty: the
 * host uses only Node built-ins, the editor API and the tool it loads at run
 * time. Adding a library here is a deliberate decision to ship its code.
 */
export const ALLOWED_BUNDLE_LIBRARIES: readonly string[] = [];

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const END_RECORD_SIZE = 22;
const CENTRAL_ENTRY_SIZE = 46;
const MAX_COMMENT = 0xffff;

/**
 * The entry names of a zip archive, in central-directory order, read from the
 * end-of-central-directory record and the central directory. Throws on a
 * malformed, truncated, multi-disk or ZIP64 archive.
 */
export function readZipEntryNames(zip: Buffer): string[] {
  if (zip.length < END_RECORD_SIZE) {
    throw new Error(`not a zip archive: ${zip.length} bytes is shorter than the end-of-central-directory record`);
  }
  let end = -1;
  const lowest = Math.max(0, zip.length - END_RECORD_SIZE - MAX_COMMENT);
  for (let position = zip.length - END_RECORD_SIZE; position >= lowest; position--) {
    if (zip.readUInt32LE(position) === END_OF_CENTRAL_DIRECTORY
      && position + END_RECORD_SIZE + zip.readUInt16LE(position + 20) === zip.length) {
      end = position;
      break;
    }
  }
  if (end === -1) {
    throw new Error('not a zip archive: no end-of-central-directory record (truncated?)');
  }

  const disk = zip.readUInt16LE(end + 4);
  const centralDisk = zip.readUInt16LE(end + 6);
  const entriesOnDisk = zip.readUInt16LE(end + 8);
  const entryCount = zip.readUInt16LE(end + 10);
  const centralSize = zip.readUInt32LE(end + 12);
  const centralOffset = zip.readUInt32LE(end + 16);
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error('ZIP64 archives are not supported');
  }
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error('multi-disk zip archives are not supported');
  }
  if (centralOffset + centralSize > end) {
    throw new Error('malformed zip archive: the central directory lies outside the archive');
  }

  const names: string[] = [];
  let position = centralOffset;
  const limit = centralOffset + centralSize;
  for (let index = 0; index < entryCount; index++) {
    if (position + CENTRAL_ENTRY_SIZE > limit || zip.readUInt32LE(position) !== CENTRAL_DIRECTORY_ENTRY) {
      throw new Error(`malformed zip archive: central directory entry ${index + 1} of ${entryCount} is missing`);
    }
    const nameLength = zip.readUInt16LE(position + 28);
    const extraLength = zip.readUInt16LE(position + 30);
    const commentLength = zip.readUInt16LE(position + 32);
    const next = position + CENTRAL_ENTRY_SIZE + nameLength + extraLength + commentLength;
    if (next > limit) {
      throw new Error(`malformed zip archive: central directory entry ${index + 1} of ${entryCount} is truncated`);
    }
    names.push(zip.toString('utf8', position + CENTRAL_ENTRY_SIZE, position + CENTRAL_ENTRY_SIZE + nameLength));
    position = next;
  }
  if (position !== limit) {
    throw new Error('malformed zip archive: the central directory size does not match its entries');
  }
  return names;
}

const ANSI_ESCAPE = /\u001b\[[0-9;]*m/g;

/** The package tool's warning and error lines (those containing ` WARNING ` or ` ERROR `), trimmed. */
export function scanPackagerOutput(text: string): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(ANSI_ESCAPE, '');
    if (line.includes(' WARNING ')) {
      warnings.push(line.trim());
    } else if (line.includes(' ERROR ')) {
      errors.push(line.trim());
    }
  }
  return { warnings, errors };
}

/** Expected entries absent from `actual`, and entries of `actual` not expected; each sorted. */
export function compareFileList(expected: readonly string[], actual: readonly string[]): { missing: string[]; extra: string[] } {
  const present = new Set(actual);
  const wanted = new Set(expected);
  return {
    missing: [...wanted].filter((entry) => !present.has(entry)).sort(),
    extra: [...present].filter((entry) => !wanted.has(entry)).sort(),
  };
}

/** What the package check reads from the manifest and from `.vscode-test.mjs`. */
export interface ManifestFacts {
  /** Names in the manifest's `dependencies`. */
  dependencies: string[];
  /** `engines.vscode` as written, or undefined when absent. */
  engineRange: string | undefined;
  /** The version after the `^` of `engines.vscode`, or undefined when the range is absent or not a caret range. */
  engineFloor: string | undefined;
  /** The `version: '<v>'` of `.vscode-test.mjs`, or undefined when not found. */
  testedVersion: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function manifestFacts(manifest: unknown, testConfigText: string): ManifestFacts {
  const fields = isRecord(manifest) ? manifest : {};
  const dependencies = isRecord(fields.dependencies) ? Object.keys(fields.dependencies) : [];
  const engines = isRecord(fields.engines) ? fields.engines : {};
  const engineRange = typeof engines.vscode === 'string' ? engines.vscode : undefined;
  const caret = engineRange === undefined ? null : /^\^(\S+)$/.exec(engineRange.trim());
  const tested = /\bversion:\s*['"]([^'"]+)['"]/.exec(testConfigText);
  return {
    dependencies,
    engineRange,
    engineFloor: caret ? caret[1] : undefined,
    testedVersion: tested ? tested[1] : undefined,
  };
}

function dependencyLine(name: string): string {
  return `PACKAGE DEPENDENCY: ${name} is a runtime dependency; libraries are bundled or development dependencies`;
}

function engineLines(range: string | undefined, floor: string | undefined, tested: string | undefined): string[] {
  if (tested !== undefined && floor === tested) {
    return [];
  }
  const shown = range ?? (floor === undefined ? 'absent' : `^${floor}`);
  const version = tested ?? 'not found in .vscode-test.mjs';
  return [`PACKAGE ENGINE: engines.vscode is ${shown}; the tested editor version is ${version}`];
}

/** The `PACKAGE DEPENDENCY` and `PACKAGE ENGINE` lines for a manifest; empty when it passes. */
export function checkManifest(manifest: unknown, testConfigText: string): string[] {
  const facts = manifestFacts(manifest, testConfigText);
  return [
    ...facts.dependencies.map(dependencyLine),
    ...engineLines(facts.engineRange, facts.engineFloor, facts.testedVersion),
  ];
}

/** What the package stage found after the package tool ran. */
export interface PackageReport {
  /** The package produced (`the-seed-vscode-<version>.vsix`). */
  file: string;
  /** False when the package tool produced no file; absent means it did. */
  produced?: boolean;
  exitCode: number;
  /** Output lines containing ` WARNING `. */
  warnings: string[];
  /** Output lines containing ` ERROR `. */
  errors: string[];
  /** Names in the manifest's `dependencies`. */
  dependencies: string[];
  engineFloor: string | undefined;
  testedVersion: string | undefined;
  /** `engines.vscode` as written, for the message; derived from `engineFloor` when absent. */
  engineRange?: string;
  missing: string[];
  extra: string[];
  entries: number;
  bytes: number;
}

/** One line per failure of the report, and whether the package passed. */
export function packageReportLines(report: PackageReport): { failures: string[]; passed: boolean } {
  const failures: string[] = [];
  if (report.exitCode !== 0) {
    failures.push(`PACKAGE ERROR: vsce exited with status ${report.exitCode}`);
  }
  failures.push(...report.warnings.map((line) => `PACKAGE WARNING: ${line}`));
  failures.push(...report.errors.map((line) => `PACKAGE ERROR: ${line}`));
  failures.push(...report.dependencies.map(dependencyLine));
  failures.push(...engineLines(report.engineRange, report.engineFloor, report.testedVersion));
  if (report.produced === false) {
    failures.push('PACKAGE ERROR: no package was produced');
  }
  failures.push(...report.missing.map((entry) => `PACKAGE MISSING: ${entry}`));
  failures.push(...report.extra.map((entry) => `PACKAGE EXTRA: ${entry}`));
  return { failures, passed: failures.length === 0 };
}

/** The package an input under `node_modules/` belongs to (the innermost one), or null for other inputs. */
function libraryOf(input: string): string | null {
  const segments = input.split(/[\\/]/);
  const at = segments.lastIndexOf('node_modules');
  if (at === -1 || at + 1 >= segments.length) {
    return null;
  }
  const first = segments[at + 1];
  if (first.startsWith('@')) {
    return at + 2 < segments.length ? `${first}/${segments[at + 2]}` : first;
  }
  return first;
}

/**
 * The bundle stage's failures: a `BUNDLE INPUT` line for each bundle input
 * from a library not in `allowed`, and a `BUNDLE TOOL` line when the output
 * requires the tool by name (it must be loaded at run time instead).
 */
export function bundleInputFailures(inputs: readonly string[], outputText: string, allowed: readonly string[]): string[] {
  const lines: string[] = [];
  for (const input of inputs) {
    const library = libraryOf(input);
    if (library !== null && !allowed.includes(library)) {
      lines.push(`BUNDLE INPUT: ${input} (the library ${library} is not in ALLOWED_BUNDLE_LIBRARIES)`);
    }
  }
  if (outputText.includes('require("@metaverse-systems/the-seed')) {
    lines.push('BUNDLE TOOL: the bundle requires @metaverse-systems/the-seed by name; the tool is loaded at run time');
  }
  return lines;
}
