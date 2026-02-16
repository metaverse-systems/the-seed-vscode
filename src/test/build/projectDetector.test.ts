import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { detectBuildableProject } from '../../build/projectDetector';
import type { BuildableProject } from '../../build/projectDetector';

suite('projectDetector', () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projdetect-test-'));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('detects a buildable project with the-seed build script', () => {
    const projectDir = path.join(tmpDir, 'my-component');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({
        name: 'my-component',
        scripts: { build: 'the-seed build' },
      })
    );

    const filePath = path.join(projectDir, 'src', 'main.cpp');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '// source');

    const result = detectBuildableProject(filePath, tmpDir);
    assert.ok(result, 'Should find project');
    assert.strictEqual(result!.path, projectDir);
    assert.strictEqual(result!.name, 'my-component');
    assert.strictEqual(result!.hasBuildScripts, true);
  });

  test('walks up directories to find project', () => {
    const projectDir = path.join(tmpDir, 'scope', 'my-system');
    const deepDir = path.join(projectDir, 'src', 'subsystem', 'deep');
    fs.mkdirSync(deepDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({
        name: 'my-system',
        scripts: { build: 'the-seed build native' },
      })
    );
    fs.writeFileSync(path.join(deepDir, 'file.ts'), '');

    const result = detectBuildableProject(path.join(deepDir, 'file.ts'), tmpDir);
    assert.ok(result, 'Should find project from deep path');
    assert.strictEqual(result!.path, projectDir);
  });

  test('returns null when no package.json exists', () => {
    const filePath = path.join(tmpDir, 'random', 'file.ts');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '');

    const result = detectBuildableProject(filePath, tmpDir);
    assert.strictEqual(result, null);
  });

  test('returns null when package.json has no the-seed build script', () => {
    const projectDir = path.join(tmpDir, 'non-seed');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({
        name: 'non-seed-project',
        scripts: { build: 'tsc' },
      })
    );
    fs.writeFileSync(path.join(projectDir, 'index.ts'), '');

    const result = detectBuildableProject(path.join(projectDir, 'index.ts'), tmpDir);
    assert.strictEqual(result, null);
  });

  test('does not search above workspace root', () => {
    // Place package.json above workspace root
    const workspaceRoot = path.join(tmpDir, 'workspace');
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'above-root',
        scripts: { build: 'the-seed build' },
      })
    );
    fs.writeFileSync(path.join(workspaceRoot, 'file.ts'), '');

    const result = detectBuildableProject(path.join(workspaceRoot, 'file.ts'), workspaceRoot);
    assert.strictEqual(result, null, 'Should not find package.json above workspace root');
  });

  test('handles package.json with no scripts field', () => {
    const projectDir = path.join(tmpDir, 'no-scripts');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ name: 'no-scripts' })
    );
    fs.writeFileSync(path.join(projectDir, 'file.ts'), '');

    const result = detectBuildableProject(path.join(projectDir, 'file.ts'), tmpDir);
    assert.strictEqual(result, null);
  });

  test('handles malformed package.json gracefully', () => {
    const projectDir = path.join(tmpDir, 'bad-json');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'package.json'), '{ invalid json }');
    fs.writeFileSync(path.join(projectDir, 'file.ts'), '');

    const result = detectBuildableProject(path.join(projectDir, 'file.ts'), tmpDir);
    assert.strictEqual(result, null);
  });
});
