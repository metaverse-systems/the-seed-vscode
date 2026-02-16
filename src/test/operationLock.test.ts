import * as assert from 'assert';
import { acquireOperationLock, releaseOperationLock, getOperationLock } from '../operationLock';

suite('Operation Lock', () => {
  // Always release the lock after each test
  teardown(() => {
    releaseOperationLock();
  });

  test('should start with no active lock', () => {
    const lock = getOperationLock();
    assert.strictEqual(lock.active, false);
    assert.strictEqual(lock.type, null);
    assert.strictEqual(lock.abortController, null);
  });

  test('should acquire a build lock successfully', () => {
    const result = acquireOperationLock('build');
    assert.strictEqual(result.success, true);
    assert.ok(result.abortController instanceof AbortController);

    const lock = getOperationLock();
    assert.strictEqual(lock.active, true);
    assert.strictEqual(lock.type, 'build');
    assert.ok(lock.abortController !== null);
  });

  test('should acquire an install lock successfully', () => {
    const result = acquireOperationLock('install');
    assert.strictEqual(result.success, true);
    assert.ok(result.abortController instanceof AbortController);

    const lock = getOperationLock();
    assert.strictEqual(lock.active, true);
    assert.strictEqual(lock.type, 'install');
  });

  test('should reject when build lock is already held', () => {
    acquireOperationLock('build');
    const result = acquireOperationLock('install');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.heldBy, 'build');
  });

  test('should reject when install lock is already held', () => {
    acquireOperationLock('install');
    const result = acquireOperationLock('build');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.heldBy, 'install');
  });

  test('should reject same-type lock acquisition', () => {
    acquireOperationLock('build');
    const result = acquireOperationLock('build');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.heldBy, 'build');
  });

  test('should release the lock', () => {
    acquireOperationLock('build');
    releaseOperationLock();

    const lock = getOperationLock();
    assert.strictEqual(lock.active, false);
    assert.strictEqual(lock.type, null);
    assert.strictEqual(lock.abortController, null);
  });

  test('should allow re-acquisition after release', () => {
    acquireOperationLock('build');
    releaseOperationLock();

    const result = acquireOperationLock('install');
    assert.strictEqual(result.success, true);

    const lock = getOperationLock();
    assert.strictEqual(lock.type, 'install');
  });

  test('release is safe to call when not held', () => {
    // Should not throw
    releaseOperationLock();
    releaseOperationLock();
    const lock = getOperationLock();
    assert.strictEqual(lock.active, false);
  });

  test('AbortController from acquire can signal abort', () => {
    const result = acquireOperationLock('install');
    assert.strictEqual(result.success, true);

    const controller = result.abortController!;
    assert.strictEqual(controller.signal.aborted, false);

    controller.abort();
    assert.strictEqual(controller.signal.aborted, true);

    // Lock is still held (abort doesn't auto-release)
    const lock = getOperationLock();
    assert.strictEqual(lock.active, true);
  });
});
