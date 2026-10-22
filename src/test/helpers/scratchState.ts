import * as fs from 'fs';
import * as sinon from 'sinon';
import { releaseOperationLock } from '../../operationLock';
import { ScratchHome, useScratchHome, writeScopes } from './scratchHome';
import { makeScratchDir, stubWorkspaceFolders, useScratchPrefix } from './workspaceStub';

export interface ScratchStateOptions {
  /** Scope to author name ('' for none); default: no scopes. */
  scopes?: Record<string, string>;
  /** Save an empty scratch prefix; default true. */
  prefix?: boolean;
  /** Number of empty scratch workspace folders; default 0. */
  workspaceFolders?: number;
}

export interface ScratchState {
  home: string;
  prefix: string | null;
  workspaceFolders: string[];
  /** A further scratch directory, removed in teardown. */
  dir(label: string): string;
  setWorkspaceFolders(folders: string[]): void;
}

/**
 * Registers a scratch home, optional scopes, prefix and workspace folders for
 * the enclosing suite, and a teardown that undoes all of it after a pass, a
 * failure or a timeout. The returned object's fields are reassigned in each setup.
 */
export function useScratchState(options: ScratchStateOptions = {}): ScratchState {
  const wantPrefix = options.prefix ?? true;
  const folderCount = options.workspaceFolders ?? 0;

  let scratchHome: ScratchHome | null = null;
  let restoreFolders: () => void = () => undefined;
  let created: string[] = [];

  const state: ScratchState = {
    home: '',
    prefix: null,
    workspaceFolders: [],
    dir(label: string): string {
      const made = makeScratchDir(label);
      created.push(made);
      return made;
    },
    setWorkspaceFolders(folders: string[]): void {
      restoreFolders();
      state.workspaceFolders = folders;
      restoreFolders = stubWorkspaceFolders(folders);
    },
  };

  setup(() => {
    created = [];
    restoreFolders = () => undefined;
    scratchHome = useScratchHome();
    state.home = scratchHome.dir;
    if (options.scopes) {
      writeScopes(options.scopes);
    }
    if (wantPrefix) {
      state.prefix = useScratchPrefix();
      created.push(state.prefix);
    } else {
      state.prefix = null;
    }
    const folders: string[] = [];
    for (let index = 0; index < folderCount; index++) {
      folders.push(state.dir(`folder${index}`));
    }
    state.workspaceFolders = folders;
    restoreFolders = stubWorkspaceFolders(folders);
  });

  teardown(() => {
    sinon.restore();
    restoreFolders();
    restoreFolders = () => undefined;
    releaseOperationLock();
    for (const made of created) {
      fs.rmSync(made, { recursive: true, force: true });
    }
    created = [];
    if (scratchHome) {
      scratchHome.restore();
      scratchHome = null;
    }
  });

  return state;
}
