# The Seed VSCode Extension

[![VSCode Marketplace](https://img.shields.io/badge/VSCode-Extension-blue.svg?style=flat-square)](https://marketplace.visualstudio.com/)

This **VSCode extension** provides tools for working with [@metaverse-systems/the-seed](https://github.com/metaverse-systems/the-seed), an ECS-based game framework. It allows you to create and manage **ResourcePaks**, configure project settings, and interact with `The Seed` ecosystem directly from VSCode.

## 🚀 Features

- **Create ResourcePaks** — scaffold new resource packages within a scope
- **Add Resource** — register files as resources in a ResourcePak (Command Palette + sidebar)
- **Build ResourcePak** — compile a ResourcePak into a `.pak` binary (Command Palette + sidebar)
- **ResourcePaks Sidebar Section** — collapsible webview section with Create, Add Resource, and Build actions; auto-detects workspace ResourcePaks
- **Check Dependencies** — verify libecs-cpp and libthe-seed installation status (Command Palette + sidebar)
- **Install Dependencies** — clone and build missing dependencies with streaming output, cancellation, and progress (Command Palette + sidebar)
- **Dependencies Sidebar Section** — auto-checks on render, per-library status indicators, target selector, Check and Install actions
- **Package Projects** — resolve project binaries and transitive shared-library dependencies into a flat `dist/` directory (Command Palette + sidebar)
- **Packaging Sidebar Section** — Package button with inline progress, success indicator with file count, and failure indicator with error details
- **Generate Windows Installer** — generate `.msi` installer packages from cross-compiled Windows binaries (Command Palette + sidebar)
- **Installer Sidebar Section** — Generate button with progress, success indicator with output filename, and failure indicator with error details
- **Configure Project** — set or update the project prefix path
- **Add Scope** — create a new scope with author metadata
- **Edit Scope** — update author details on an existing scope
- **Delete Scope** — remove a scope with confirmation dialog
- **List Scopes** — view all scope names and author details
- **Show Config** — view full configuration (prefix + all scopes)

## 📦 Installation

### From VSCode Marketplace _(Recommended)_
_Coming soon_

### Manual Installation (Development)
1. Clone the repository:
   ```sh
   git clone git@github.com:metaverse-systems/the-seed-vscode.git
   cd the-seed-vscode
   ```
2. Install dependencies:
   ```sh
   npm install
   ```
3. Launch the extension:
   ```sh
   code .
   ```
   - Press `F5` to open a **new VSCode window** with the extension loaded.

## 📌 Usage

### **1️⃣ Create a ResourcePak**
1. Open the **Command Palette** (`Ctrl + Shift + P` / `Cmd + Shift + P`).
2. Search for:
   ```
   The Seed: Create ResourcePak
   ```
3. Select a **scope** → Enter a **ResourcePak name** → Confirm.
4. The project is created as `<name>` in the open folder, or in a folder you choose when none is open; nothing is created under the installation prefix.

### **2️⃣ Configure The Seed**
1. Open the **Command Palette**.
2. Run:
   ```
   The Seed: Configure Project
   ```
3. Enter your prefix path (e.g., `/home/user/the-seed`) and press Enter.

### **3️⃣ Add a Scope**
1. Open the **Command Palette**.
2. Run:
   ```
   The Seed: Add Scope
   ```
3. Enter the scope name, author name, email, and URL when prompted.

### **4️⃣ List Scopes**
1. Open the **Command Palette**.
2. Run:
   ```
   The Seed: List Scopes
   ```
3. View all configured scopes in the **Output** panel ("The Seed" channel).

### **5️⃣ Show Configuration**
1. Open the **Command Palette**.
2. Run:
   ```
   The Seed: Show Config
   ```
3. View the full configuration (prefix + all scopes) in the **Output** panel.

### **6️⃣ Edit a Scope**
1. Open the **Command Palette**.
2. Run:
   ```
   The Seed: Edit Scope
   ```
3. Select a scope from the picker, then update the author fields.

### **7️⃣ Delete a Scope**
1. Open the **Command Palette**.
2. Run:
   ```
   The Seed: Delete Scope
   ```
3. Select a scope, then confirm deletion in the modal dialog.

## 📋 Commands Reference

| Command | Description |
|---------|-------------|
| `The Seed: Create ResourcePak` | Create a new resource package in a scope |
| `The Seed: ResourcePak Add Resource` | Add a file as a resource to a ResourcePak |
| `The Seed: ResourcePak Build` | Build a ResourcePak into a `.pak` binary |
| `The Seed: Configure Project` | Set or update the project prefix path |
| `The Seed: Add Scope` | Create a new scope with author metadata |
| `The Seed: Edit Scope` | Update author details on an existing scope |
| `The Seed: Delete Scope` | Remove a scope (with confirmation) |
| `The Seed: List Scopes` | View all scope names and author details |
| `The Seed: Show Config` | View full config (prefix + all scopes) |
| `The Seed: Check Dependencies` | Check libecs-cpp and libthe-seed installation for a target |
| `The Seed: Install Dependencies` | Clone and build missing dependencies for a target |
| `The Seed: Package Projects` | Package project binaries and dependencies into `dist/` |
| `The Seed: Generate Windows Installer` | Generate a Windows `.msi` installer from `dist/` files |

**Installer prerequisites**: `sudo apt install msitools` (provides `wixl`)

## Running the checks

Prerequisites: run `npm ci`; the tool must be resolvable as `@metaverse-systems/the-seed` (the sibling `../the-seed` checkout, built with its native component, or a global install linked into `node_modules`); on Linux, install `xvfb`: the runner always starts the editor under `xvfb-run -a` with X11 forced, even on a desktop session, so no window appears. Set `THE_SEED_TEST_VISIBLE=1` to use the real display instead.

```sh
npm test                 # compile, typecheck, lint, then the host suite
npm run compile          # one stage
npm run typecheck        # sidebar type-check
npm run lint             # fails on any warning, .ts and .tsx
npm test -- host         # host suite only (needs compile)
npm run build            # compile, type-check and sidebar bundle
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

- A case that fails today because of a defect recorded in a review is marked with `knownGapTest` and listed in `src/test/harness/knownGaps.ts` (id, review finding, the roadmap task that fixes it, a failure-message signature). It is counted as a known gap while it fails with that signature. Once it passes, the run fails with `STALE KNOWN GAP:` until the marker and the entry are removed, so remove both in the change that fixes the defect.
- A case that cannot run on a platform uses `requires(...)` (or `onPlatform`); the capabilities and their reasons are in `src/test/harness/platform.ts`. Each skip prints `PLATFORM SKIP:` with its reason. `this.skip()` anywhere else fails the run (`SILENT SKIP:`). Remove a `requires` call when the platform gains the capability.

The editor version is pinned in `.vscode-test.mjs` and must equal `VSCODE_VERSION` in `.github/workflows/ci.yaml`; change both together. The workflow runs the checks on `ubuntu-24.04` and, for Windows, on `windows-2025` inside WSL (Ubuntu-24.04), because that is how the extension is used on Windows (the editor on Windows, the extension host in WSL). Require the checks `check (ubuntu-24.04)` and `check (windows-2025, WSL Ubuntu-24.04)` on the main branch. The platform skips above describe a native Windows host; the hosted checks do not exercise them, and a native Windows run is not a supported way to run this suite yet.

No line-level ESLint disables are used.

## 🛠️ Development & Debugging
- Run `npm run compile` to bundle the extension.
- Use `vsce package` to package it for publishing.

## 📄 License
MIT License © [Metaverse Systems](https://github.com/metaverse-systems)

---

🔹 **Contributions & Issues**  
Found a bug or have a feature request? Open an issue on [GitHub](https://github.com/metaverse-systems/the-seed-vscode/issues).
