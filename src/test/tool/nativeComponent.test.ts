// Operations that need the tool's native component, run against a scratch copy of the installed tool
// that has none. Each shows the tool's own message, unchanged, naming the copy's directory; the tool
// stays usable and everything that needs no native step keeps working.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { getOperationLock } from '../../operationLock';
import { requires } from '../harness/platform';
import { isElf, locateBuildDeps, requireProgram } from '../helpers/buildDeps';
import { createCertFor, fixturePath } from '../helpers/scratchHome';
import { useScratchState } from '../helpers/scratchState';
import { copyTestTool } from '../helpers/stubTool';
import { testTool, withToolSetting } from '../helpers/tool';
import { signFile } from '../../commands/signFile';
import { verifySignature } from '../../commands/verifySignature';
import { handleMessage } from '../../panels/messageHandler';
import { activeToolService } from '../../tool/toolService';

const SCOPE = '@acme';
const CASE_TIMEOUT = 240000;
const ENV_KEYS = ['PKG_CONFIG_PATH', 'PKG_CONFIG_LIBDIR', 'MAKEFLAGS', 'MFLAGS'];

suite('Native component of the installation in use', function () {
  this.timeout(CASE_TIMEOUT);
  const state = useScratchState({ scopes: { [SCOPE]: 'Ada Lovelace' }, workspaceFolders: 1 });

  let copy: string;
  let info: sinon.SinonStub;
  let warning: sinon.SinonStub;
  let error: sinon.SinonStub;

  setup(async () => {
    copy = copyTestTool(path.join(state.dir('toolcopy'), 'the-seed'), { native: false });
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    info = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    warning = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);
    error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  /** A program project created by the copy's own templates in the first workspace folder. */
  function scaffold(name: string): string {
    const tool = testTool();
    const config = new tool.Config();
    config.loadConfig();
    const template = new tool.Template(config);
    template.type = 'program';
    return template.createPackage(SCOPE, name, state.workspaceFolders[0]);
  }

  async function openIn(project: string): Promise<void> {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(project, 'package.json')));
    await vscode.window.showTextDocument(document);
  }

  function chooseDebug(): void {
    sinon.stub(vscode.window, 'showQuickPick').callsFake(((items: readonly vscode.QuickPickItem[] | string[]) => {
      const labels = (items as readonly (vscode.QuickPickItem | string)[]).map((item) => (typeof item === 'string' ? item : item.label));
      return Promise.resolve(labels.includes('Debug') ? { label: 'Debug' } : SCOPE);
    }) as never);
  }

  function assertUsable(): void {
    assert.strictEqual(activeToolService().status.state, 'usable', 'the native component never changes the tool status');
    assert.strictEqual(getOperationLock().active, false, 'no operation lock is held');
  }

  /** The text the tool gives, as loaded from the copy: it names the copy's directory. */
  function expectedMessage(): string {
    const message = testTool().nativeComponentMessage();
    assert.ok(message.includes(`cd "${copy}" && npm run build-addon`), message);
    assert.ok(!message.includes(' Loading error: '), 'the component is absent, not broken');
    return message;
  }

  suite('without the native component', () => {
    test('the copy has no native component and is the installation in use', async () => {
      assert.ok(!fs.existsSync(path.join(copy, 'native')), 'the copy holds no native directory');
      await withToolSetting(copy, () => {
        assert.strictEqual(fs.realpathSync(activeToolService().status.installation!.packageDir), fs.realpathSync(copy));
        expectedMessage();
        assertUsable();
      });
    });

    test('signing a Windows program shows the tool message in full and signs nothing', async () => {
      await withToolSetting(copy, async () => {
        const message = expectedMessage();
        await createCertFor(SCOPE);
        const file = path.join(state.dir('sign'), 'tiny.exe');
        fs.copyFileSync(fixturePath('tiny.exe'), file);
        const before = fs.readFileSync(file);

        await signFile(vscode.window.createOutputChannel('native-component-test'), testTool(), vscode.Uri.file(file));

        assert.deepStrictEqual(error.args.map((args) => args[0]), [message]);
        assert.ok(info.notCalled, 'no success is reported');
        assert.deepStrictEqual(fs.readFileSync(file), before, 'the file is unchanged');
        assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['tiny.exe'], 'no signature file is written');
        assertUsable();
      });
    });

    test('verifying a Windows program says it could not be checked with the tool message in full', async () => {
      await withToolSetting(copy, async () => {
        const message = expectedMessage();
        const file = path.join(state.dir('verify'), 'tiny.exe');
        fs.copyFileSync(fixturePath('tiny.exe'), file);

        await verifySignature(vscode.window.createOutputChannel('native-component-test'), testTool(), vscode.Uri.file(file));

        assert.strictEqual(warning.callCount, 1, `one warning: ${JSON.stringify(warning.args)}`);
        assert.ok(String(warning.firstCall.args[0]).includes(message), String(warning.firstCall.args[0]));
        assert.ok(info.notCalled && error.notCalled, 'neither success nor error is shown');
        assertUsable();
      });
    });

    test('packaging shows the tool message in full and leaves no output', async () => {
      await withToolSetting(copy, async () => {
        const message = expectedMessage();
        const project = scaffold('pkgdemo');
        state.setWorkspaceFolders([project]);

        await vscode.commands.executeCommand('the-seed.packageProject');

        assert.deepStrictEqual(error.args.map((args) => args[0]), [`Packaging failed: ${message}`]);
        assert.ok(info.notCalled, 'no success is reported');
        const dist = path.join(project, 'dist');
        assert.ok(!fs.existsSync(dist) || fs.readdirSync(dist).length === 0, 'no packaged files');
        assertUsable();
      });
    });

    test('generating the Windows installer shows the tool message in full and leaves no installer', async () => {
      await withToolSetting(copy, async () => {
        const message = expectedMessage();
        const project = scaffold('instdemo');
        state.setWorkspaceFolders([project]);

        await vscode.commands.executeCommand('the-seed.generateWindowsInstaller');

        assert.deepStrictEqual(error.args.map((args) => args[0]), [message]);
        assert.ok(info.notCalled, 'no success is reported');
        const found = fs.readdirSync(project, { recursive: true }).map(String).filter((entry) => entry.endsWith('.msi'));
        assert.deepStrictEqual(found, [], 'no installer is written');
        assertUsable();
      });
    });

    test('a Windows build shows the tool message in full before any step and installs nothing', async () => {
      await withToolSetting(copy, async () => {
        const message = expectedMessage();
        const project = scaffold('windemo');
        await openIn(project);
        chooseDebug();

        await vscode.commands.executeCommand('the-seed.buildWindows');

        assert.deepStrictEqual(error.args.map((args) => args[0]), [message]);
        assert.ok(info.notCalled, 'no success is reported');
        assert.deepStrictEqual(fs.readdirSync(state.prefix!), [], 'nothing is installed');
        assert.ok(!fs.existsSync(path.join(project, 'build')), 'no build tree is made');
        assertUsable();
      });
    });

    test('a recursive Windows build shows the tool message in full', async () => {
      await withToolSetting(copy, async () => {
        const message = expectedMessage();
        const project = scaffold('winrecdemo');
        await openIn(project);
        chooseDebug();

        await vscode.commands.executeCommand('the-seed.buildWindowsRecursive');

        assert.deepStrictEqual(error.args.map((args) => args[0]), [message]);
        assert.ok(info.notCalled, 'no success is reported');
        assert.deepStrictEqual(fs.readdirSync(state.prefix!), [], 'nothing is installed');
        assertUsable();
      });
    });

    test('Check Tool reports the missing native component with the tool message in full', async () => {
      await withToolSetting(copy, async () => {
        const message = expectedMessage();

        await vscode.commands.executeCommand('the-seed.checkTool');

        assert.strictEqual(warning.callCount, 1, `one warning: ${JSON.stringify(warning.args)}`);
        const shown = String(warning.firstCall.args[0]);
        assert.ok(shown.includes(message), shown);
        assert.ok(shown.includes(activeToolService().status.message), 'the version and location are still reported');
        assert.ok(info.notCalled, 'no plain report is shown');
        assertUsable();
      });
    });

    test('a configuration change and a template scaffold still work', async () => {
      await withToolSetting(copy, async () => {
        const response = await handleMessage(
          { command: 'savePrefix', requestId: 'r', data: { prefix: path.join(state.home, 'other-prefix') } },
          undefined,
          activeToolService()
        );
        assert.strictEqual(response?.type, 'prefixSaved');
        const config = new (testTool().Config)();
        config.loadConfig();
        assert.strictEqual(config.config.prefix, path.join(state.home, 'other-prefix'));

        const project = scaffold('plain');
        assert.ok(fs.existsSync(path.join(project, 'package.json')), 'the project is created');
        assert.ok(error.notCalled, 'no error is shown');
        assertUsable();
      });
    });

    suite('native build of a scaffolded project', () => {
      requires('posix-toolchain');
      let savedEnv: Record<string, string | undefined>;

      setup(function () {
        if (!process.env.THE_SEED_TEST_DEPS) {
          this.skip();
        }
        requireProgram('g++', 'install build-essential');
        savedEnv = {};
        for (const key of ENV_KEYS) {
          savedEnv[key] = process.env[key];
          delete process.env[key];
        }
      });

      teardown(() => {
        for (const key of ENV_KEYS) {
          if (savedEnv?.[key] === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = savedEnv[key];
          }
        }
      });

      test('succeeds with the copy that has no native component', async () => {
        const deps = locateBuildDeps();
        process.env.PKG_CONFIG_PATH = deps.nativePkgConfig.join(path.delimiter);
        await withToolSetting(copy, async () => {
          const project = scaffold('nativedemo');
          await openIn(project);
          chooseDebug();

          await vscode.commands.executeCommand('the-seed.buildNative');

          assert.ok(info.calledWith('Build succeeded.'), `information shown: ${JSON.stringify(info.args.map((a) => a[0]))}`);
          assert.ok(error.notCalled, `no error: ${JSON.stringify(error.args.map((a) => a[0]))}`);
          const binary = path.join(state.prefix!, 'x86_64-linux-gnu', 'bin', 'nativedemo');
          assert.ok(fs.existsSync(binary) && isElf(binary), 'the program is installed as an ELF executable');
          assertUsable();
        });
      });
    });
  });
});
