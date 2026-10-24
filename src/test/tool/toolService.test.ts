import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { makeStubTool, useScratchDirs } from '../helpers/stubTool';
import { activeToolService } from '../../tool/toolService';
import { withToolSetting } from '../helpers/tool';

// The service is built over an injected lookup environment, setting reader, loader and notifier, so no
// case reads the real environment, the real setting or the developer's installation. The modules under
// test are loaded when a case runs.
type State = 'checking' | 'usable' | 'notFound' | 'notTheTool' | 'tooOld' | 'tooNew' | 'notLoadable' | 'reloadRequired';
type Through = 'setting' | 'global' | 'path';

interface LookupEnvironment {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  homedir: string;
  runNpmRoot(): Promise<string | undefined>;
  defaultRoots: string[];
}

interface ToolCandidate {
  packageDir: string;
  foundThrough: Through;
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

interface ToolStatus {
  state: State;
  installation: ToolCandidate | undefined;
  others: ToolCandidate[];
  report: LookupReport;
  loadError: string | undefined;
  previousVersion: string | undefined;
  message: string;
  key: string;
}

type ToolApiLike = Record<string, unknown>;
type Acquired = { ok: true; api: ToolApiLike; installation: ToolCandidate } | { ok: false; status: ToolStatus };
type Reason = 'activate' | 'setting' | 'checkAgain' | 'operation';

interface ToolNotifier {
  showNotice(status: ToolStatus): Promise<void> | void;
  showRefusal(status: ToolStatus): Promise<void> | void;
}

interface ToolServiceDeps {
  lookup: LookupEnvironment;
  readSetting(): string | undefined;
  load(packageDir: string): ToolApiLike;
  notifier: ToolNotifier;
}

interface ToolServiceLike {
  readonly status: ToolStatus;
  check(reason: Reason): Promise<ToolStatus>;
  acquire(): Promise<Acquired>;
  whenChecked(): Promise<ToolStatus>;
  watchSetting(onDidChangeConfiguration: vscode.Event<vscode.ConfigurationChangeEvent>): vscode.Disposable;
  showRefusal(status: ToolStatus): Promise<void> | void;
  onDidChangeStatus: vscode.Event<ToolStatus>;
  dispose(): void;
}

interface ToolServiceModule {
  ToolService: new (deps: ToolServiceDeps) => ToolServiceLike;
  createVscodeNotifier(checkAgain: () => unknown): ToolNotifier;
}
interface ToolStatusModule { describeToolStatus(status: ToolStatus): string }
interface LoadToolModule { loadInstallation(packageDir: string): ToolApiLike }
interface RequiredVersionModule { INSTALL_COMMAND: string; SUPPORTED_RANGE_TEXT: string; TOOL_SETTING: string }

const serviceModule = (): ToolServiceModule => require('../../tool/toolService') as ToolServiceModule;
const statusModule = (): ToolStatusModule => require('../../tool/toolStatus') as ToolStatusModule;
const loadModule = (): LoadToolModule => require('../../tool/loadTool') as LoadToolModule;
const versionModule = (): RequiredVersionModule => require('../../tool/requiredVersion') as RequiredVersionModule;

class RecordingNotifier implements ToolNotifier {
  notices: ToolStatus[] = [];
  refusals: ToolStatus[] = [];
  showNotice(status: ToolStatus): void { this.notices.push(status); }
  showRefusal(status: ToolStatus): void { this.refusals.push(status); }
}

const candidate = (overrides: Partial<ToolCandidate> = {}): ToolCandidate => ({
  packageDir: '/opt/node/lib/node_modules/@metaverse-systems/the-seed',
  foundThrough: 'global',
  detail: 'npm root -g',
  version: '2.1.0',
  verdict: 'compatible',
  ...overrides,
});

const report = (overrides: Partial<LookupReport> = {}): LookupReport => ({
  looked: ['npm root -g: /usr/local/lib/node_modules (no the-seed there)', 'the-seed command on the path: not found'],
  candidates: [],
  settingValue: undefined,
  settingProblem: undefined,
  ...overrides,
});

const statusOf = (state: State, overrides: Partial<ToolStatus> = {}): ToolStatus => ({
  state,
  installation: undefined,
  others: [],
  report: report(),
  loadError: undefined,
  previousVersion: undefined,
  message: '',
  key: '',
  ...overrides,
});

suite('tool status messages', () => {
  const describe = (status: ToolStatus): string => statusModule().describeToolStatus(status);

  function includesAll(text: string, parts: string[]): void {
    for (const part of parts) {
      assert.ok(text.includes(part), `"${part}" is not in: ${text}`);
    }
  }

  test('usable says what is in use, where and how it was found', () => {
    const text = describe(statusOf('usable', { installation: candidate() }));
    includesAll(text, ['2.1.0', '/opt/node/lib/node_modules/@metaverse-systems/the-seed', 'global installation']);
  });

  test('usable through the setting and through the path name that way', () => {
    includesAll(describe(statusOf('usable', { installation: candidate({ foundThrough: 'setting', detail: '/x/the-seed' }) })), ['the-seed.toolPath']);
    includesAll(describe(statusOf('usable', { installation: candidate({ foundThrough: 'path', detail: '/usr/bin/the-seed' }) })), ['/usr/bin/the-seed']);
  });

  test('notFound lists what was looked at, the supported versions, the install command and the setting', () => {
    const text = describe(statusOf('notFound'));
    includesAll(text, [
      'not found',
      'npm root -g: /usr/local/lib/node_modules (no the-seed there)',
      'the-seed command on the path: not found',
      versionModule().SUPPORTED_RANGE_TEXT,
      versionModule().INSTALL_COMMAND,
      'the-seed.toolPath',
    ]);
  });

  test('notFound with no global root to look in says so and points to the setting', () => {
    const text = describe(statusOf('notFound', {
      report: report({ looked: ['global installation: npm could not be run and no npm prefix is configured', 'the-seed command on the path: not found'] }),
    }));
    includesAll(text, ['global installation: npm could not be run and no npm prefix is configured', 'the-seed.toolPath', versionModule().INSTALL_COMMAND]);
  });

  test('notTheTool names the setting value, the reason, the supported versions and the install command', () => {
    const text = describe(statusOf('notTheTool', {
      report: report({ settingValue: '/somewhere/else', settingProblem: 'it is the package other-package' }),
    }));
    includesAll(text, [
      'the-seed.toolPath',
      '/somewhere/else',
      'it is the package other-package',
      '2.1.0',
      versionModule().INSTALL_COMMAND,
    ]);
  });

  test('tooOld gives the location, how it was found, the version found, the supported versions and the install command', () => {
    const text = describe(statusOf('tooOld', { installation: candidate({ version: '1.2.1', verdict: 'tooOld' }) }));
    includesAll(text, [
      '/opt/node/lib/node_modules/@metaverse-systems/the-seed',
      'global installation',
      '1.2.1',
      versionModule().SUPPORTED_RANGE_TEXT,
      versionModule().INSTALL_COMMAND,
    ]);
  });

  test('tooNew gives the location, the version found, the supported range and the install command', () => {
    const text = describe(statusOf('tooNew', { installation: candidate({ version: '3.1.0', verdict: 'tooNew' }) }));
    includesAll(text, ['/opt/node/lib/node_modules/@metaverse-systems/the-seed', '3.1.0', '2.x', versionModule().INSTALL_COMMAND]);
  });

  test('notLoadable gives the location, the version, the first line of the error and the install command', () => {
    const text = describe(statusOf('notLoadable', {
      installation: candidate({ version: '2.0.3' }),
      loadError: 'Cannot find module \'tslib\'',
    }));
    includesAll(text, ['/opt/node/lib/node_modules/@metaverse-systems/the-seed', '2.0.3', 'Cannot find module \'tslib\'', versionModule().INSTALL_COMMAND]);
  });

  test('notLoadable without a readable version says the version is unknown', () => {
    const text = describe(statusOf('notLoadable', { installation: candidate({ version: undefined, verdict: 'unreadable' }), loadError: 'unreadable' }));
    includesAll(text, ['unknown']);
  });

  test('reloadRequired gives the location, both versions and the supported versions', () => {
    const text = describe(statusOf('reloadRequired', {
      installation: candidate({ version: '2.1.1' }),
      previousVersion: '2.1.0',
    }));
    includesAll(text, ['/opt/node/lib/node_modules/@metaverse-systems/the-seed', '2.1.0', '2.1.1', 'Reload', versionModule().SUPPORTED_RANGE_TEXT]);
  });

  test('reloadRequired for a package that can no longer be read says so', () => {
    const text = describe(statusOf('reloadRequired', { installation: candidate({ version: undefined, verdict: 'unreadable' }), previousVersion: '2.1.0' }));
    includesAll(text, ['2.1.0', 'unreadable']);
  });

  suite('also found', () => {
    const better = candidate({ packageDir: '/home/me/the-seed', foundThrough: 'path', detail: '/home/me/bin/the-seed', version: '2.4.0', verdict: 'compatible' });
    const second = candidate({ packageDir: '/home/me/other-the-seed', foundThrough: 'path', detail: '/home/me/other/the-seed', version: '2.9.0', verdict: 'compatible' });
    const unusable = candidate({ packageDir: '/home/me/ancient', foundThrough: 'path', version: '0.9.0', verdict: 'tooOld' });
    const states: State[] = ['tooOld', 'tooNew', 'notLoadable'];

    for (const state of states) {
      test(`${state} with the setting empty names the first compatible other candidate and how to use it`, () => {
        const text = describe(statusOf(state, {
          installation: candidate({ version: state === 'tooNew' ? '3.0.0' : '1.0.0', verdict: state === 'tooNew' ? 'tooNew' : 'tooOld' }),
          loadError: 'broken',
          others: [unusable, better, second],
        }));
        includesAll(text, ['Also found', '2.4.0', '/home/me/the-seed', 'the-seed.toolPath']);
        assert.ok(!text.includes('2.9.0') && !text.includes('/home/me/other-the-seed'), `only the first compatible one is named: ${text}`);
        assert.ok(!text.includes('/home/me/ancient'), `an incompatible one is not named: ${text}`);
      });
    }

    test('nothing is added when no other candidate is compatible', () => {
      const text = describe(statusOf('tooOld', { installation: candidate({ version: '1.0.0', verdict: 'tooOld' }), others: [unusable] }));
      assert.ok(!text.includes('Also found'), text);
    });

    test('nothing is added when the setting is set', () => {
      const text = describe(statusOf('tooOld', {
        installation: candidate({ foundThrough: 'setting', version: '1.0.0', verdict: 'tooOld' }),
        report: report({ settingValue: '/x/the-seed' }),
        others: [better],
      }));
      assert.ok(!text.includes('Also found'), text);
    });
  });

  test('no message holds anything but the prefix from an .npmrc', () => {
    const text = describe(statusOf('notFound', { report: report({ looked: ['~/.npmrc prefix: /home/me/.npm-global (no the-seed there)'] }) }));
    assert.ok(!text.includes('_authToken'), text);
  });
});

suite('tool service', () => {
  const scratch = useScratchDirs();

  interface World {
    root: string;
    home: string;
    setting: string;
    npmCalls: number;
    notifier: RecordingNotifier;
    services: ToolServiceLike[];
  }

  let world: World;

  setup(() => {
    world = {
      root: scratch.dir('root'),
      home: scratch.dir('home'),
      setting: '',
      npmCalls: 0,
      notifier: new RecordingNotifier(),
      services: [],
    };
  });

  teardown(() => {
    for (const service of world.services) {
      service.dispose();
    }
    sinon.restore();
  });

  const emptyBin = (): string => scratch.dir('bin');

  function makeService(options: { runNpmRoot?: () => Promise<string | undefined>; load?: (dir: string) => ToolApiLike; env?: Record<string, string | undefined> } = {}): ToolServiceLike {
    const bin = emptyBin();
    const lookup: LookupEnvironment = {
      platform: process.platform === 'win32' ? 'linux' : process.platform,
      env: { PATH: bin, ...(options.env ?? {}) },
      homedir: world.home,
      runNpmRoot: options.runNpmRoot ?? (async () => {
        world.npmCalls++;
        return world.root;
      }),
      defaultRoots: [],
    };
    const service = new (serviceModule().ToolService)({
      lookup,
      readSetting: () => world.setting,
      load: options.load ?? ((dir: string) => loadModule().loadInstallation(dir)),
      notifier: world.notifier,
    });
    world.services.push(service);
    return service;
  }

  /** Places a stub at the global root, replacing any there. */
  function installGlobal(version: string, options: { packageJson?: 'malformed' | 'noVersion'; throwOnLoad?: string; root?: string } = {}): string {
    const dir = path.join(options.root ?? world.root, '@metaverse-systems', 'the-seed');
    fs.rmSync(dir, { recursive: true, force: true });
    return makeStubTool(dir, { version, packageJson: options.packageJson, throwOnLoad: options.throwOnLoad });
  }

  suite('the first check', () => {
    test('starts as checking, and whenChecked resolves once the first check is done', async () => {
      installGlobal('2.1.0');
      const service = makeService();
      assert.strictEqual(service.status.state, 'checking');
      let settled = false;
      const waiting = service.whenChecked().then((status) => { settled = true; return status; });
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.strictEqual(settled, false, 'whenChecked resolved before any check');
      const checked = await service.check('activate');
      const waited = await waiting;
      assert.strictEqual(waited.state, 'usable');
      assert.strictEqual(waited.key, checked.key);
      assert.strictEqual(service.status.state, 'usable');
    });

    test('usable: the global installation, with its version and how it was found', async () => {
      const pkg = installGlobal('2.1.0');
      const service = makeService();
      const status = await service.check('activate');
      assert.strictEqual(status.state, 'usable');
      assert.strictEqual(status.installation?.packageDir, pkg);
      assert.strictEqual(status.installation?.version, '2.1.0');
      assert.strictEqual(status.installation?.foundThrough, 'global');
      assert.strictEqual(status.key, `usable|${pkg}|2.1.0`);
      assert.ok(status.message.includes('2.1.0') && status.message.includes(pkg), status.message);
    });

    test('notFound: nothing installed', async () => {
      const status = await makeService().check('activate');
      assert.strictEqual(status.state, 'notFound');
      assert.strictEqual(status.installation, undefined);
      assert.ok(status.message.includes(versionModule().INSTALL_COMMAND), status.message);
    });

    test('notFound with no npm and no prefix says there was no global root to look in', async () => {
      const status = await makeService({ runNpmRoot: async () => undefined }).check('activate');
      assert.strictEqual(status.state, 'notFound');
      assert.ok(status.message.includes('global installation: npm could not be run and no npm prefix is configured'), status.message);
    });

    test('notTheTool: the setting names a path that is not the tool', async () => {
      world.setting = path.join(scratch.dir('parent'), 'missing');
      const status = await makeService().check('activate');
      assert.strictEqual(status.state, 'notTheTool');
      assert.ok(status.message.includes(world.setting), status.message);
      assert.ok(status.message.includes('does not exist'), status.message);
    });

    test('tooOld, with the location and version in the status', async () => {
      const pkg = installGlobal('1.2.1');
      const status = await makeService().check('activate');
      assert.strictEqual(status.state, 'tooOld');
      assert.strictEqual(status.installation?.packageDir, pkg);
      assert.ok(status.message.includes('1.2.1') && status.message.includes(pkg), status.message);
    });

    test('tooNew', async () => {
      installGlobal('3.0.0');
      const status = await makeService().check('activate');
      assert.strictEqual(status.state, 'tooNew');
      assert.ok(status.message.includes('3.0.0'), status.message);
    });

    test('notLoadable: a module that throws, with the first line of its error', async () => {
      installGlobal('2.1.0', { throwOnLoad: 'Config' });
      const status = await makeService().check('activate');
      assert.strictEqual(status.state, 'notLoadable');
      assert.strictEqual(status.loadError, 'stub module failed to start: Config');
      assert.ok(status.message.includes('stub module failed to start: Config'), status.message);
    });

    test('notLoadable: a package.json that is not JSON, naming the location', async () => {
      const pkg = installGlobal('2.1.0', { packageJson: 'malformed' });
      const status = await makeService().check('activate');
      assert.strictEqual(status.state, 'notLoadable');
      assert.ok(status.message.includes(pkg), status.message);
    });

    test('notLoadable: a package.json without a version, naming the location', async () => {
      const pkg = installGlobal('2.1.0', { packageJson: 'noVersion' });
      const status = await makeService().check('activate');
      assert.strictEqual(status.state, 'notLoadable');
      assert.ok(status.message.includes(pkg), status.message);
    });

    test('an incompatible version is never loaded', async () => {
      installGlobal('1.2.1', { throwOnLoad: 'Config' });
      let loads = 0;
      const status = await makeService({ load: (dir) => { loads++; return loadModule().loadInstallation(dir); } }).check('activate');
      assert.strictEqual(status.state, 'tooOld');
      assert.strictEqual(loads, 0);
    });
  });

  suite('check never rejects', () => {
    test('a lookup that throws gives an unusable status', async () => {
      const service = makeService({ runNpmRoot: () => { throw new Error('lookup exploded'); } });
      const status = await service.check('activate');
      assert.notStrictEqual(status.state, 'usable');
      assert.notStrictEqual(status.state, 'checking');
    });

    test('a lookup that rejects gives an unusable status', async () => {
      const service = makeService({ runNpmRoot: () => Promise.reject(new Error('lookup rejected')) });
      const status = await service.check('setting');
      assert.notStrictEqual(status.state, 'usable');
      assert.notStrictEqual(status.state, 'checking');
    });

    test('a loader that throws something that is not an error gives notLoadable', async () => {
      installGlobal('2.1.0');
      const service = makeService({
        load: () => {
          // eslint-disable-next-line no-throw-literal
          throw 'plain text';
        },
      });
      const status = await service.check('activate');
      assert.strictEqual(status.state, 'notLoadable');
    });

    test('a loader that throws an error gives notLoadable with the first line', async () => {
      installGlobal('2.1.0');
      const service = makeService({ load: () => { throw new Error('loader exploded\nand more'); } });
      const status = await service.check('activate');
      assert.strictEqual(status.state, 'notLoadable');
      assert.strictEqual(status.loadError, 'loader exploded');
    });

    test('a notifier that throws does not make the check reject', async () => {
      world.notifier.showNotice = () => { throw new Error('notifier exploded'); };
      const status = await makeService().check('activate');
      assert.strictEqual(status.state, 'notFound');
    });
  });

  suite('acquire', () => {
    test('with a usable tool returns its API after reading only the version in use', async () => {
      installGlobal('2.1.0');
      const service = makeService();
      await service.check('activate');
      const callsAfterCheck = world.npmCalls;
      const first = await service.acquire();
      const second = await service.acquire();
      assert.ok(first.ok && second.ok);
      if (first.ok && second.ok) {
        assert.strictEqual(first.api, second.api);
        assert.ok(Object.isFrozen(first.api));
        assert.strictEqual(first.installation.version, '2.1.0');
      }
      assert.strictEqual(world.npmCalls, callsAfterCheck, 'acquire ran the lookup again');
    });

    test('a version that changed in place gives reloadRequired with both versions', async () => {
      const pkg = installGlobal('2.1.0');
      const service = makeService();
      await service.check('activate');
      fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@metaverse-systems/the-seed', version: '2.1.1' }));
      const result = await service.acquire();
      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.status.state, 'reloadRequired');
        assert.strictEqual(result.status.previousVersion, '2.1.0');
        assert.strictEqual(result.status.installation?.version, '2.1.1');
        assert.ok(result.status.message.includes('2.1.0') && result.status.message.includes('2.1.1'), result.status.message);
        assert.ok(result.status.message.includes(pkg), result.status.message);
      }
      assert.strictEqual(service.status.state, 'reloadRequired');
    });

    test('a package.json that can no longer be read gives reloadRequired', async () => {
      const pkg = installGlobal('2.1.0');
      const service = makeService();
      await service.check('activate');
      fs.rmSync(path.join(pkg, 'package.json'));
      const result = await service.acquire();
      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.status.state, 'reloadRequired');
        assert.strictEqual(result.status.previousVersion, '2.1.0');
      }
    });

    test('reloadRequired is kept by a check that resolves to the same directory at another version', async () => {
      const pkg = installGlobal('2.1.0');
      const service = makeService();
      await service.check('activate');
      fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@metaverse-systems/the-seed', version: '2.1.1' }));
      await service.acquire();
      const status = await service.check('checkAgain');
      assert.strictEqual(status.state, 'reloadRequired');
      assert.strictEqual(status.previousVersion, '2.1.0');
    });

    test('reloadRequired is left by a check that resolves to the version already loaded', async () => {
      const pkg = installGlobal('2.1.0');
      const service = makeService();
      const first = await service.acquire();
      assert.ok(first.ok);
      const manifest = path.join(pkg, 'package.json');
      const original = fs.readFileSync(manifest, 'utf8');
      fs.writeFileSync(manifest, JSON.stringify({ name: '@metaverse-systems/the-seed', version: '2.1.1' }));
      assert.strictEqual((await service.acquire()).ok, false);
      fs.writeFileSync(manifest, original);
      const status = await service.check('checkAgain');
      assert.strictEqual(status.state, 'usable');
      const again = await service.acquire();
      assert.ok(again.ok);
      if (first.ok && again.ok) {
        assert.strictEqual(again.api, first.api);
      }
    });

    test('reloadRequired is left by a check that resolves to another directory', async () => {
      const pkg = installGlobal('2.1.0');
      const service = makeService();
      await service.check('activate');
      fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@metaverse-systems/the-seed', version: '2.1.1' }));
      await service.acquire();
      const other = makeStubTool(scratch.dir('other'), { version: '2.1.1' });
      world.setting = other;
      const status = await service.check('setting');
      assert.strictEqual(status.state, 'usable');
      assert.strictEqual(status.installation?.packageDir, other);
    });

    test('while unusable runs a full check and succeeds once a tool is where the lookup looks', async () => {
      const service = makeService();
      const refused = await service.acquire();
      assert.strictEqual(refused.ok, false);
      if (!refused.ok) {
        assert.strictEqual(refused.status.state, 'notFound');
      }
      installGlobal('2.1.0');
      const accepted = await service.acquire();
      assert.ok(accepted.ok, 'the tool placed after the refusal was not found');
      assert.strictEqual(service.status.state, 'usable');
    });

    test('while unusable it recovers from every unusable state without a restart', async () => {
      const service = makeService();
      installGlobal('1.2.1');
      assert.strictEqual((await service.acquire()).ok, false);
      installGlobal('3.0.0');
      assert.strictEqual((await service.acquire()).ok, false);
      assert.strictEqual(service.status.state, 'tooNew');
      installGlobal('2.1.0', { throwOnLoad: 'Template' });
      assert.strictEqual((await service.acquire()).ok, false);
      assert.strictEqual(service.status.state, 'notLoadable');
      installGlobal('2.1.0');
      assert.strictEqual((await service.acquire()).ok, true);
    });

    test('a refusal calls no tool code: nothing is loaded for an unusable tool', async () => {
      installGlobal('1.2.1');
      let loads = 0;
      const service = makeService({ load: (dir) => { loads++; return loadModule().loadInstallation(dir); } });
      assert.strictEqual((await service.acquire()).ok, false);
      assert.strictEqual(loads, 0);
    });
  });

  suite('checks', () => {
    test('concurrent checks share the one in flight', async () => {
      installGlobal('2.1.0');
      let calls = 0;
      const service = makeService({
        runNpmRoot: async () => {
          calls++;
          await new Promise((resolve) => setTimeout(resolve, 30));
          return world.root;
        },
      });
      const [a, b, c] = await Promise.all([service.check('setting'), service.check('checkAgain'), service.acquire()]);
      assert.strictEqual(calls, 1);
      assert.strictEqual(a, b);
      assert.strictEqual(a.state, 'usable');
      assert.ok(c.ok);
    });

    test('a check requested after the one in flight finished runs again', async () => {
      installGlobal('2.1.0');
      const service = makeService();
      await service.check('activate');
      const before = world.npmCalls;
      await service.check('setting');
      assert.strictEqual(world.npmCalls, before + 1);
    });

    test('a full check recomputes from scratch', async () => {
      const service = makeService();
      assert.strictEqual((await service.check('activate')).state, 'notFound');
      installGlobal('2.1.0');
      assert.strictEqual((await service.check('checkAgain')).state, 'usable');
      fs.rmSync(path.join(world.root, '@metaverse-systems'), { recursive: true });
      assert.strictEqual((await service.check('checkAgain')).state, 'notFound');
    });

    test('onDidChangeStatus fires only when the key changes', async () => {
      const pkg = installGlobal('2.1.0');
      const service = makeService();
      const seen: ToolStatus[] = [];
      service.onDidChangeStatus((status) => seen.push(status));
      await service.check('activate');
      assert.deepStrictEqual(seen.map((status) => status.state), ['usable']);
      await service.check('checkAgain');
      await service.check('setting');
      assert.strictEqual(seen.length, 1, 'a check that changed nothing fired the event');
      fs.rmSync(pkg, { recursive: true });
      await service.check('checkAgain');
      assert.deepStrictEqual(seen.map((status) => status.state), ['usable', 'notFound']);
      installGlobal('1.2.1');
      await service.check('checkAgain');
      installGlobal('1.2.2');
      await service.check('checkAgain');
      assert.deepStrictEqual(seen.map((status) => status.state), ['usable', 'notFound', 'tooOld', 'tooOld']);
    });

    test('a full check that resolves to another directory loads a fresh copy, and switching back reuses the first', async () => {
      installGlobal('2.1.0');
      const second = makeStubTool(scratch.dir('second'), { version: '2.1.0' });
      const service = makeService();
      const first = await service.acquire();
      assert.ok(first.ok);

      world.setting = second;
      await service.check('setting');
      const switched = await service.acquire();
      assert.ok(switched.ok);

      world.setting = '';
      await service.check('setting');
      const back = await service.acquire();
      assert.ok(back.ok);

      if (first.ok && switched.ok && back.ok) {
        assert.notStrictEqual(switched.api, first.api);
        assert.notStrictEqual(switched.api.Config, first.api.Config);
        assert.strictEqual(back.api, first.api);
        assert.strictEqual(switched.installation.packageDir, second);
      }
    });

    test('the setting alone decides when it is set: the global installation is not consulted', async () => {
      installGlobal('2.1.0');
      const mine = makeStubTool(scratch.dir('mine'), { version: '2.3.0' });
      world.setting = mine;
      const service = makeService();
      const status = await service.check('activate');
      assert.strictEqual(status.state, 'usable');
      assert.strictEqual(status.installation?.foundThrough, 'setting');
      assert.strictEqual(world.npmCalls, 0);
    });
  });

  suite('the setting', () => {
    let changes: vscode.EventEmitter<vscode.ConfigurationChangeEvent>;

    setup(() => {
      changes = new vscode.EventEmitter<vscode.ConfigurationChangeEvent>();
    });

    teardown(() => {
      changes.dispose();
    });

    const changeOf = (...affected: string[]): vscode.ConfigurationChangeEvent => ({
      affectsConfiguration: (section: string) => affected.some((name) => name === section || name.startsWith(`${section}.`)),
    });

    /** Fires the change and returns the check it started, when it started one. */
    function fire(service: ToolServiceLike, ...affected: string[]): { started: Promise<ToolStatus>[] } {
      const spy = sinon.spy(service, 'check');
      changes.fire(changeOf(...affected));
      const started = spy.getCalls().map((call) => {
        assert.strictEqual(call.args[0], 'setting');
        return call.returnValue as Promise<ToolStatus>;
      });
      spy.restore();
      return { started };
    }

    test('a change of the tool path rechecks, and the next acquire uses the new installation', async () => {
      installGlobal('2.1.0');
      const service = makeService();
      service.watchSetting(changes.event);
      const first = await service.acquire();
      assert.ok(first.ok);
      if (first.ok) {
        assert.strictEqual(first.installation.foundThrough, 'global');
      }

      const mine = makeStubTool(scratch.dir('mine'), { version: '2.3.0' });
      world.setting = mine;
      const { started } = fire(service, 'the-seed.toolPath');
      assert.strictEqual(started.length, 1, 'the change did not start a check');
      assert.strictEqual((await started[0]).state, 'usable');

      const next = await service.acquire();
      assert.ok(next.ok);
      if (next.ok && first.ok) {
        assert.strictEqual(next.installation.packageDir, mine);
        assert.strictEqual(next.installation.foundThrough, 'setting');
        assert.strictEqual(next.installation.version, '2.3.0');
        assert.notStrictEqual(next.api, first.api);
      }
    });

    test('a setting naming a compatible installation wins over the global one', async () => {
      installGlobal('2.1.0');
      const mine = makeStubTool(scratch.dir('mine'), { version: '2.1.0' });
      const service = makeService();
      service.watchSetting(changes.event);
      await service.check('activate');
      assert.strictEqual(service.status.installation?.foundThrough, 'global');

      world.setting = mine;
      const { started } = fire(service, 'the-seed.toolPath');
      const status = await started[0];
      assert.strictEqual(status.state, 'usable');
      assert.strictEqual(status.installation?.packageDir, mine);
      assert.strictEqual(status.installation?.foundThrough, 'setting');
      assert.strictEqual(status.others.length, 0, 'the global installation was consulted');
    });

    test('a setting that is not the tool gives notTheTool naming the setting and the path, with no fallback to the global installation', async () => {
      installGlobal('2.1.0');
      const service = makeService();
      service.watchSetting(changes.event);
      assert.strictEqual((await service.check('activate')).state, 'usable');

      const missing = path.join(scratch.dir('elsewhere'), 'nonexistent');
      world.setting = missing;
      const { started } = fire(service, 'the-seed.toolPath');
      const status = await started[0];
      assert.strictEqual(status.state, 'notTheTool');
      assert.ok(status.message.includes('the-seed.toolPath'), status.message);
      assert.ok(status.message.includes(missing), status.message);
      assert.strictEqual(status.installation, undefined);
      assert.strictEqual(status.report.candidates.length, 0);

      const result = await service.acquire();
      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.status.state, 'notTheTool');
      }
    });

    test('a directory holding another package gives notTheTool saying which package', async () => {
      installGlobal('2.1.0');
      const other = makeStubTool(scratch.dir('other'), { version: '2.1.0', name: 'some-other-package' });
      world.setting = other;
      const service = makeService();
      const status = await service.check('activate');
      assert.strictEqual(status.state, 'notTheTool');
      assert.ok(status.message.includes('it is the package some-other-package'), status.message);
    });

    test('clearing the setting returns to the default lookup over the injected environment', async () => {
      installGlobal('2.1.0');
      const mine = makeStubTool(scratch.dir('mine'), { version: '2.3.0' });
      world.setting = mine;
      const service = makeService();
      service.watchSetting(changes.event);
      await service.check('activate');
      assert.strictEqual(service.status.installation?.packageDir, mine);
      assert.strictEqual(world.npmCalls, 0);

      world.setting = '';
      const { started } = fire(service, 'the-seed.toolPath');
      const status = await started[0];
      assert.strictEqual(status.state, 'usable');
      assert.strictEqual(status.installation?.foundThrough, 'global');
      assert.strictEqual(status.installation?.version, '2.1.0');
      assert.strictEqual(world.npmCalls, 1);

      const result = await service.acquire();
      assert.ok(result.ok);
      if (result.ok) {
        assert.strictEqual(result.installation.foundThrough, 'global');
      }
    });

    test('clearing a setting that was not the tool also returns to the default lookup', async () => {
      installGlobal('2.1.0');
      world.setting = path.join(scratch.dir('elsewhere'), 'nonexistent');
      const service = makeService();
      service.watchSetting(changes.event);
      assert.strictEqual((await service.check('activate')).state, 'notTheTool');

      world.setting = '';
      const { started } = fire(service, 'the-seed.toolPath');
      assert.strictEqual((await started[0]).state, 'usable');
    });

    test('a change to another setting does not recheck', async () => {
      installGlobal('2.1.0');
      const service = makeService();
      service.watchSetting(changes.event);
      await service.check('activate');
      const calls = world.npmCalls;
      const { started } = fire(service, 'the-seed.somethingElse', 'editor.fontSize');
      assert.strictEqual(started.length, 0);
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.strictEqual(world.npmCalls, calls);
    });

    test('after the watch is disposed a change no longer rechecks', async () => {
      installGlobal('2.1.0');
      const service = makeService();
      const watch = service.watchSetting(changes.event);
      await service.check('activate');
      watch.dispose();
      const { started } = fire(service, 'the-seed.toolPath');
      assert.strictEqual(started.length, 0);
    });
  });

  suite('keys', () => {
    test('the key is the state, the location and the version', async () => {
      const pkg = installGlobal('1.2.1');
      const status = await makeService().check('activate');
      assert.strictEqual(status.key, `tooOld|${pkg}|1.2.1`);
    });

    test('two different wrong settings are two keys, and the same one twice is one', async () => {
      const service = makeService();
      const parent = scratch.dir('parent');
      world.setting = path.join(parent, 'one');
      const one = await service.check('setting');
      world.setting = path.join(parent, 'two');
      const two = await service.check('setting');
      world.setting = path.join(parent, 'two');
      const twoAgain = await service.check('setting');
      assert.strictEqual(one.state, 'notTheTool');
      assert.strictEqual(two.state, 'notTheTool');
      assert.notStrictEqual(one.key, two.key);
      assert.strictEqual(two.key, twoAgain.key);
      assert.ok(two.key.includes(path.join(parent, 'two')), two.key);
    });
  });

  suite('the notice', () => {
    test('is shown once per unusable key', async () => {
      const service = makeService();
      await service.check('activate');
      assert.strictEqual(world.notifier.notices.length, 1);
      assert.strictEqual(world.notifier.notices[0].state, 'notFound');
      await service.check('setting');
      await service.check('setting');
      assert.strictEqual(world.notifier.notices.length, 1);
    });

    test('is shown again for a new key', async () => {
      const service = makeService();
      await service.check('activate');
      installGlobal('1.2.1');
      await service.check('setting');
      assert.deepStrictEqual(world.notifier.notices.map((status) => status.state), ['notFound', 'tooOld']);
      installGlobal('1.2.2');
      await service.check('setting');
      assert.strictEqual(world.notifier.notices.length, 3);
    });

    test('is not shown again for a key shown earlier this session, even after a usable state in between', async () => {
      const service = makeService();
      await service.check('activate');
      installGlobal('2.1.0');
      await service.check('setting');
      fs.rmSync(path.join(world.root, '@metaverse-systems'), { recursive: true });
      await service.check('setting');
      assert.strictEqual(world.notifier.notices.length, 1, 'a key shown this session is not shown twice');
    });

    test('is shown for two different notTheTool setting values', async () => {
      const service = makeService();
      const parent = scratch.dir('parent');
      world.setting = path.join(parent, 'one');
      await service.check('setting');
      world.setting = path.join(parent, 'two');
      await service.check('setting');
      assert.strictEqual(world.notifier.notices.length, 2);
    });

    test('is never shown for a usable tool', async () => {
      installGlobal('2.1.0');
      const service = makeService();
      await service.check('activate');
      await service.check('checkAgain');
      assert.strictEqual(world.notifier.notices.length, 0);
    });

    test('is shown again by a check the user asked for', async () => {
      const service = makeService();
      await service.check('activate');
      assert.strictEqual(world.notifier.notices.length, 1);
      await service.check('checkAgain');
      assert.strictEqual(world.notifier.notices.length, 2);
      await service.check('checkAgain');
      assert.strictEqual(world.notifier.notices.length, 3);
    });

    test('is not shown for a usable tool even when the user asked', async () => {
      installGlobal('2.1.0');
      const service = makeService();
      await service.check('checkAgain');
      assert.strictEqual(world.notifier.notices.length, 0);
    });

    test('is not shown when an operation is waiting on the check: the refusal is the only message', async () => {
      const service = makeService();
      const result = await service.acquire();
      assert.strictEqual(result.ok, false);
      assert.strictEqual(world.notifier.notices.length, 0, 'a notice was shown for a refused operation');
      if (!result.ok) {
        await service.showRefusal(result.status);
      }
      assert.strictEqual(world.notifier.refusals.length, 1);
      assert.strictEqual(world.notifier.refusals[0].state, 'notFound');
      assert.strictEqual(world.notifier.notices.length, 0);
    });

    test('is counted as shown by the refusal that stood in for it', async () => {
      const service = makeService();
      await service.acquire();
      await service.check('setting');
      assert.strictEqual(world.notifier.notices.length, 0, 'the key the refusal covered was shown again');
      installGlobal('1.2.1');
      await service.check('setting');
      assert.strictEqual(world.notifier.notices.length, 1);
      assert.strictEqual(world.notifier.notices[0].state, 'tooOld');
    });

    test('is shown for a new key found by a check that no operation waits on, after a refusal', async () => {
      const service = makeService();
      await service.acquire();
      installGlobal('3.0.0');
      await service.check('setting');
      assert.deepStrictEqual(world.notifier.notices.map((status) => status.state), ['tooNew']);
    });

    test('the refusal is shown every time, not once per key', async () => {
      const service = makeService();
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await service.acquire();
        assert.ok(!result.ok);
        if (!result.ok) {
          await service.showRefusal(result.status);
        }
      }
      assert.strictEqual(world.notifier.refusals.length, 3);
      assert.strictEqual(world.notifier.notices.length, 0);
    });
  });

  suite('what the status holds', () => {
    test('nothing from an .npmrc other than the prefix', async () => {
      const prefix = scratch.dir('prefix');
      installGlobal('2.1.0', { root: path.join(prefix, 'lib', 'node_modules') });
      fs.writeFileSync(path.join(world.home, '.npmrc'), [
        '//registry.npmjs.org/:_authToken=SECRET-TOKEN-0123',
        `prefix=${prefix}`,
        '',
      ].join('\n'));
      const service = makeService({ runNpmRoot: async () => undefined });
      const status = await service.check('activate');
      assert.strictEqual(status.state, 'usable');
      assert.ok(status.installation?.detail.includes('.npmrc'), status.installation?.detail);
      const everything = JSON.stringify(status);
      assert.ok(!everything.includes('SECRET-TOKEN-0123'), 'the status holds a token from the .npmrc');
      assert.ok(!everything.includes('_authToken'), 'the status holds a line from the .npmrc');
    });

    test('nothing from an .npmrc in a not-found message', async () => {
      fs.writeFileSync(path.join(world.home, '.npmrc'), '//registry.npmjs.org/:_authToken=SECRET-TOKEN-0123\nregistry=https://private.example.invalid/\n');
      const status = await makeService({ runNpmRoot: async () => undefined }).check('activate');
      assert.strictEqual(status.state, 'notFound');
      assert.ok(!status.message.includes('SECRET-TOKEN-0123'));
      assert.ok(!status.message.includes('private.example.invalid'));
      assert.ok(!JSON.stringify(status).includes('SECRET-TOKEN-0123'));
    });
  });
});

suite('tool setting in the editor', () => {
  const scratch = useScratchDirs();
  const service = (): ToolServiceLike => activeToolService() as unknown as ToolServiceLike;

  test('a compatible installation named by the setting is used by the next acquire with no restart', async () => {
    const stub = makeStubTool(scratch.dir('stub'), { version: '2.7.0' });
    const before = await service().acquire();
    assert.ok(before.ok);
    await withToolSetting(stub, async () => {
      const result = await service().acquire();
      assert.ok(result.ok, result.ok ? '' : result.status.message);
      if (result.ok) {
        assert.strictEqual(result.installation.packageDir, fs.realpathSync(stub));
        assert.strictEqual(result.installation.foundThrough, 'setting');
        assert.strictEqual(result.installation.version, '2.7.0');
      }
    });
    const after = await service().acquire();
    assert.ok(after.ok);
    if (before.ok && after.ok) {
      assert.strictEqual(after.installation.packageDir, before.installation.packageDir);
      assert.strictEqual(after.api, before.api, 'the test tool was loaded again');
    }
  });

  test('a path that is not there gives notTheTool naming the setting and the path', async () => {
    const missing = '/nonexistent';
    await withToolSetting(missing, async () => {
      const result = await service().acquire();
      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.status.state, 'notTheTool');
        assert.ok(result.status.message.includes('the-seed.toolPath'), result.status.message);
        assert.ok(result.status.message.includes(missing), result.status.message);
      }
    });
    assert.strictEqual(service().status.state, 'usable');
  });

  test('a directory holding another package gives notTheTool saying which package', async () => {
    const other = makeStubTool(scratch.dir('other'), { version: '2.1.0', name: 'some-other-package' });
    await withToolSetting(other, async () => {
      const result = await service().acquire();
      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.status.state, 'notTheTool');
        assert.ok(result.status.message.includes('it is the package some-other-package'), result.status.message);
        assert.ok(result.status.message.includes(other), result.status.message);
      }
    });
  });

  test('the test tool is back in use when a case fails inside withToolSetting', async () => {
    await assert.rejects(withToolSetting('/nonexistent', () => {
      throw new Error('failed inside');
    }), /failed inside/);
    const result = await service().acquire();
    assert.ok(result.ok, result.ok ? '' : result.status.message);
  });

  test('the manifest declares the tool path setting as a machine-scoped string', () => {
    const manifest = require(path.resolve(__dirname, '..', '..', '..', 'package.json')) as {
      contributes: { configuration: { properties: Record<string, { type?: string; scope?: string }> } };
    };
    const declared = manifest.contributes.configuration.properties['the-seed.toolPath'];
    assert.ok(declared, 'the-seed.toolPath is not declared');
    assert.strictEqual(declared.type, 'string');
    assert.strictEqual(declared.scope, 'machine');
  });
});

suite('tool notices in the editor', () => {
  let warning: sinon.SinonStub;
  let failure: sinon.SinonStub;
  let command: sinon.SinonStub;
  let checkAgain: sinon.SinonStub;

  setup(() => {
    warning = sinon.stub(vscode.window, 'showWarningMessage') as unknown as sinon.SinonStub;
    failure = sinon.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;
    command = sinon.stub(vscode.commands, 'executeCommand') as unknown as sinon.SinonStub;
    warning.resolves(undefined);
    failure.resolves(undefined);
    command.resolves(undefined);
    checkAgain = sinon.stub().resolves(undefined);
  });

  teardown(() => {
    sinon.restore();
  });

  const notifier = (): ToolNotifier => serviceModule().createVscodeNotifier(checkAgain);
  const unusable = (state: State = 'notFound'): ToolStatus => statusOf(state, { message: `a ${state} message` });

  test('a notice is a warning with the status message and the two actions', async () => {
    await notifier().showNotice(unusable());
    assert.strictEqual(warning.callCount, 1);
    assert.strictEqual(failure.callCount, 0);
    assert.deepStrictEqual(warning.firstCall.args, ['The Seed: a notFound message', 'Open Setting', 'Check Again']);
  });

  test('a refusal is an error with the status message and the same actions', async () => {
    await notifier().showRefusal(unusable('tooOld'));
    assert.strictEqual(failure.callCount, 1);
    assert.strictEqual(warning.callCount, 0);
    assert.deepStrictEqual(failure.firstCall.args, ['The Seed: a tooOld message', 'Open Setting', 'Check Again']);
  });

  test('a reload-required notice adds Reload Window', async () => {
    await notifier().showNotice(unusable('reloadRequired'));
    const actions = warning.firstCall.args.slice(1);
    assert.ok(actions.includes('Reload Window'), actions.join(', '));
    await notifier().showRefusal(unusable('reloadRequired'));
    assert.ok(failure.firstCall.args.slice(1).includes('Reload Window'));
  });

  test('no other state offers Reload Window', async () => {
    for (const state of ['notFound', 'notTheTool', 'tooOld', 'tooNew', 'notLoadable'] as State[]) {
      await notifier().showNotice(unusable(state));
    }
    for (const call of warning.getCalls()) {
      assert.ok(!call.args.slice(1).includes('Reload Window'), String(call.args[0]));
    }
  });

  test('Open Setting opens the settings editor on the tool path setting', async () => {
    warning.resolves('Open Setting');
    await notifier().showNotice(unusable());
    assert.ok(command.calledWith('workbench.action.openSettings', 'the-seed.toolPath'), JSON.stringify(command.args));
    assert.strictEqual(checkAgain.callCount, 0);
  });

  test('Check Again asks the service to check again', async () => {
    failure.resolves('Check Again');
    await notifier().showRefusal(unusable());
    assert.strictEqual(checkAgain.callCount, 1);
    assert.ok(!command.calledWith('workbench.action.openSettings'));
  });

  test('Reload Window reloads the editor', async () => {
    warning.resolves('Reload Window');
    await notifier().showNotice(unusable('reloadRequired'));
    assert.ok(command.calledWith('workbench.action.reloadWindow'), JSON.stringify(command.args));
  });

  test('dismissing does nothing', async () => {
    await notifier().showNotice(unusable());
    assert.strictEqual(command.callCount, 0);
    assert.strictEqual(checkAgain.callCount, 0);
  });
});
