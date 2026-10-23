import { defineConfig } from '@vscode/test-cli';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.dirname(fileURLToPath(import.meta.url));
const { selectTestFiles } = require(path.join(root, 'out', 'test', 'harness', 'results.js'));

// The runner (npm test) supplies a scratch home. When this file is used
// directly, make one so the developer's own home is never touched.
const home = process.env.THE_SEED_TEST_HOME || fs.mkdtempSync(path.join(os.tmpdir(), 'the-seed-vscode-tests-'));
const results = process.env.THE_SEED_TEST_RESULTS || path.join(root, 'test-results', 'host.json');

function listTests(dir) {
	const found = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			found.push(...listTests(full));
		} else if (entry.name.endsWith('.test.js')) {
			found.push(full);
		}
	}
	return found;
}

const all = [...listTests(path.join(root, 'out', 'test')), path.join(root, 'out', 'test', 'harness', 'rootHooks.js')];

// Keep the editor off any real desktop on Linux: x11 only (it runs under xvfb),
// so it cannot pick up a Wayland socket. THE_SEED_TEST_VISIBLE=1 opts out.
const launchArgs = process.platform === 'linux' && process.env.THE_SEED_TEST_VISIBLE !== '1' ? ['--ozone-platform=x11'] : [];

export default defineConfig({
	version: '1.143.0',
	launchArgs,
	files: selectTestFiles(
		all,
		{ only: process.env.THE_SEED_TEST_ONLY || undefined, order: process.env.THE_SEED_TEST_ORDER || undefined },
		root
	),
	env: {
		HOME: home,
		USERPROFILE: home,
		XDG_CONFIG_HOME: path.join(home, '.config'),
		THE_SEED_TEST_HOME: home,
		THE_SEED_TEST_RESULTS: results,
		...(process.env.THE_SEED_TEST_TOOL ? { THE_SEED_TEST_TOOL: process.env.THE_SEED_TEST_TOOL } : {}),
	},
	mocha: {
		ui: 'tdd',
		timeout: 10000,
		require: [path.join(root, 'out', 'test', 'harness', 'globalSetup.js')],
		reporter: path.join(root, 'out', 'test', 'harness', 'reporter.js'),
	},
});
