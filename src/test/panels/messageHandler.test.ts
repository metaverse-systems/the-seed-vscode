import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { handleMessage } from '../../panels/messageHandler';
import Config from '@metaverse-systems/the-seed/dist/Config';

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

  suite('createTemplate', () => {
    // Helper: ensure a scope exists for template tests
    async function ensureTestScope(scopeName: string) {
      await handleMessage({
        command: 'addScope',
        requestId: 'template-setup',
        data: {
          scopeName,
          authorName: 'Template Tester',
          authorEmail: 'template@test.com',
          authorUrl: 'https://template.test',
        },
      });
    }

    // Helper: clean up created template directory
    function cleanupTemplateDir(projectPath: string) {
      if (fs.existsSync(projectPath)) {
        fs.rmSync(projectPath, { recursive: true, force: true });
      }
    }

    test('successful component creation returns templateCreated', async () => {
      const uniqueScope = `@template-comp-${Date.now()}`;
      const templateName = `test-comp-${Date.now()}`;
      await ensureTestScope(uniqueScope);

      const config = new Config();
      config.loadConfig();
      const projectPath = path.join(
        config.config.prefix,
        'projects',
        uniqueScope,
        templateName
      );

      try {
        const response = await handleMessage({
          command: 'createTemplate',
          requestId: 'test-create-comp',
          data: {
            templateType: 'component',
            scopeName: uniqueScope,
            templateName,
          },
        });

        assert.ok(response, 'Should return a response');
        assert.strictEqual(response!.type, 'templateCreated');
        if (response!.type === 'templateCreated') {
          assert.strictEqual(response!.requestId, 'test-create-comp');
          assert.strictEqual(response!.payload.projectPath, projectPath);
          assert.strictEqual(response!.payload.templateType, 'component');
          assert.ok(
            fs.existsSync(projectPath),
            'Project directory should exist on disk'
          );
        }
      } finally {
        cleanupTemplateDir(projectPath);
        await handleMessage({
          command: 'deleteScope',
          requestId: 'cleanup',
          data: { scopeName: uniqueScope },
        });
      }
    });

    test('existing directory returns templateExists', async () => {
      const uniqueScope = `@template-exists-${Date.now()}`;
      const templateName = `test-exists-${Date.now()}`;
      await ensureTestScope(uniqueScope);

      const config = new Config();
      config.loadConfig();
      const projectPath = path.join(
        config.config.prefix,
        'projects',
        uniqueScope,
        templateName
      );

      try {
        // Create the directory first
        fs.mkdirSync(projectPath, { recursive: true });

        const response = await handleMessage({
          command: 'createTemplate',
          requestId: 'test-exists',
          data: {
            templateType: 'component',
            scopeName: uniqueScope,
            templateName,
          },
        });

        assert.ok(response, 'Should return a response');
        assert.strictEqual(response!.type, 'templateExists');
        if (response!.type === 'templateExists') {
          assert.strictEqual(response!.requestId, 'test-exists');
          assert.strictEqual(response!.payload.projectPath, projectPath);
        }
      } finally {
        cleanupTemplateDir(projectPath);
        await handleMessage({
          command: 'deleteScope',
          requestId: 'cleanup',
          data: { scopeName: uniqueScope },
        });
      }
    });

    test('system type scaffolds correctly', async () => {
      const uniqueScope = `@template-sys-${Date.now()}`;
      const templateName = `test-sys-${Date.now()}`;
      await ensureTestScope(uniqueScope);

      const config = new Config();
      config.loadConfig();
      const projectPath = path.join(
        config.config.prefix,
        'projects',
        uniqueScope,
        templateName
      );

      try {
        const response = await handleMessage({
          command: 'createTemplate',
          requestId: 'test-create-sys',
          data: {
            templateType: 'system',
            scopeName: uniqueScope,
            templateName,
          },
        });

        assert.ok(response, 'Should return a response');
        assert.strictEqual(response!.type, 'templateCreated');
        if (response!.type === 'templateCreated') {
          assert.strictEqual(response!.payload.templateType, 'system');
          // System templates should include .pc.in
          assert.ok(
            fs.existsSync(path.join(projectPath, `${templateName}.pc.in`)),
            'System template should have .pc.in file'
          );
        }
      } finally {
        cleanupTemplateDir(projectPath);
        await handleMessage({
          command: 'deleteScope',
          requestId: 'cleanup',
          data: { scopeName: uniqueScope },
        });
      }
    });

    test('program type scaffolds without .pc.in', async () => {
      const uniqueScope = `@template-prog-${Date.now()}`;
      const templateName = `test-prog-${Date.now()}`;
      await ensureTestScope(uniqueScope);

      const config = new Config();
      config.loadConfig();
      const projectPath = path.join(
        config.config.prefix,
        'projects',
        uniqueScope,
        templateName
      );

      try {
        const response = await handleMessage({
          command: 'createTemplate',
          requestId: 'test-create-prog',
          data: {
            templateType: 'program',
            scopeName: uniqueScope,
            templateName,
          },
        });

        assert.ok(response, 'Should return a response');
        assert.strictEqual(response!.type, 'templateCreated');
        if (response!.type === 'templateCreated') {
          assert.strictEqual(response!.payload.templateType, 'program');
          // Program templates should NOT have .pc.in
          assert.ok(
            !fs.existsSync(path.join(projectPath, `${templateName}.pc.in`)),
            'Program template should not have .pc.in file'
          );
        }
      } finally {
        cleanupTemplateDir(projectPath);
        await handleMessage({
          command: 'deleteScope',
          requestId: 'cleanup',
          data: { scopeName: uniqueScope },
        });
      }
    });
  });

  suite('Build Messages', () => {
    test('startBuild responds with buildStarted when no build is running', async () => {
      const response = await handleMessage({
        command: 'startBuild',
        requestId: 'test-build-1',
        data: { target: 'native' },
      });
      assert.ok(response, 'Should return a response');
      // The handler should respond with buildStarted or error (no buildable project)
      assert.ok(
        response!.type === 'buildStarted' || response!.type === 'error',
        `Expected buildStarted or error, got ${response!.type}`
      );
    });

    test('cancelBuild responds with buildCancelled', async () => {
      const response = await handleMessage({
        command: 'cancelBuild',
        requestId: 'test-cancel-1',
      });
      assert.ok(response, 'Should return a response');
      assert.strictEqual(response!.type, 'buildCancelled');
      if (response!.type === 'buildCancelled') {
        assert.strictEqual(response!.requestId, 'test-cancel-1');
      }
    });

    test('getBuildStatus responds with buildStatusResponse', async () => {
      const response = await handleMessage({
        command: 'getBuildStatus',
        requestId: 'test-status-1',
      });
      assert.ok(response, 'Should return a response');
      assert.strictEqual(response!.type, 'buildStatusResponse');
      if (response!.type === 'buildStatusResponse') {
        assert.strictEqual(response!.requestId, 'test-status-1');
        assert.ok(response!.payload, 'Should have payload');
        assert.ok(
          ['idle', 'running', 'completed', 'failed', 'cancelled'].includes(response!.payload.state),
          'State should be a valid BuildState'
        );
      }
    });
  });
});
