import * as assert from 'assert';
import { handleMessage } from '../../panels/messageHandler';

suite('messageHandler', () => {
  test('unknown command responds with error', async () => {
    const response = await handleMessage({
      command: 'unknownCommand' as 'ready',
    });
    assert.ok(response, 'Should return a response');
    assert.strictEqual(response!.type, 'error');
    if (response!.type === 'error') {
      assert.ok(
        response!.payload.message.includes('Unknown command'),
        'Error should mention unknown command'
      );
    }
  });

  test('ready command responds with configLoaded', async () => {
    const response = await handleMessage({ command: 'ready' });
    assert.ok(response, 'Should return a response');
    assert.strictEqual(response!.type, 'configLoaded');
    if (response!.type === 'configLoaded') {
      assert.ok(
        typeof response!.payload.prefix === 'string',
        'Payload should have prefix string'
      );
      assert.ok(
        typeof response!.payload.isDefault === 'boolean',
        'Payload should have isDefault boolean'
      );
      assert.ok(
        Array.isArray(response!.payload.scopes),
        'Payload should have scopes array'
      );
    }
  });

  test('getConfig command responds with configLoaded and requestId', async () => {
    const response = await handleMessage({
      command: 'getConfig',
      requestId: 'test-123',
    });
    assert.ok(response, 'Should return a response');
    assert.strictEqual(response!.type, 'configLoaded');
    if (response!.type === 'configLoaded') {
      assert.strictEqual(response!.requestId, 'test-123');
    }
  });

  test('savePrefix command responds with prefixSaved', async () => {
    const response = await handleMessage({
      command: 'savePrefix',
      requestId: 'test-save-prefix',
      data: { prefix: '/tmp/test-seed' },
    });
    assert.ok(response, 'Should return a response');
    assert.strictEqual(response!.type, 'prefixSaved');
    if (response!.type === 'prefixSaved') {
      assert.strictEqual(response!.requestId, 'test-save-prefix');
      assert.strictEqual(response!.payload.prefix, '/tmp/test-seed');
    }
  });

  test('addScope with new scope responds with scopeAdded', async () => {
    const uniqueScope = `@test-scope-${Date.now()}`;
    const response = await handleMessage({
      command: 'addScope',
      requestId: 'test-add',
      data: {
        scopeName: uniqueScope,
        authorName: 'Test Author',
        authorEmail: 'test@test.com',
        authorUrl: 'https://test.com',
      },
    });
    assert.ok(response, 'Should return a response');
    assert.strictEqual(response!.type, 'scopeAdded');
    if (response!.type === 'scopeAdded') {
      assert.strictEqual(response!.requestId, 'test-add');
      const found = response!.payload.scopes.find((s) => s.name === uniqueScope);
      assert.ok(found, 'Newly added scope should be in payload');
    }

    // Cleanup: delete the scope
    await handleMessage({
      command: 'deleteScope',
      requestId: 'cleanup',
      data: { scopeName: uniqueScope },
    });
  });

  test('addScope with existing scope responds with scopeExists', async () => {
    const uniqueScope = `@test-exists-${Date.now()}`;
    // First add
    await handleMessage({
      command: 'addScope',
      requestId: 'setup',
      data: {
        scopeName: uniqueScope,
        authorName: 'First',
        authorEmail: '',
        authorUrl: '',
      },
    });

    // Second add (duplicate)
    const response = await handleMessage({
      command: 'addScope',
      requestId: 'test-dup',
      data: {
        scopeName: uniqueScope,
        authorName: 'Second',
        authorEmail: '',
        authorUrl: '',
      },
    });
    assert.ok(response, 'Should return a response');
    assert.strictEqual(response!.type, 'scopeExists');
    if (response!.type === 'scopeExists') {
      assert.strictEqual(response!.requestId, 'test-dup');
      assert.strictEqual(response!.payload.scopeName, uniqueScope);
    }

    // Cleanup
    await handleMessage({
      command: 'deleteScope',
      requestId: 'cleanup',
      data: { scopeName: uniqueScope },
    });
  });

  test('confirmOverwriteScope responds with scopeAdded', async () => {
    const uniqueScope = `@test-overwrite-${Date.now()}`;
    // First create
    await handleMessage({
      command: 'addScope',
      requestId: 'setup',
      data: {
        scopeName: uniqueScope,
        authorName: 'Original',
        authorEmail: '',
        authorUrl: '',
      },
    });

    // Overwrite
    const response = await handleMessage({
      command: 'confirmOverwriteScope',
      requestId: 'test-overwrite',
      data: {
        scopeName: uniqueScope,
        authorName: 'Updated',
        authorEmail: 'new@test.com',
        authorUrl: '',
      },
    });
    assert.ok(response, 'Should return a response');
    assert.strictEqual(response!.type, 'scopeAdded');

    // Cleanup
    await handleMessage({
      command: 'deleteScope',
      requestId: 'cleanup',
      data: { scopeName: uniqueScope },
    });
  });

  test('editScope responds with scopeEdited', async () => {
    const uniqueScope = `@test-edit-${Date.now()}`;
    // First create
    await handleMessage({
      command: 'addScope',
      requestId: 'setup',
      data: {
        scopeName: uniqueScope,
        authorName: 'Original',
        authorEmail: '',
        authorUrl: '',
      },
    });

    // Edit
    const response = await handleMessage({
      command: 'editScope',
      requestId: 'test-edit',
      data: {
        scopeName: uniqueScope,
        authorName: 'Edited Author',
        authorEmail: 'edited@test.com',
        authorUrl: 'https://edited.com',
      },
    });
    assert.ok(response, 'Should return a response');
    assert.strictEqual(response!.type, 'scopeEdited');
    if (response!.type === 'scopeEdited') {
      assert.strictEqual(response!.requestId, 'test-edit');
      const found = response!.payload.scopes.find((s) => s.name === uniqueScope);
      assert.ok(found, 'Edited scope should exist');
      assert.strictEqual(found!.author.name, 'Edited Author');
    }

    // Cleanup
    await handleMessage({
      command: 'deleteScope',
      requestId: 'cleanup',
      data: { scopeName: uniqueScope },
    });
  });

  test('deleteScope responds with scopeDeleted', async () => {
    const uniqueScope = `@test-delete-${Date.now()}`;
    // First create
    await handleMessage({
      command: 'addScope',
      requestId: 'setup',
      data: {
        scopeName: uniqueScope,
        authorName: 'ToDelete',
        authorEmail: '',
        authorUrl: '',
      },
    });

    // Delete
    const response = await handleMessage({
      command: 'deleteScope',
      requestId: 'test-del',
      data: { scopeName: uniqueScope },
    });
    assert.ok(response, 'Should return a response');
    assert.strictEqual(response!.type, 'scopeDeleted');
    if (response!.type === 'scopeDeleted') {
      assert.strictEqual(response!.requestId, 'test-del');
      const found = response!.payload.scopes.find((s) => s.name === uniqueScope);
      assert.ok(!found, 'Deleted scope should not be in payload');
    }
  });
});
