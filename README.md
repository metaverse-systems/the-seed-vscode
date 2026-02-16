# The Seed VSCode Extension

[![VSCode Marketplace](https://img.shields.io/badge/VSCode-Extension-blue.svg?style=flat-square)](https://marketplace.visualstudio.com/)

This **VSCode extension** provides tools for working with [@metaverse-systems/the-seed](https://github.com/metaverse-systems/the-seed), an ECS-based game framework. It allows you to create and manage **ResourcePaks**, configure project settings, and interact with `The Seed` ecosystem directly from VSCode.

## 🚀 Features

- **Create ResourcePaks** — scaffold new resource packages within a scope
- **Add Resource** — register files as resources in a ResourcePak (Command Palette + sidebar)
- **Build ResourcePak** — compile a ResourcePak into a `.pak` binary (Command Palette + sidebar)
- **ResourcePaks Sidebar Section** — collapsible webview section with Create, Add Resource, and Build actions; auto-detects workspace ResourcePaks
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

## 🛠️ Development & Debugging
- Run `npm run compile` to bundle the extension.
- Use `vsce package` to package it for publishing.

## 📄 License
MIT License © [Metaverse Systems](https://github.com/metaverse-systems)

---

🔹 **Contributions & Issues**  
Found a bug or have a feature request? Open an issue on [GitHub](https://github.com/metaverse-systems/the-seed-vscode/issues).
