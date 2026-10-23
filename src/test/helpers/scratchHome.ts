import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { testTool } from './tool';

export interface ScratchHome {
  dir: string;
  restore(): void;
}

/**
 * Points the home directory at a fresh scratch directory so the tool's
 * configuration and signing directory are read and written there.
 * The tool resolves the home directory on every use, so changing the
 * environment is enough.
 */
export function useScratchHome(): ScratchHome {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'the-seed-ext-'));
  const savedHome = process.env.HOME;
  const savedProfile = process.env.USERPROFILE;
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  return {
    dir,
    restore(): void {
      if (savedHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = savedHome;
      }
      if (savedProfile === undefined) {
        delete process.env.USERPROFILE;
      } else {
        process.env.USERPROFILE = savedProfile;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Replaces the configured scopes; a null author name leaves the name empty. */
export function writeScopes(authors: Record<string, string>): void {
  const config = new (testTool().Config)();
  config.config.scopes = {};
  for (const [scope, name] of Object.entries(authors)) {
    config.config.scopes[scope] = { author: { name, email: '', url: '' } };
  }
  config.saveConfig();
}

/** Creates a signing certificate for a configured scope. */
export async function createCertFor(scope: string, validityDays = 30): Promise<string> {
  const info = await new (testTool().Signing)().createCert({ scope, validityDays });
  return info.fingerprint;
}

/**
 * Absolute path of a binary fixture kept in this repository under src/test/fixtures.
 * tiny.exe is a byte-for-byte copy of the-seed/test/fixtures/binaries/tiny.exe.
 */
export function fixturePath(name: string): string {
  return path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'fixtures', name);
}
