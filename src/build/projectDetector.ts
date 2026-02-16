import * as fs from 'fs';
import * as path from 'path';

export interface BuildableProject {
  /** Absolute filesystem path to the project root */
  path: string;
  /** Project name from package.json */
  name: string;
  /** Whether package.json contains the-seed build scripts */
  hasBuildScripts: boolean;
}

/**
 * Walks up from the given file path toward the workspace root to find
 * the nearest package.json that contains a the-seed build script.
 *
 * @param filePath - Absolute path of the active editor file
 * @param workspaceRoot - Absolute path of the workspace root (search boundary)
 * @returns The detected BuildableProject, or null if none found
 */
export function detectBuildableProject(
  filePath: string,
  workspaceRoot: string
): BuildableProject | null {
  let currentDir = path.dirname(filePath);
  const normalizedRoot = path.resolve(workspaceRoot);

  while (true) {
    const normalizedCurrent = path.resolve(currentDir);

    // Don't search above workspace root
    if (!normalizedCurrent.startsWith(normalizedRoot) && normalizedCurrent !== normalizedRoot) {
      return null;
    }

    const packageJsonPath = path.join(currentDir, 'package.json');

    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        const scripts = packageJson.scripts;

        if (scripts && typeof scripts === 'object') {
          const buildScript = scripts.build;
          if (typeof buildScript === 'string' && buildScript.includes('the-seed')) {
            return {
              path: currentDir,
              name: packageJson.name || path.basename(currentDir),
              hasBuildScripts: true,
            };
          }
        }
      } catch {
        // Malformed JSON — skip this directory
      }
    }

    // Stop if we've reached the workspace root
    if (normalizedCurrent === normalizedRoot) {
      return null;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached filesystem root without finding anything
      return null;
    }

    currentDir = parentDir;
  }
}
