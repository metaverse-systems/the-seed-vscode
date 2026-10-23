import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import { EXPORT_TABLE, type ExportRow, type ToolApi } from './toolApi';
import { TOOL_PACKAGE_NAME } from './requiredVersion';

/** The tool could not be loaded; `firstLine` is what to show the user. */
export class LoadFailure extends Error {
  readonly firstLine: string;

  constructor(firstLine: string) {
    super(firstLine);
    this.name = 'LoadFailure';
    this.firstLine = firstLine;
  }
}

/** The first line of whatever was thrown. */
export function firstLineOf(thrown: unknown): string {
  const text = thrown instanceof Error ? thrown.message : String(thrown);
  const line = text.split(/\r?\n/, 1)[0].trim();
  return line.length > 0 ? line : 'unknown error';
}

// Node cannot unload modules, so a copy loaded once stays for the session.
const loaded = new Map<string, ToolApi>();

function isClass(value: unknown): boolean {
  return typeof value === 'function' && /^class[\s{]/.test(Function.prototype.toString.call(value));
}

function hasKind(value: unknown, kind: ExportRow['kind']): boolean {
  switch (kind) {
    case 'class':
      return isClass(value);
    case 'function':
      return typeof value === 'function';
    default:
      return typeof value === 'number';
  }
}

function readVersion(realDir: string): string {
  let manifest: { version?: unknown };
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(realDir, 'package.json'), 'utf8')) as { version?: unknown };
  } catch (error) {
    throw new LoadFailure(`its package information could not be read: ${firstLineOf(error)}`);
  }
  if (typeof manifest.version !== 'string') {
    throw new LoadFailure('its package information has no version');
  }
  return manifest.version;
}

/**
 * Loads every value the extension uses from the installation at `packageDir`, through that
 * installation's own entry points. The result is frozen and shared by every caller that loads the same
 * directory at the same version. Any problem is a LoadFailure.
 */
export function loadInstallation(packageDir: string): ToolApi {
  let realDir: string;
  try {
    realDir = fs.realpathSync(packageDir);
  } catch (error) {
    throw new LoadFailure(firstLineOf(error));
  }
  const key = `${realDir}@${readVersion(realDir)}`;
  const cached = loaded.get(key);
  if (cached) {
    return cached;
  }

  const requireFromTool = createRequire(path.join(realDir, 'package.json'));
  const modules = new Map<string, Record<string, unknown>>();
  const api: Record<string, unknown> = {};
  for (const item of EXPORT_TABLE) {
    let loadedModule = modules.get(item.subpath);
    if (!loadedModule) {
      try {
        loadedModule = requireFromTool(`${TOOL_PACKAGE_NAME}/${item.subpath}`) as Record<string, unknown>;
      } catch (error) {
        throw new LoadFailure(firstLineOf(error));
      }
      modules.set(item.subpath, loadedModule);
    }
    const value = loadedModule?.[item.exportName];
    if (value === undefined) {
      throw new LoadFailure(`missing export ${item.member} from ${item.subpath}`);
    }
    if (!hasKind(value, item.kind)) {
      throw new LoadFailure(`export ${item.member} from ${item.subpath} is not a ${item.kind}`);
    }
    api[item.member] = value;
  }

  const frozen = Object.freeze(api) as unknown as ToolApi;
  loaded.set(key, frozen);
  return frozen;
}
