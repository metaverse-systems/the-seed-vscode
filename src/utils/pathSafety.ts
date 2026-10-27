// Checks on paths the user chose, so packaging never writes over a project or
// a workspace folder. Paths are only compared and passed to fs; nothing here
// goes through a shell.
import * as fs from 'fs';
import * as path from 'path';

export type PathImpl = typeof path.posix;

function isWindows(impl: PathImpl): boolean {
  return impl.sep === '\\';
}

/**
 * The absolute path with symbolic links resolved. Only the longest part that exists can be resolved; the
 * parts after it are appended as given, so a path that does not exist yet can still be compared.
 */
export function canonical(p: string, impl: PathImpl = path): string {
  let existing = impl.resolve(p);
  const rest: string[] = [];
  while (!fs.existsSync(existing)) {
    const parent = impl.dirname(existing);
    if (parent === existing) {
      break;
    }
    rest.unshift(impl.basename(existing));
    existing = parent;
  }
  let real = existing;
  try {
    real = fs.realpathSync.native(existing);
  } catch {
    // Nothing of the path exists: compare it as resolved
  }
  return rest.length === 0 ? real : impl.join(real, ...rest);
}

/** Whether `child` is `parent` or lies inside it. Case is ignored on Windows. */
export function isSameOrInside(child: string, parent: string, impl: PathImpl = path): boolean {
  const fold = (p: string): string => (isWindows(impl) ? impl.resolve(p).toLowerCase() : impl.resolve(p));
  const relative = impl.relative(fold(parent), fold(child));
  if (relative === '') {
    return true;
  }
  return relative !== '..' && !relative.startsWith(`..${impl.sep}`) && !impl.isAbsolute(relative);
}

function isFile(p: string): boolean {
  try {
    return !fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Why `output` cannot take a packaging result, or null when it can. It must not be a file, a chosen
 * project, or a directory holding a chosen project or a workspace folder. A directory inside a project
 * is allowed.
 */
export function outputConflict(
  output: string,
  projects: string[],
  workspaceFolders: string[],
  impl: PathImpl = path
): string | null {
  const refused = (reason: string): string => `Cannot package into "${output}": ${reason}.`;
  if (isFile(output)) {
    return refused('it is a file');
  }
  for (const project of projects) {
    if (isSameOrInside(output, project, impl) && isSameOrInside(project, output, impl)) {
      return refused(`it is the project "${project}"`);
    }
    if (isSameOrInside(project, output, impl)) {
      return refused(`it contains the project "${project}"`);
    }
  }
  for (const folder of workspaceFolders) {
    if (isSameOrInside(folder, output, impl)) {
      return refused(`it contains the workspace folder "${folder}"`);
    }
  }
  return null;
}
