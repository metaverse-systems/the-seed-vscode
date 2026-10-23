import * as assert from 'assert';
import { acquireOperationLock, releaseOperationLock, getOperationLock, lockRefusal } from '../operationLock';
import type { OperationType } from '../operationLock';
import { buildRefusal } from '../build/buildStart';

const KINDS: OperationType[] = ['build', 'install', 'package', 'installer'];

/** Every refusal text, by the operation attempted and then the holder of the lock. */
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

  test('a held build lock refuses package, and package is acquired after release', () => {
    acquireOperationLock('build');
    const refused = acquireOperationLock('package');
    assert.strictEqual(refused.success, false);
    assert.strictEqual(refused.heldBy, 'build');

    releaseOperationLock();

    const acquired = acquireOperationLock('package');
    assert.strictEqual(acquired.success, true);
    assert.strictEqual(getOperationLock().type, 'package');
  });

  test('a held package lock refuses build', () => {
    acquireOperationLock('package');
    const result = acquireOperationLock('build');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.heldBy, 'package');
  });

  test('a held package lock refuses install', () => {
    acquireOperationLock('package');
    const result = acquireOperationLock('install');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.heldBy, 'package');
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

  for (const attempt of KINDS) {
    for (const holder of KINDS) {
      test(`lockRefusal('${attempt}', '${holder}') is the table's text`, () => {
        assert.strictEqual(lockRefusal(attempt, holder), REFUSALS[attempt][holder]);
      });
    }
  }

  test('an installer lock is held as installer and refuses every kind with the state unchanged', () => {
    const result = acquireOperationLock('installer');
    assert.strictEqual(result.success, true);
    assert.ok(result.abortController instanceof AbortController);
    const held = getOperationLock();
    assert.strictEqual(held.active, true);
    assert.strictEqual(held.type, 'installer');

    for (const kind of KINDS) {
      const refused = acquireOperationLock(kind);
      assert.strictEqual(refused.success, false, `${kind} is refused`);
      assert.strictEqual(refused.heldBy, 'installer');
      const after = getOperationLock();
      assert.strictEqual(after.type, 'installer', `the holder is unchanged after ${kind}`);
      assert.strictEqual(after.abortController, result.abortController, `the controller is unchanged after ${kind}`);
    }
  });

  for (const holder of KINDS) {
    test(`buildRefusal('${holder}') equals the table's build row`, () => {
      assert.strictEqual(buildRefusal(holder), lockRefusal('build', holder));
      assert.strictEqual(buildRefusal(holder), REFUSALS.build[holder]);
    });
  }
});
