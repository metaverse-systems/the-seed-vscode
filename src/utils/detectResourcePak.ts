import * as fs from 'fs';
import * as path from 'path';
import type { ResourcePakStatusPayload } from '../types/messages';

/**
 * Detects whether a given folder is a ResourcePak by checking its package.json
 * for a `resources` array property.
 *
 * @param folderPath Absolute path to the folder to inspect
 * @returns Detection result with pak info, or null if not a ResourcePak
 */
export function detectResourcePak(folderPath: string): ResourcePakStatusPayload | null {
  try {
    const pkgPath = path.join(folderPath, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      return null;
    }

    const raw = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw);

    if (!Array.isArray(pkg.resources)) {
      return null;
    }

    const pakName: string = pkg.name || '';
    let scope = '';
    let displayName = pakName;

    if (pakName.startsWith('@') && pakName.includes('/')) {
      const slashIndex = pakName.indexOf('/');
      scope = pakName.substring(0, slashIndex);
      displayName = pakName.substring(slashIndex + 1);
    }

    return {
      detected: true,
      pakName,
      scope,
      displayName,
      resourceCount: pkg.resources.length,
      packageDir: folderPath,
    };
  } catch {
    return null;
  }
}
