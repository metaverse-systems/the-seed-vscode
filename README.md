# The Seed

The Seed brings the [the-seed](https://github.com/metaverse-systems/the-seed) tool into VS Code. From the editor you configure an installation prefix and scopes, create component, system and program projects and resource paks, install the libraries they need, build them for Linux and Windows, sign and verify files, package a project with its shared libraries and generate a Windows installer. The extension does not bundle the tool: it uses the the-seed tool installed on your machine, and every operation is the tool's own.

## Requirements

- VS Code 1.143 or later.
- The the-seed tool, version 2.1.0 or a later 2.x, installed globally with npm (see Installation).
- The system packages listed in the tool's [Prerequisites](https://github.com/metaverse-systems/the-seed#prerequisites): Node.js and npm, a C++ compiler and `make`, autotools, `pkg-config`, `curl` and `git`.
- Optionally, for Windows programs, the MinGW cross-compiler ([Windows cross-compilation](https://github.com/metaverse-systems/the-seed#optional-windows-cross-compilation)), and for Windows installers, `wixl` ([MSI installer generation](https://github.com/metaverse-systems/the-seed#optional-windows-msi-installer-generation)).

## Installation

Install in this order, which follows the tool's own [Installation](https://github.com/metaverse-systems/the-seed#installation) steps:

1. Install the system packages from the tool's [Prerequisites](https://github.com/metaverse-systems/the-seed#prerequisites), for example on Debian or Ubuntu:

   ```sh
   sudo apt install build-essential libtool pkg-config autoconf automake curl git
   ```

2. Install the tool:

   ```sh
   npm install -g --foreground-scripts @metaverse-systems/the-seed@2
   ```

   On a fresh machine npm reports that the tool's native component was not built, because the libraries it needs are not installed yet. The installation still succeeds; step 6 builds the component.
3. Install the extension, from the extension store or from a package: download `the-seed-vscode-<version>.vsix` from the [releases page](https://github.com/metaverse-systems/the-seed-vscode/releases) and run

   ```sh
   code --install-extension the-seed-vscode-<version>.vsix
   ```

4. Run **The Seed: Configure Project** to set the installation prefix (or keep the default), then **The Seed: Add Scope** to create a scope with its author details.
5. Run **The Seed: Install Dependencies** and choose `native` to install libecs-cpp and libthe-seed into the prefix for Linux. Run it again with `windows` if you build for Windows (this needs the MinGW cross-compiler).
6. Build the tool's native component, now that the libraries are installed:

   ```sh
   cd "$(npm root -g)/@metaverse-systems/the-seed" && npm run build-addon
   ```

7. Run **The Seed: Check Tool**.

The extension looks for the tool in the global npm installation, then through the `the-seed` command on the path. If the tool is installed somewhere else, set **the-seed.toolPath** to its package directory, its `the-seed` command, or a path inside it; leave the setting empty to use the global installation. **The Seed: Check Tool** looks again and reports the version found, where it is and how it was found (the setting, the global installation or the command on the path). When the tool is missing, older than 2.1.0, a 3.x or later, or cannot be loaded, it says so with the command that installs a supported version, and the other commands show the same message instead of running until a usable tool is found.

## Windows

Use the extension with its host in WSL: install the [WSL extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-wsl), open a folder in WSL, and install the tool and the extension inside WSL as above. There every operation works as on Linux.

On Windows without WSL, configuration, scopes, templates, resource paks, detached signatures and certificates work. The operations that need the tool's native component do not, and stop with the tool's message: Build Windows (plain and recursive), signing Windows or Mac programs and installers, Package Projects and Generate Windows Installer. Verify Signature reports an embedded signature of a Windows or Mac program or installer as not checked, with the same message. Builds and dependency installation also need the GNU build tools (autotools, `make`, `pkg-config`), which on Windows means WSL.

## The sidebar

The Seed's view in the activity bar has these sections:

- **Configuration**: the tool's status, with a button to check again or open the **the-seed.toolPath** setting; the installation prefix, which you can edit and save; the scopes, which you can add, edit and delete.
- **Dependencies**: whether libecs-cpp and libthe-seed are installed for Linux and for Windows, with a Check button for each target and an Install button that streams the installation's output and can be cancelled. The last status of each target is kept while the window is open, so reopening the view shows it without checking again.
- **Templates**: creates a component, system or program project, or a resource pak, in a scope, in the open folder or in a folder you choose.
- **Build**: builds the project of the active file, or one you choose, for Linux or Windows, incrementally, or recursively with every project it depends on first; a running build can be cancelled.
- **ResourcePaks**: for the resource pak in the open folder, or one you choose, adds a file as a resource and builds the `.pak` file.
- **Packaging**: copies the open project's programs and the shared libraries they load into its `dist/` directory, showing the tool's progress.
- **Installer**: generates a Windows `.msi` installer for the open project, showing the tool's progress.

## The explorer menu

Right-click one or more files in the explorer for **The Seed: Sign File** and **The Seed: Verify Signature**. They act on every file chosen: Windows and Mac programs and installers get or are checked for an embedded signature, other files a detached signature next to them.

## Commands

All commands are in the Command Palette under "The Seed". Needs says what a command needs before it can do its work, and Where says where else it is offered.

<!-- commands -->
| Command | Needs | Where |
|---|---|---|
| The Seed: Check Tool | nothing | Palette, Sidebar |
| The Seed: Configure Project | nothing | Palette, Sidebar |
| The Seed: Show Config | nothing | Palette |
| The Seed: List Scopes | nothing | Palette |
| The Seed: Add Scope | nothing | Palette, Sidebar |
| The Seed: Edit Scope | scope | Palette, Sidebar |
| The Seed: Delete Scope | scope | Palette, Sidebar |
| The Seed: Create Component Template | scope | Palette, Sidebar |
| The Seed: Create System Template | scope | Palette, Sidebar |
| The Seed: Create Program Template | scope | Palette, Sidebar |
| The Seed: Create ResourcePak | scope | Palette, Sidebar |
| The Seed: ResourcePak Add Resource | open project (a resource pak, open or chosen), selected file | Palette, Sidebar |
| The Seed: ResourcePak Build | open project (a resource pak, open or chosen) | Palette, Sidebar |
| The Seed: Check Dependencies | prefix | Palette, Sidebar |
| The Seed: Install Dependencies | prefix; the GNU build tools, and the MinGW cross-compiler for Windows | Palette, Sidebar |
| The Seed: Build Native | open project (of the active file, or chosen), libraries installed for Linux | Palette, Sidebar |
| The Seed: Build Windows | open project (of the active file, or chosen), libraries installed for Windows, MinGW cross-compiler, native component | Palette, Sidebar |
| The Seed: Build (Incremental) | open project that was built before; native component when it produces Windows programs | Palette, Sidebar |
| The Seed: Build Native (Recursive) | open project (of the active file, or chosen), libraries installed for Linux | Palette, Sidebar |
| The Seed: Build Windows (Recursive) | open project (of the active file, or chosen), libraries installed for Windows, MinGW cross-compiler, native component | Palette, Sidebar |
| The Seed: Package Projects | open project that was built, prefix, native component | Palette, Sidebar |
| The Seed: Generate Windows Installer | wixl, native component, prefix, open project built for Windows | Palette, Sidebar |
| The Seed: Create Signing Certificate | scope | Palette |
| The Seed: Import Signing Certificate | scope, selected file (the certificate and its key) | Palette |
| The Seed: Export Signing Certificate | certificate | Palette |
| The Seed: Signing Certificate Info | certificate | Palette |
| The Seed: Sign File | certificate, selected file; native component for Windows and Mac programs and installers | Palette, Explorer menu |
| The Seed: Verify Signature | selected file; native component to check embedded signatures of Windows and Mac programs and installers | Palette, Explorer menu |
<!-- /commands -->

Results and the tool's output go to the "The Seed" output channel. Long operations (builds, dependency installation, packaging and the installer) run one at a time; starting another while one runs is refused with a message naming the one running.

## Development

### A fresh clone

```sh
git clone https://github.com/metaverse-systems/the-seed-vscode.git
cd the-seed-vscode
npm ci
npm run build
npm run lint
npm test
```

`npm ci` installs the tool at the version pinned in `devDependencies` from the public registry and builds its native component; no checkout of the tool next to this one is needed. `npm test` needs `xvfb` on Linux. Open the folder in VS Code and press F5 ("Run Extension") to start an Extension Development Host with the extension loaded.

### Running the checks

Prerequisites: run `npm ci`, which installs the tool at the version in `devDependencies` from the public registry and builds its native component (the tests use that copy unless `THE_SEED_TEST_TOOL` names another installation, see Working with the tool below); on Linux, install `xvfb`: the runner always starts the editor under `xvfb-run -a` with X11 forced, even on a desktop session, so no window appears. Set `THE_SEED_TEST_VISIBLE=1` to use the real display instead.

```sh
npm test                 # clean, compile, typecheck, lint, bundle, then the host suite
npm run compile          # clean, then compile into out/
npm run typecheck        # sidebar type-check
npm run lint             # fails on any warning, .ts and .tsx
npm test -- host         # host suite only (needs compile and bundle)
npm run bundle           # host bundle (dist/extension.js) and sidebar bundle (dist/webview)
npm run build            # clean, compile, type-check, host and sidebar bundles
```

Use `npm test` rather than `npx vscode-test`: the runner supplies a scratch home, checks the results file, validates the known-gap list and reports totals. Every suite runs in scratch state, and the real `~/the-seed` is checked unchanged afterwards (`REAL HOME CHANGED:` fails the run).

The suite includes real builds: cases scaffold a project and run Build Native and Build Windows (plain and recursive) through the extension, so they need a C++ toolchain, autotools, the MinGW cross compiler (`g++-mingw-w64-x86-64`, with the POSIX threads flavour selected) and libecs-cpp and libthe-seed installed for Linux and for Windows. Set `THE_SEED_TEST_DEPS` to the directory they are installed under: the Linux libraries in `lib/pkgconfig` (or `x86_64-linux-gnu/lib/pkgconfig`) and the Windows ones in `x86_64-w64-mingw32/`, as `.github/workflows/ci.yaml` builds them into `$HOME/deps`. When the variable is unset, the first `PKG_CONFIG_PATH` entry holding `ecs-cpp.pc` names the directory. A missing tool or library fails these cases with a message saying what to install.

Options for the host suite go after a second `--`:

```sh
npm test -- host -- --reverse                                   # run files in reverse order
npm test -- host -- --only out/test/commands/signingCommands.test.js
npm test -- host -- --repeat 10                                 # run the suite repeatedly
```

Known gaps and platform skips are recorded, never silent:

- A case that fails today because of a recorded defect is marked with `knownGapTest` and listed in `src/test/harness/knownGaps.ts` (an id, the finding, the change that fixes it, a failure-message signature). It is counted as a known gap while it fails with that signature. Once it passes, the run fails with `STALE KNOWN GAP:` until the marker and the entry are removed, so remove both in the change that fixes the defect.
- A case that cannot run on a platform uses `requires(...)` (or `onPlatform`); the capabilities and their reasons are in `src/test/harness/platform.ts`. Each skip prints `PLATFORM SKIP:` with its reason. `this.skip()` anywhere else fails the run (`SILENT SKIP:`). Remove a `requires` call when the platform gains the capability.

The editor version is pinned in `.vscode-test.mjs` and must equal `VSCODE_VERSION` in `.github/workflows/ci.yaml`; change both together. The workflow runs the checks on `ubuntu-24.04` and, for Windows, on `windows-2025` inside WSL (Ubuntu-24.04), because that is how the extension is used on Windows (the editor on Windows, the extension host in WSL). Require the checks `check (ubuntu-24.04)` and `check (windows-2025, WSL Ubuntu-24.04)` on the main branch. The platform skips above describe a native Windows host; the hosted checks do not exercise them, and a native Windows run is not a supported way to run this suite yet.

No line-level ESLint disables are used.

### Watching and debugging

- Run `npm run watch` while developing ("Run Extension" starts it): it rebuilds `dist/extension.js` with source maps on every change. It does not build the sidebar: run `npm run build:webview` (writes `dist/webview`) once, and again after changing `src/webview/`. Run `npm run build` for a full build.
- Run `npm run package` to package it for publishing; it needs nothing installed globally (see Packaging below).

### Packaging

After `npm ci`, `npm run package` builds the extension from a clean output directory and produces `the-seed-vscode-<version>.vsix` in the extension root. It fails on any packaging warning or error, a runtime dependency (libraries are bundled or development dependencies), an editor range (`engines.vscode`) that differs from the tested editor version in `.vscode-test.mjs`, or a file list that differs from `EXPECTED_PACKAGE_FILES` in `src/test/harness/packageContents.ts`. Install the package with `code --install-extension the-seed-vscode-<version>.vsix`.

### Working with the tool

The tool is a separate install that the extension uses at run time: `npm install -g --foreground-scripts @metaverse-systems/the-seed@2`. The extension finds it in the global npm installation, then through the `the-seed` command on the path. The `the-seed.toolPath` setting names another installation (its package directory, its `the-seed` command, or a path inside it), and **The Seed: Check Tool** rechecks it and reports what was found. The tool is a development-only dependency here (exactly `2.1.0` in `devDependencies`), used for its types and by the tests; it is never shipped.

To run the extension against a local checkout of the tool:

- In the tool's checkout, build it and run `npm link`; the global installation then points at the checkout. Or set `the-seed.toolPath` to the checkout in the Extension Development Host.
- For type changes made in both repositories together, run `npm link @metaverse-systems/the-seed` here. Run `npm ci` to undo it and return to the registry copy.
- To run the tests against a checkout (or the global installation), set `THE_SEED_TEST_TOOL` to its package directory, for example `THE_SEED_TEST_TOOL=$(realpath ../the-seed) npm test`. The default is the `devDependencies` copy in `node_modules`.

## License

[MIT](https://github.com/metaverse-systems/the-seed-vscode/blob/main/LICENSE) © [Metaverse Systems](https://github.com/metaverse-systems)

## Issues

Found a bug or have a feature request? Open an issue on [GitHub](https://github.com/metaverse-systems/the-seed-vscode/issues).
