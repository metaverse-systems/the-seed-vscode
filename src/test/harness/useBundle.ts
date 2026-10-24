// Loaded by Mocha before every other file: makes each compiled host module the
// tests import (out/<key>.js) be the module inside dist/extension.js, the
// bundle the editor activates, so the tests and the extension share one
// instance of every module and the tested code is the shipped code.
// Node built-ins only.
import * as fs from 'fs';
import Module = require('module');
import * as path from 'path';

const root = path.resolve(__dirname, '..', '..', '..');

/** The bundle the tests run against. */
export const bundlePath = path.join(root, 'dist', 'extension.js');

// Compiled host files under out/ (outside out/test/ and out/webview/, whose
// page modules the tests load as compiled), relative to out/, forward
// slashes, no extension.
function listCompiledHostFiles(): string[] {
  const outRoot = path.join(root, 'out');
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(outRoot, full).split(path.sep).join('/');
      if (relative === 'test' || relative === 'webview') {
        continue;
      }
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.js')) {
        found.push(relative.slice(0, -'.js'.length));
      }
    }
  };
  walk(outRoot);
  return found.sort();
}

function loadBundle(): Record<string, unknown> {
  if (!fs.existsSync(bundlePath)) {
    throw new Error('the host bundle is missing: run "npm run bundle"');
  }
  const loaded = require(bundlePath) as { bundledModules?: unknown };
  if (typeof loaded.bundledModules !== 'object' || loaded.bundledModules === null) {
    throw new Error('dist/extension.js has no bundledModules: rebuild with "npm run bundle"');
  }
  return loaded.bundledModules as Record<string, unknown>;
}

const bundledModules = loadBundle();

/** The bundle's module keys, in the order the bundle lists them. */
export const keys: readonly string[] = Object.keys(bundledModules);

for (const key of keys) {
  const filename = path.join(root, 'out', ...key.split('/')) + '.js';
  const redirected = new Module(filename);
  redirected.filename = filename;
  redirected.loaded = true;
  redirected.exports = bundledModules[key];
  require.cache[filename] = redirected;
}

for (const compiled of listCompiledHostFiles()) {
  if (!keys.includes(compiled)) {
    throw new Error(`compiled module with no counterpart in the bundle: out/${compiled}.js (stale output? run "npm test" or "npm run build")`);
  }
}
