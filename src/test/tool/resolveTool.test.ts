import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { makeCommandShim, makeStubTool, useScratchDirs } from '../helpers/stubTool';

// The lookup is driven entirely by an injected environment: a scratch PATH, a scratch home, a fake
// `npm root -g`, a chosen platform and default roots that are empty or scratch directories. No case
// reads the real environment, the real global installation or a real default root.
interface LookupEnvironment {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  homedir: string;
  runNpmRoot(): Promise<string | undefined>;
  defaultRoots: string[];
}

interface ToolCandidate {
  packageDir: string;
  foundThrough: 'setting' | 'global' | 'path';
  detail: string;
  version: string | undefined;
  verdict: 'compatible' | 'tooOld' | 'tooNew' | 'unreadable';
}

interface LookupReport {
  looked: string[];
  candidates: ToolCandidate[];
  settingValue: string | undefined;
  settingProblem: string | undefined;
}

interface ResolveToolModule {
  findCandidates(setting: string | undefined, lookup: LookupEnvironment): Promise<LookupReport>;
}

const resolver = (): ResolveToolModule => require('../../tool/resolveTool') as ResolveToolModule;

suite('finding the tool', () => {
  const scratch = useScratchDirs();

  let home: string;
  let emptyBin: string;

  setup(() => {
    home = scratch.dir('home');
    emptyBin = scratch.dir('emptybin');
  });

  /** An environment in which nothing is found until a case adds something. */
  function lookup(overrides: Partial<LookupEnvironment> & { env?: Record<string, string | undefined> } = {}): LookupEnvironment {
    return {
      platform: process.platform === 'win32' ? 'linux' : process.platform,
      homedir: home,
      runNpmRoot: async () => undefined,
      defaultRoots: [],
      ...overrides,
      env: { PATH: emptyBin, ...(overrides.env ?? {}) },
    };
  }

  /** A global root holding a stub installation; returns the root and the package directory. */
  function globalRoot(version = '2.0.0', label = 'root'): { root: string; pkg: string } {
    const root = scratch.dir(label);
    const pkg = makeStubTool(path.join(root, '@metaverse-systems', 'the-seed'), { version });
    return { root, pkg };
  }

  const only = (report: LookupReport): ToolCandidate => {
    assert.strictEqual(report.candidates.length, 1, JSON.stringify(report.candidates));
    return report.candidates[0];
  };

  suite('the global installation', () => {
    test('is found through npm root -g', async () => {
      const { root, pkg } = globalRoot();
      const report = await resolver().findCandidates(undefined, lookup({ runNpmRoot: async () => root }));
      const found = only(report);
      assert.strictEqual(found.packageDir, pkg);
      assert.strictEqual(found.foundThrough, 'global');
      assert.strictEqual(found.version, '2.0.0');
      assert.strictEqual(found.verdict, 'compatible');
      assert.ok(found.detail.includes('npm root -g'), found.detail);
      assert.strictEqual(report.settingProblem, undefined);
    });

    test('is found when its bin directory is not on the path', async () => {
      const { root, pkg } = globalRoot();
      const report = await resolver().findCandidates(undefined, lookup({
        runNpmRoot: async () => root,
        env: { PATH: emptyBin },
      }));
      assert.strictEqual(only(report).packageDir, pkg);
      assert.strictEqual(only(report).foundThrough, 'global');
    });

    test('is found through NPM_CONFIG_PREFIX', async () => {
      const prefix = scratch.dir('prefix');
      const pkg = makeStubTool(path.join(prefix, 'lib', 'node_modules', '@metaverse-systems', 'the-seed'), { version: '2.1.0' });
      const report = await resolver().findCandidates(undefined, lookup({ env: { NPM_CONFIG_PREFIX: prefix } }));
      const found = only(report);
      assert.strictEqual(found.packageDir, pkg);
      assert.strictEqual(found.foundThrough, 'global');
      assert.ok(found.detail.includes('NPM_CONFIG_PREFIX'), found.detail);
    });

    test('is found through npm_config_prefix', async () => {
      const prefix = scratch.dir('prefix');
      const pkg = makeStubTool(path.join(prefix, 'lib', 'node_modules', '@metaverse-systems', 'the-seed'), { version: '2.0.0' });
      const report = await resolver().findCandidates(undefined, lookup({ env: { npm_config_prefix: prefix } }));
      assert.strictEqual(only(report).packageDir, pkg);
      assert.ok(/npm_config_prefix/i.test(only(report).detail), only(report).detail);
    });

    test('uses node_modules directly under the prefix on Windows', async () => {
      const prefix = scratch.dir('prefix');
      const pkg = makeStubTool(path.join(prefix, 'node_modules', '@metaverse-systems', 'the-seed'), { version: '2.0.0' });
      const report = await resolver().findCandidates(undefined, lookup({ platform: 'win32', env: { NPM_CONFIG_PREFIX: prefix } }));
      assert.strictEqual(only(report).packageDir, pkg);
    });

    test('is found through a prefix line in the .npmrc of the home directory, and nothing else of the file is kept', async () => {
      const prefix = scratch.dir('prefix');
      const pkg = makeStubTool(path.join(prefix, 'lib', 'node_modules', '@metaverse-systems', 'the-seed'), { version: '2.0.0' });
      fs.writeFileSync(path.join(home, '.npmrc'), [
        '//registry.npmjs.org/:_authToken=SECRET-TOKEN-0123',
        'registry=https://private.example.invalid/',
        `prefix=${prefix}`,
        'always-auth=true',
        '',
      ].join('\n'));
      const report = await resolver().findCandidates(undefined, lookup());
      const found = only(report);
      assert.strictEqual(found.packageDir, pkg);
      assert.ok(found.detail.includes('.npmrc'), found.detail);
      const everything = JSON.stringify(report);
      for (const secret of ['SECRET-TOKEN-0123', 'private.example.invalid', 'always-auth', '_authToken']) {
        assert.ok(!everything.includes(secret), `the report holds "${secret}"`);
      }
    });

    test('is found in a default root', async () => {
      const { root, pkg } = globalRoot('2.0.2', 'defaultroot');
      const report = await resolver().findCandidates(undefined, lookup({ defaultRoots: [root] }));
      const found = only(report);
      assert.strictEqual(found.packageDir, pkg);
      assert.strictEqual(found.foundThrough, 'global');
      assert.ok(found.detail.includes(root), found.detail);
    });

    test('is not found in a default root that the environment does not list', async () => {
      globalRoot('2.0.0', 'unlisted');
      const report = await resolver().findCandidates(undefined, lookup());
      assert.strictEqual(report.candidates.length, 0);
    });

    test('is found in a later root when npm root -g fails, or names an empty root', async () => {
      const { root, pkg } = globalRoot();
      const empty = scratch.dir('emptyroot');
      for (const run of [async () => undefined, async () => '', async () => empty]) {
        const report = await resolver().findCandidates(undefined, lookup({ runNpmRoot: run, defaultRoots: [root] }));
        assert.strictEqual(only(report).packageDir, pkg);
      }
    });

    test('the first root that holds the tool wins', async () => {
      const first = globalRoot('2.0.0', 'first');
      const second = globalRoot('2.5.0', 'second');
      const report = await resolver().findCandidates(undefined, lookup({
        runNpmRoot: async () => first.root,
        defaultRoots: [second.root],
      }));
      assert.strictEqual(only(report).packageDir, first.pkg);
    });

    test('a root that holds the package without a readable version still yields a candidate', async () => {
      const root = scratch.dir('badroot');
      const pkg = makeStubTool(path.join(root, '@metaverse-systems', 'the-seed'), { version: '2.0.0', packageJson: 'malformed' });
      const report = await resolver().findCandidates(undefined, lookup({ runNpmRoot: async () => root }));
      const found = only(report);
      assert.strictEqual(found.packageDir, pkg);
      assert.strictEqual(found.version, undefined);
      assert.strictEqual(found.verdict, 'unreadable');
    });

    test('an old and a new version are reported with their verdicts', async () => {
      const old = globalRoot('1.2.1', 'oldroot');
      assert.strictEqual(only(await resolver().findCandidates(undefined, lookup({ runNpmRoot: async () => old.root }))).verdict, 'tooOld');
      const newer = globalRoot('3.0.0', 'newroot');
      assert.strictEqual(only(await resolver().findCandidates(undefined, lookup({ runNpmRoot: async () => newer.root }))).verdict, 'tooNew');
    });
  });

  suite('the command on the path', () => {
    test('is found through a symbolic link', async function () {
      if (process.platform === 'win32') {
        this.skip();
      }
      const pkg = makeStubTool(scratch.dir('elsewhere'), { version: '2.0.0' });
      const bin = scratch.dir('bin');
      makeCommandShim(bin, pkg, 'symlink');
      const report = await resolver().findCandidates(undefined, lookup({ env: { PATH: bin } }));
      const found = only(report);
      assert.strictEqual(found.packageDir, pkg);
      assert.strictEqual(found.foundThrough, 'path');
      assert.ok(found.detail.includes(path.join(bin, 'the-seed')), found.detail);
    });

    test('is found through the shim layout with the package under <bin>/node_modules', async () => {
      const bin = scratch.dir('bin');
      makeCommandShim(bin, bin, 'shim');
      const pkg = makeStubTool(path.join(bin, 'node_modules', '@metaverse-systems', 'the-seed'), { version: '2.0.0' });
      const report = await resolver().findCandidates(undefined, lookup({ env: { PATH: bin } }));
      assert.strictEqual(only(report).packageDir, pkg);
      assert.strictEqual(only(report).foundThrough, 'path');
    });

    test('is found through the shim layout with the package under <bin>/../lib/node_modules', async () => {
      const prefix = scratch.dir('prefix');
      const bin = path.join(prefix, 'bin');
      makeCommandShim(bin, bin, 'shim');
      const pkg = makeStubTool(path.join(prefix, 'lib', 'node_modules', '@metaverse-systems', 'the-seed'), { version: '2.0.0' });
      const report = await resolver().findCandidates(undefined, lookup({ env: { PATH: bin } }));
      assert.strictEqual(only(report).packageDir, pkg);
    });

    test('uses the .cmd name on Windows', async () => {
      const bin = scratch.dir('bin');
      fs.writeFileSync(path.join(bin, 'the-seed.cmd'), '@ECHO off\r\n');
      const pkg = makeStubTool(path.join(bin, 'node_modules', '@metaverse-systems', 'the-seed'), { version: '2.0.0' });
      const report = await resolver().findCandidates(undefined, lookup({ platform: 'win32', env: { PATH: bin } }));
      assert.strictEqual(only(report).packageDir, pkg);
      assert.ok(only(report).detail.includes('the-seed.cmd'), only(report).detail);
    });

    test('a directory on the path without the command is skipped', async () => {
      const pkg = makeStubTool(scratch.dir('elsewhere'), { version: '2.0.0' });
      const bin = scratch.dir('bin');
      makeCommandShim(bin, pkg, 'symlink');
      const report = await resolver().findCandidates(undefined, lookup({ env: { PATH: [emptyBin, bin].join(path.delimiter) } }));
      assert.strictEqual(only(report).packageDir, pkg);
    });
  });

  suite('the setting', () => {
    test('is used alone: no other step runs', async () => {
      const mine = makeStubTool(scratch.dir('mine'), { version: '2.0.0' });
      let npmCalls = 0;
      const { root } = globalRoot();
      const report = await resolver().findCandidates(mine, lookup({
        runNpmRoot: async () => { npmCalls++; return root; },
        defaultRoots: [root],
      }));
      const found = only(report);
      assert.strictEqual(found.packageDir, mine);
      assert.strictEqual(found.foundThrough, 'setting');
      assert.strictEqual(npmCalls, 0);
      assert.strictEqual(report.settingValue, mine);
      assert.strictEqual(report.settingProblem, undefined);
    });

    test('wins over a global installation', async () => {
      const mine = makeStubTool(scratch.dir('mine'), { version: '2.2.0' });
      const { root } = globalRoot('2.0.0');
      const report = await resolver().findCandidates(mine, lookup({ runNpmRoot: async () => root }));
      assert.strictEqual(only(report).packageDir, mine);
      assert.strictEqual(only(report).version, '2.2.0');
    });

    test('may be the tool\'s command', async () => {
      const mine = makeStubTool(scratch.dir('mine'), { version: '2.0.0' });
      const report = await resolver().findCandidates(path.join(mine, 'dist', 'scripts', 'the-seed.js'), lookup());
      assert.strictEqual(only(report).packageDir, mine);
      assert.strictEqual(only(report).foundThrough, 'setting');
    });

    test('may be a link to the command', async function () {
      if (process.platform === 'win32') {
        this.skip();
      }
      const mine = makeStubTool(scratch.dir('mine'), { version: '2.0.0' });
      const bin = scratch.dir('bin');
      makeCommandShim(bin, mine, 'symlink');
      const report = await resolver().findCandidates(path.join(bin, 'the-seed'), lookup());
      assert.strictEqual(only(report).packageDir, mine);
    });

    test('may be a path inside the installation', async () => {
      const mine = makeStubTool(scratch.dir('mine'), { version: '2.0.0' });
      const report = await resolver().findCandidates(path.join(mine, 'dist'), lookup());
      assert.strictEqual(only(report).packageDir, mine);
    });

    test('may be written with a leading ~', async () => {
      const mine = makeStubTool(path.join(home, 'tools', 'the-seed'), { version: '2.0.0' });
      const report = await resolver().findCandidates('~/tools/the-seed', lookup());
      assert.strictEqual(only(report).packageDir, mine);
      assert.strictEqual(report.settingProblem, undefined);
    });

    test('is trimmed before it is used', async () => {
      const mine = makeStubTool(scratch.dir('mine'), { version: '2.0.0' });
      const report = await resolver().findCandidates(`  ${mine}  `, lookup());
      assert.strictEqual(only(report).packageDir, mine);
    });

    test('that is empty or only blanks leaves the default lookup in charge', async () => {
      const { root, pkg } = globalRoot();
      for (const setting of ['', '   ', undefined]) {
        const report = await resolver().findCandidates(setting, lookup({ runNpmRoot: async () => root }));
        assert.strictEqual(only(report).packageDir, pkg);
        assert.strictEqual(only(report).foundThrough, 'global');
      }
    });

    test('that is not absolute is a problem naming the rule', async () => {
      const report = await resolver().findCandidates('relative/the-seed', lookup());
      assert.strictEqual(report.candidates.length, 0);
      assert.ok(report.settingProblem?.includes('the path must be absolute'), report.settingProblem);
      assert.strictEqual(report.settingValue, 'relative/the-seed');
    });

    test('that does not exist is a problem', async () => {
      const missing = path.join(scratch.dir('parent'), 'nothing-here');
      const report = await resolver().findCandidates(missing, lookup());
      assert.strictEqual(report.candidates.length, 0);
      assert.ok(report.settingProblem?.includes('does not exist'), report.settingProblem);
    });

    test('that is a file other than the command is a problem', async () => {
      const dir = scratch.dir('plain');
      const file = path.join(dir, 'notes.txt');
      fs.writeFileSync(file, 'not the command');
      const report = await resolver().findCandidates(file, lookup());
      assert.strictEqual(report.candidates.length, 0);
      assert.ok(report.settingProblem?.includes('package.json'), report.settingProblem);
    });

    test('that has no package.json in or above it is a problem', async () => {
      const report = await resolver().findCandidates(scratch.dir('bare'), lookup());
      assert.strictEqual(report.candidates.length, 0);
      assert.ok(report.settingProblem?.includes('no package.json in or above it'), report.settingProblem);
    });

    test('that is inside another package names that package, and the walk stops there', async () => {
      const outer = makeStubTool(scratch.dir('outer'), { version: '2.0.0' });
      const inner = path.join(outer, 'node_modules', 'other-package');
      fs.mkdirSync(inner, { recursive: true });
      fs.writeFileSync(path.join(inner, 'package.json'), JSON.stringify({ name: 'other-package', version: '1.0.0' }));
      const report = await resolver().findCandidates(inner, lookup());
      assert.strictEqual(report.candidates.length, 0);
      assert.ok(report.settingProblem?.includes('it is the package other-package'), report.settingProblem);
    });

    test('that names a package with the wrong name is a problem even when it is the nearest', async () => {
      const dir = makeStubTool(scratch.dir('wrongname'), { version: '2.0.0', name: 'something-else' });
      const report = await resolver().findCandidates(dir, lookup());
      assert.strictEqual(report.candidates.length, 0);
      assert.ok(report.settingProblem?.includes('it is the package something-else'), report.settingProblem);
    });
  });

  suite('when nothing is found', () => {
    test('every place tried is listed', async () => {
      const prefix = scratch.dir('prefix');
      const defaultRoot = scratch.dir('defaultroot');
      const npmRoot = scratch.dir('npmroot');
      const bin = scratch.dir('bin');
      const report = await resolver().findCandidates(undefined, lookup({
        runNpmRoot: async () => npmRoot,
        env: { NPM_CONFIG_PREFIX: prefix, PATH: bin },
        defaultRoots: [defaultRoot],
      }));
      assert.strictEqual(report.candidates.length, 0);
      assert.strictEqual(report.settingProblem, undefined);
      const looked = report.looked.join('\n');
      for (const place of [npmRoot, prefix, defaultRoot, bin]) {
        assert.ok(looked.includes(place), `"${place}" is not in:\n${looked}`);
      }
      assert.ok(looked.includes('the-seed'), looked);
    });

    test('with no npm and no prefix, the list says why there is no global root to look in', async () => {
      const report = await resolver().findCandidates(undefined, lookup());
      assert.strictEqual(report.candidates.length, 0);
      assert.ok(
        report.looked.some((line) => line.includes('global installation: npm could not be run and no npm prefix is configured')),
        report.looked.join('\n'),
      );
    });
  });

  suite('several candidates', () => {
    test('both are reported in lookup order when the first is incompatible', async function () {
      if (process.platform === 'win32') {
        this.skip();
      }
      const old = globalRoot('1.2.1', 'oldroot');
      const newer = makeStubTool(scratch.dir('newer'), { version: '2.1.0' });
      const bin = scratch.dir('bin');
      makeCommandShim(bin, newer, 'symlink');
      const report = await resolver().findCandidates(undefined, lookup({ runNpmRoot: async () => old.root, env: { PATH: bin } }));
      assert.strictEqual(report.candidates.length, 2);
      assert.strictEqual(report.candidates[0].packageDir, old.pkg);
      assert.strictEqual(report.candidates[0].foundThrough, 'global');
      assert.strictEqual(report.candidates[0].verdict, 'tooOld');
      assert.strictEqual(report.candidates[1].packageDir, newer);
      assert.strictEqual(report.candidates[1].foundThrough, 'path');
      assert.strictEqual(report.candidates[1].verdict, 'compatible');
    });

    test('the same installation found twice is one candidate, keeping the first way it was found', async function () {
      if (process.platform === 'win32') {
        this.skip();
      }
      const { root, pkg } = globalRoot();
      const bin = scratch.dir('bin');
      makeCommandShim(bin, pkg, 'symlink');
      const report = await resolver().findCandidates(undefined, lookup({ runNpmRoot: async () => root, env: { PATH: bin } }));
      const found = only(report);
      assert.strictEqual(found.packageDir, pkg);
      assert.strictEqual(found.foundThrough, 'global');
    });

    test('a root reached through a symbolic link and the real root are one candidate with the real path', async function () {
      if (process.platform === 'win32') {
        this.skip();
      }
      const { root, pkg } = globalRoot();
      const holder = scratch.dir('holder');
      const link = path.join(holder, 'linkedroot');
      fs.symlinkSync(root, link);
      const report = await resolver().findCandidates(undefined, lookup({ runNpmRoot: async () => link, defaultRoots: [root] }));
      assert.strictEqual(only(report).packageDir, pkg);
    });
  });
});
