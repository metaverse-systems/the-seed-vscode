// Real builds through the extension's commands. Each case scaffolds a project
// from the tool's templates into a scratch workspace folder, opens a file of it
// in the editor, answers the build mode prompt with Debug and runs the palette
// command; the tool then runs autotools, make and the compiler for real, and the
// installed files are checked in a scratch prefix.
//
// Interface choices where the commands leave them open:
// - the project is found the way a user's is, from the active editor's file, so
//   the workspace search is never stubbed;
// - the Linux libraries come from PKG_CONFIG_PATH for the length of a case, as
//   the tool searches the user's own path after the prefix; the Windows
//   libraries are copied into the scratch prefix, because the tool searches only
//   there and in the toolchain's directories for a Windows build;
// - a missing library or compiler fails the case with a message that says what to
//   install; these cases are never skipped for a missing tool, only for a host
//   that cannot run a POSIX toolchain (native Windows).
// - cases get a longer timeout than the rest of the suites, scoped to this suite;
//   a build takes seconds here and well over ten on a hosted runner.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { getOperationLock } from '../../operationLock';
import { requires } from '../harness/platform';
import { BuildDeps, isElf, isWindowsImage, locateBuildDeps, requireProgram } from '../helpers/buildDeps';
import { useScratchState } from '../helpers/scratchState';
import { testTool } from '../helpers/tool';
import type { ToolApi } from '../../tool/toolApi';

const SCOPE = '@acme';
const NATIVE = 'x86_64-linux-gnu';
const WINDOWS = 'x86_64-w64-mingw32';
const CASE_TIMEOUT = 240000;
const ENV_KEYS = ['PKG_CONFIG_PATH', 'PKG_CONFIG_LIBDIR', 'MAKEFLAGS', 'MFLAGS'];

type Kind = 'component' | 'system' | 'program';
type Scaffold = (kind: Kind, channel: vscode.OutputChannel, tool: ToolApi) => Promise<void>;

suite('Real builds through the extension', function () {
  this.timeout(CASE_TIMEOUT);
  requires('posix-toolchain');
  const state = useScratchState({ scopes: { [SCOPE]: 'Ada Lovelace' }, workspaceFolders: 1 });

  let deps: BuildDeps;
  let savedEnv: Record<string, string | undefined>;
  let nextName: string;
  let info: sinon.SinonStub;
  let error: sinon.SinonStub;
  let warning: sinon.SinonStub;

  setup(async () => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    deps = locateBuildDeps();
    process.env.PKG_CONFIG_PATH = deps.nativePkgConfig.join(path.delimiter);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');

    sinon.stub(vscode.window, 'showQuickPick').callsFake(((items: readonly vscode.QuickPickItem[] | string[]) => {
      const labels = (items as readonly (vscode.QuickPickItem | string)[]).map((item) => (typeof item === 'string' ? item : item.label));
      return Promise.resolve(labels.includes('Debug') ? { label: 'Debug' } : SCOPE);
    }) as never);
    sinon.stub(vscode.window, 'showInputBox').callsFake((() => Promise.resolve(nextName)) as never);
    info = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    warning = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);
    error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  function installWindowsLibraries(): void {
    fs.cpSync(deps.windowsRoot, path.join(state.prefix!, WINDOWS), { recursive: true });
  }

  async function scaffold(kind: Kind, name: string): Promise<string> {
    nextName = name;
    const mod = require('../../commands/scaffoldTemplate') as { scaffoldTemplate: Scaffold };
    await mod.scaffoldTemplate(kind, vscode.window.createOutputChannel('real-build-test'), testTool());
    const project = path.join(state.workspaceFolders[0], name);
    assert.ok(fs.existsSync(path.join(project, 'package.json')), `${name} must be created in the workspace folder`);
    return project;
  }

  async function openIn(project: string): Promise<void> {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(project, 'package.json')));
    await vscode.window.showTextDocument(document);
  }

  function installed(target: string, ...segments: string[]): string {
    return path.join(state.prefix!, target, ...segments);
  }

  function assertSucceeded(message: string): void {
    assert.ok(info.calledWith(message), `expected "${message}"; information shown: ${JSON.stringify(info.args.map((a) => a[0]))}`);
    assert.strictEqual(error.callCount, 0, `no error may be shown: ${JSON.stringify(error.args.map((a) => a[0]))}`);
    assert.strictEqual(warning.callCount, 0, 'no warning may be shown');
    assert.strictEqual(getOperationLock().active, false, 'the operation lock is released');
  }

  /** Makes `program` depend on `component` the way projects declare it, so a recursive build reaches both. */
  function declareDependency(program: string, component: string, componentName: string): void {
    const file = path.join(program, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf-8'));
    manifest.dependencies = { [`${SCOPE}/${componentName}`]: `file:${path.relative(program, component)}` };
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
  }

  suite('Build Native', () => {
    requireTool('g++', 'install build-essential');

    test('a program is built and installed as a Linux executable', async () => {
      const project = await scaffold('program', 'nativeprog');
      await openIn(project);

      await vscode.commands.executeCommand('the-seed.buildNative');

      assertSucceeded('Build succeeded.');
      const binary = installed(NATIVE, 'bin', 'nativeprog');
      assert.ok(fs.existsSync(binary), `${binary} must exist`);
      assert.ok(isElf(binary), 'the program is an ELF executable');
      assert.ok(!fs.existsSync(installed(WINDOWS)), 'nothing is installed for Windows');
    });

    test('a component is built and installed as a shared library with its description', async () => {
      const project = await scaffold('component', 'nativecomp');
      await openIn(project);

      await vscode.commands.executeCommand('the-seed.buildNative');

      assertSucceeded('Build succeeded.');
      const library = installed(NATIVE, 'lib', 'libnativecomp.so.0.0.0');
      assert.ok(fs.existsSync(library), `${library} must exist`);
      assert.ok(isElf(library), 'the library is an ELF shared object');
      assert.ok(fs.existsSync(installed(NATIVE, 'lib', 'pkgconfig', 'nativecomp.pc')), 'the pkg-config description is installed');
      assert.ok(fs.existsSync(installed(NATIVE, 'include', 'nativecomp', 'nativecomp.hpp')), 'the header is installed');
    });

    test('a source error fails the build at compile, shows the error and installs nothing', async () => {
      const project = await scaffold('program', 'brokenprog');
      fs.appendFileSync(path.join(project, 'src', 'brokenprog.cpp'), '\nthis is not C++;\n');
      await openIn(project);

      await vscode.commands.executeCommand('the-seed.buildNative');

      assert.strictEqual(error.callCount, 1, 'one error is shown');
      assert.match(String(error.firstCall.args[0]), /^Build failed at compile/);
      assert.ok(!info.calledWith('Build succeeded.'), 'success must not be reported');
      assert.ok(!fs.existsSync(installed(NATIVE, 'bin', 'brokenprog')), 'nothing is installed');
      assert.strictEqual(getOperationLock().active, false, 'the operation lock is released');
    });
  });

  suite('Build Native recursively', () => {
    test('a component the program declares is built first and both are installed', async () => {
      const component = await scaffold('component', 'basecomp');
      const program = await scaffold('program', 'apprec');
      declareDependency(program, component, 'basecomp');
      await openIn(program);

      await vscode.commands.executeCommand('the-seed.buildNativeRecursive');

      assertSucceeded('Recursive build complete: 2 projects built.');
      assert.ok(isElf(installed(NATIVE, 'bin', 'apprec')), 'the program is installed');
      assert.ok(isElf(installed(NATIVE, 'lib', 'libbasecomp.so.0.0.0')), 'the component is installed');
    });
  });

  suite('Build Windows', () => {
    requireTool('x86_64-w64-mingw32-g++', 'install g++-mingw-w64-x86-64');

    test('a program is cross-built and installed as a Windows executable', async () => {
      installWindowsLibraries();
      const project = await scaffold('program', 'winprog');
      await openIn(project);

      await vscode.commands.executeCommand('the-seed.buildWindows');

      assertSucceeded('Build succeeded.');
      const binary = installed(WINDOWS, 'bin', 'winprog.exe');
      assert.ok(fs.existsSync(binary), `${binary} must exist`);
      assert.ok(isWindowsImage(binary), 'the program is a Windows (MZ) image');
      assert.ok(!fs.existsSync(installed(NATIVE)), 'nothing is installed for Linux');
    });

    test('a component is cross-built and installed as a DLL with its import library', async () => {
      installWindowsLibraries();
      const project = await scaffold('component', 'wincomp');
      await openIn(project);

      await vscode.commands.executeCommand('the-seed.buildWindows');

      assertSucceeded('Build succeeded.');
      const dll = installed(WINDOWS, 'bin', 'libwincomp-0.dll');
      assert.ok(fs.existsSync(dll), `${dll} must exist`);
      assert.ok(isWindowsImage(dll), 'the library is a Windows (MZ) image');
      assert.ok(fs.existsSync(installed(WINDOWS, 'lib', 'libwincomp.dll.a')), 'the import library is installed');
      assert.ok(fs.existsSync(installed(WINDOWS, 'lib', 'pkgconfig', 'wincomp.pc')), 'the pkg-config description is installed');
    });

    test('without the Windows libraries the build fails at configure and installs nothing', async () => {
      const project = await scaffold('program', 'nolibsprog');
      await openIn(project);

      await vscode.commands.executeCommand('the-seed.buildWindows');

      assert.strictEqual(error.callCount, 1, 'one error is shown');
      assert.match(String(error.firstCall.args[0]), /^Build failed at configure/);
      assert.ok(!info.calledWith('Build succeeded.'), 'success must not be reported');
      assert.ok(!fs.existsSync(installed(WINDOWS, 'bin', 'nolibsprog.exe')), 'nothing is installed');
      assert.strictEqual(getOperationLock().active, false, 'the operation lock is released');
    });
  });

  suite('Build Windows recursively', () => {
    requireTool('x86_64-w64-mingw32-g++', 'install g++-mingw-w64-x86-64');

    test('a component the program declares is cross-built first and both are installed', async () => {
      installWindowsLibraries();
      const component = await scaffold('component', 'winbase');
      const program = await scaffold('program', 'winrec');
      declareDependency(program, component, 'winbase');
      await openIn(program);

      await vscode.commands.executeCommand('the-seed.buildWindowsRecursive');

      assertSucceeded('Recursive build complete: 2 projects built.');
      assert.ok(isWindowsImage(installed(WINDOWS, 'bin', 'winrec.exe')), 'the program is installed');
      assert.ok(isWindowsImage(installed(WINDOWS, 'bin', 'libwinbase-0.dll')), 'the component is installed');
    });
  });
});

/** Fails each case of the enclosing suite, with the installation hint, when the program is missing. */
function requireTool(program: string, hint: string): void {
  setup(() => {
    requireProgram(program, hint);
  });
}
