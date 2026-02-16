/**
 * Shared operation lock for mutual exclusion between build and install operations.
 * Check operations are read-only and do NOT acquire the lock.
 */

export type OperationType = 'build' | 'install';

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
