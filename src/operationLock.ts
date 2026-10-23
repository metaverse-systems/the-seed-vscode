/**
 * Shared operation lock for mutual exclusion between long operations (build, dependency install,
 * packaging and installer generation). Check operations are read-only and do NOT acquire the lock.
 */

export type OperationType = 'build' | 'install' | 'package' | 'installer';

const REFUSALS: Record<OperationType, Record<OperationType, string>> = {
  build: {
    build: 'A build is already in progress.',
    install: 'Cannot build while an install operation is in progress.',
    package: 'Cannot build while a packaging operation is in progress.',
    installer: 'Cannot build while an installer is being generated.',
  },
  install: {
    build: 'Cannot install dependencies while a build operation is in progress.',
    install: 'A dependency installation is already in progress.',
    package: 'Cannot install dependencies while a packaging operation is in progress.',
    installer: 'Cannot install dependencies while an installer is being generated.',
  },
  package: {
    build: 'Cannot package while a build operation is in progress.',
    install: 'Cannot package while an install operation is in progress.',
    package: 'A package operation is already in progress.',
    installer: 'Cannot package while an installer is being generated.',
  },
  installer: {
    build: 'Cannot generate the installer while a build operation is in progress.',
    install: 'Cannot generate the installer while an install operation is in progress.',
    package: 'Cannot generate the installer while a packaging operation is in progress.',
    installer: 'Installer generation is already in progress.',
  },
};

/** The warning shown when `attempt` cannot start because `holder` holds the lock. */
export function lockRefusal(attempt: OperationType, holder: OperationType): string {
  return REFUSALS[attempt][holder];
}

interface OperationLockState {
  active: boolean;
  type: OperationType | null;
  abortController: AbortController | null;
}

const lock: OperationLockState = {
  active: false,
  type: null,
  abortController: null,
};

export interface AcquireLockResult {
  success: boolean;
  /** If success is false, the type of operation currently holding the lock */
  heldBy?: OperationType;
}

/**
 * Attempt to acquire the shared operation lock.
 * Returns success: true with an AbortController if acquired,
 * or success: false with the current holder type if the lock is already held.
 */
export function acquireOperationLock(type: OperationType): AcquireLockResult & { abortController?: AbortController } {
  if (lock.active) {
    return { success: false, heldBy: lock.type! };
  }

  const abortController = new AbortController();
  lock.active = true;
  lock.type = type;
  lock.abortController = abortController;

  return { success: true, abortController };
}

/**
 * Release the shared operation lock.
 * Safe to call even if the lock is not held.
 */
export function releaseOperationLock(): void {
  lock.active = false;
  lock.type = null;
  lock.abortController = null;
}

/**
 * Get the current state of the operation lock.
 */
export function getOperationLock(): Readonly<{ active: boolean; type: OperationType | null; abortController: AbortController | null }> {
  return { ...lock };
}
