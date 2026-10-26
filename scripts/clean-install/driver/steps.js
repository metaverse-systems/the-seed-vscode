// The clean-install check's steps, run inside the editor beside the installed
// extension. Only the public vscode API is used, and the tool is the global
// installation (CLEAN_INSTALL_TOOL_ROOT), never the repository's devDependency.
//
// The check runs in two sessions, because the readme's native-component step
// (npm run build-addon in the global tool) comes after the libraries are
// installed and needs no editor: run.js runs it between them.
//   Session 1: the installed package, its commands, first use without a
//   configuration, the prefix and a scope through the tool, Install
//   Dependencies, and a program project created through the tool.
//   Session 2 (the project folder open): the native component, Check Tool
//   again, Check Dependencies, the builds, signing, packaging, the installer.
//
// Each step records its command's outcome in <state>/session-<n>.json, which
// run.js turns into the leg's records.
'use strict';

const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const lib = require('../lib');

const env = process.env;
const SESSION = env.CLEAN_INSTALL_SESSION;
const STATE = env.CLEAN_INSTALL_STATE;
const EXTENSION_ID = 'metaverse-systems.the-seed-vscode';
const SCOPE = '@cleancheck';
const PROJECT_NAME = 'cleancheck';
const MINUTE = 60 * 1000;

const result = { outcomes: {}, checks: [] };

function save() {
  fs.mkdirSync(STATE, { recursive: true });
  fs.writeFileSync(path.join(STATE, `session-${SESSION}.json`), JSON.stringify(result, null, 2) + '\n');
}

function reason(error) {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0];
}

function outcome(id, value) {
  lib.checkOutcome(value);
  result.outcomes[id] = value;
  save();
}

/** Runs a command's step: passed when `body` completes, otherwise failed with the reason (and the test fails). */
async function step(id, body) {
  try {
    await body();
    outcome(id, 'passed');
  } catch (error) {
    outcome(id, `failed (${reason(error)})`);
    throw error;
  }
}

/** Runs a step that is not a command's (the installed package, the setup through the tool). */
async function checkStep(name, body) {
  try {
    await body();
    result.checks.push({ check: name, outcome: 'passed' });
    save();
  } catch (error) {
    result.checks.push({ check: name, outcome: `failed (${reason(error)})` });
    save();
    throw error;
  }
}

/** The global tool's modules, loaded from its installation. */
function tool() {
  const load = (name) => require(path.join(env.CLEAN_INSTALL_TOOL_ROOT, 'dist', `${name}.js`));
  return {
    Config: load('Config').default,
    Scopes: load('Scopes').default,
    Template: load('Template').default,
    Signing: load('Signing').default,
    Package: load('Package').default,
    Dependencies: load('Dependencies'),
    NativeComponent: load('NativeComponent'),
  };
}

function hasProgram(name) {
  return cp.spawnSync('sh', ['-c', `command -v ${name}`], { stdio: 'ignore' }).status === 0;
}

/**
 * Runs a command and waits for it, failing after `timeout`: a command that waits on a prompt or on a
 * notification's buttons never finishes on its own. With `acceptPicks`, the first item of any quick
 * pick it shows is accepted (the build mode "Debug", the target "native").
 */
async function runCommand(id, args, { timeout, acceptPicks = false }) {
  let settled = false;
  const running = Promise.resolve(vscode.commands.executeCommand(id, ...args)).finally(() => {
    settled = true;
  });
  let timer;
  const expired = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${id} did not finish within ${Math.round(timeout / 1000)} s (waiting on a prompt or a notification?)`)),
      timeout
    );
  });
  const pump = acceptPicks
    ? setInterval(() => {
      if (!settled) {
        void vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
      }
    }, 1000)
    : undefined;
  try {
    await Promise.race([running, expired]);
  } finally {
    clearTimeout(timer);
    if (pump) {
      clearInterval(pump);
    }
  }
}

function workspaceFolder() {
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  assert.ok(folder, 'no workspace folder is open');
  return folder.uri.fsPath;
}

function binaries(projectDir) {
  const t = tool();
  return new t.Package(new t.Config()).resolveBinaryPaths(projectDir).filter((file) => fs.existsSync(file));
}

function nativeProgram(projectDir) {
  return binaries(projectDir).find((file) => !file.endsWith('.exe'));
}

function windowsProgram(projectDir) {
  return binaries(projectDir).find((file) => file.endsWith('.exe'));
}

async function openSource(projectDir) {
  const src = path.join(projectDir, 'src');
  const file = fs.readdirSync(src).find((name) => name.endsWith('.cpp'));
  assert.ok(file, `no .cpp file in ${src}`);
  await vscode.window.showTextDocument(vscode.Uri.file(path.join(src, file)));
}

function librariesInstalled(target) {
  const t = tool();
  const config = new t.Config();
  return t.Dependencies.checkLibEcs(config, target) && t.Dependencies.checkLibTheSeed(config, target);
}

if (SESSION === '1') {
  suite('Clean install: first session', () => {
    test('the installed package is the one active, at the package\'s version', () => checkStep('installed extension', async () => {
      const extension = vscode.extensions.getExtension(EXTENSION_ID);
      assert.ok(extension, `${EXTENSION_ID} is not installed`);
      const installed = fs.realpathSync(extension.extensionPath);
      const extensionsDir = fs.realpathSync(env.CLEAN_INSTALL_EXTENSIONS_DIR);
      assert.ok(installed.startsWith(extensionsDir + path.sep), `${installed} is not inside ${extensionsDir}`);
      assert.strictEqual(extension.packageJSON.version, env.CLEAN_INSTALL_EXTENSION_VERSION);
      await extension.activate();
    }));

    test('every contributed command is registered', () => checkStep('commands registered', async () => {
      const extension = vscode.extensions.getExtension(EXTENSION_ID);
      assert.ok(extension, `${EXTENSION_ID} is not installed`);
      const registered = new Set(await vscode.commands.getCommands(true));
      const contributed = extension.packageJSON.contributes.commands.map((entry) => entry.command);
      assert.strictEqual(contributed.length, 28);
      assert.deepStrictEqual(contributed.filter((id) => !registered.has(id)), []);
    }));

    test('Check Tool on first use', () => step('the-seed.checkTool', async () => {
      await runCommand('the-seed.checkTool', [], { timeout: 2 * MINUTE });
    }));

    test('Show Config on first use writes the default configuration', () => step('the-seed.showConfig', async () => {
      await runCommand('the-seed.showConfig', [], { timeout: 2 * MINUTE });
      const configFile = path.join(os.homedir(), 'the-seed', 'config.json');
      assert.ok(fs.existsSync(configFile), `${configFile} was not written`);
    }));

    test('the prefix and a scope are set through the tool', () => checkStep('prefix and scope set through the tool', async () => {
      const t = tool();
      const config = new t.Config();
      config.config.prefix = env.CLEAN_INSTALL_PREFIX;
      new t.Scopes(config).createOrEditScope({
        scopeName: SCOPE,
        authorName: 'Clean Install',
        authorEmail: 'clean-install@example.invalid',
        authorURL: 'https://example.invalid',
      });
      config.saveConfig();
      const reloaded = new t.Config();
      assert.strictEqual(reloaded.config.prefix, env.CLEAN_INSTALL_PREFIX);
      assert.deepStrictEqual(new t.Scopes(reloaded).getScopes(), [SCOPE]);
    }));

    test('List Scopes', () => step('the-seed.listScopes', async () => {
      await runCommand('the-seed.listScopes', [], { timeout: 2 * MINUTE });
    }));

    test('Install Dependencies, native and (with MinGW) Windows', () => step('the-seed.installDependencies', async () => {
      await runCommand('the-seed.installDependencies', ['native'], { timeout: 40 * MINUTE });
      assert.ok(librariesInstalled('native'), 'the native libraries are not installed in the prefix');
      if (hasProgram('x86_64-w64-mingw32-g++')) {
        await runCommand('the-seed.installDependencies', ['windows'], { timeout: 40 * MINUTE });
        assert.ok(librariesInstalled('windows'), 'the Windows libraries are not installed in the prefix');
      }
    }));

    test('a program project is created through the tool', () => checkStep('program project created through the tool', async () => {
      const t = tool();
      const template = new t.Template(new t.Config());
      template.type = 'program';
      result.projectDir = template.createPackage(SCOPE, PROJECT_NAME, workspaceFolder());
      save();
      assert.ok(fs.existsSync(path.join(result.projectDir, 'package.json')), `${result.projectDir} has no package.json`);
    }));
  });
}

if (SESSION === '2') {
  suite('Clean install: second session', () => {
    let built = false;
    let windowsBuilt = false;

    test('the native component built by the readme\'s step loads', () => checkStep('native component loads', async () => {
      tool().NativeComponent.requireNativeComponent();
    }));

    test('Check Tool after the native component is built', () => step('the-seed.checkTool', async () => {
      await runCommand('the-seed.checkTool', [], { timeout: 2 * MINUTE });
    }));

    test('Check Dependencies', () => step('the-seed.checkDependencies', async () => {
      await runCommand('the-seed.checkDependencies', [], { timeout: 2 * MINUTE, acceptPicks: true });
    }));

    test('Build Native with the project\'s file open', () => step('the-seed.buildNative', async () => {
      const projectDir = workspaceFolder();
      await openSource(projectDir);
      await runCommand('the-seed.buildNative', [], { timeout: 20 * MINUTE, acceptPicks: true });
      assert.ok(nativeProgram(projectDir), `no program was built in ${projectDir}`);
      built = true;
    }));

    test('Build (Incremental)', () => step('the-seed.buildIncremental', async () => {
      const projectDir = workspaceFolder();
      await openSource(projectDir);
      await runCommand('the-seed.buildIncremental', [], { timeout: 20 * MINUTE, acceptPicks: true });
      assert.ok(nativeProgram(projectDir), `no program in ${projectDir} after the incremental build`);
    }));

    test('Sign File and Verify Signature, as from the explorer menu on two files', async () => {
      const projectDir = workspaceFolder();
      let files = [];
      try {
        await checkStep('certificate created through the tool', async () => {
          assert.ok(built, 'the native build did not pass');
          const t = tool();
          await new t.Signing().createCert({ scope: SCOPE });
          const program = nativeProgram(projectDir);
          const exe = path.join(projectDir, 'signing-check', 'tiny.exe');
          fs.mkdirSync(path.dirname(exe), { recursive: true });
          fs.copyFileSync(env.CLEAN_INSTALL_FIXTURE, exe);
          files = [program, exe];
        });
      } catch (error) {
        const failed = `failed (not run: ${reason(error)})`;
        outcome('the-seed.signFile', failed);
        outcome('the-seed.verifySignature', failed);
        throw error;
      }
      const uris = files.map((file) => vscode.Uri.file(file));
      await step('the-seed.signFile', async () => {
        await runCommand('the-seed.signFile', [uris[0], uris], { timeout: 2 * MINUTE });
        const signing = new (tool().Signing)();
        for (const file of files) {
          const verified = await signing.verifyFile(file);
          assert.strictEqual(verified.status, 'VALID', `${file}: ${verified.status} ${verified.reason || ''}`);
        }
      });
      await step('the-seed.verifySignature', async () => {
        await runCommand('the-seed.verifySignature', [uris[0], uris], { timeout: 2 * MINUTE });
      });
    });

    test('Package Projects', () => step('the-seed.packageProject', async () => {
      assert.ok(built, 'the native build did not pass');
      const projectDir = workspaceFolder();
      await runCommand('the-seed.packageProject', [], { timeout: 10 * MINUTE });
      const dist = path.join(projectDir, 'dist');
      assert.ok(fs.existsSync(dist) && fs.readdirSync(dist).length > 0, `${dist} is missing or empty`);
    }));

    test('Build Windows, where the cross toolchain exists', async () => {
      if (!hasProgram('x86_64-w64-mingw32-g++')) {
        outcome('the-seed.buildWindows', 'not exercised: MinGW absent');
        return;
      }
      await step('the-seed.buildWindows', async () => {
        const projectDir = workspaceFolder();
        await openSource(projectDir);
        await runCommand('the-seed.buildWindows', [], { timeout: 20 * MINUTE, acceptPicks: true });
        assert.ok(windowsProgram(projectDir), `no Windows program was built in ${projectDir}`);
        windowsBuilt = true;
      });
    });

    test('Generate Windows Installer, where wixl and the Windows build exist', async () => {
      if (!hasProgram('wixl')) {
        outcome('the-seed.generateWindowsInstaller', 'not exercised: wixl absent');
        return;
      }
      if (!hasProgram('x86_64-w64-mingw32-g++')) {
        outcome('the-seed.generateWindowsInstaller', 'not exercised: MinGW absent');
        return;
      }
      await step('the-seed.generateWindowsInstaller', async () => {
        assert.ok(windowsBuilt, 'the Windows build did not pass');
        const projectDir = workspaceFolder();
        // The installer packages the project itself when dist/ is absent, so it holds the Windows build.
        fs.rmSync(path.join(projectDir, 'dist'), { recursive: true, force: true });
        await runCommand('the-seed.generateWindowsInstaller', [], { timeout: 10 * MINUTE });
        const installers = fs.readdirSync(projectDir).filter((name) => name.endsWith('.msi'));
        assert.ok(installers.length > 0, `no .msi was written in ${projectDir}`);
      });
    });
  });
}
