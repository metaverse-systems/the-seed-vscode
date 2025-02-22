# The Seed VSCode Extension

[![VSCode Marketplace](https://img.shields.io/badge/VSCode-Extension-blue.svg?style=flat-square)](https://marketplace.visualstudio.com/)

This **VSCode extension** provides tools for working with [@metaverse-systems/the-seed](https://github.com/metaverse-systems/the-seed), an ECS-based game framework. It allows you to create and manage **ResourcePaks**, configure project settings, and interact with `The Seed` ecosystem directly from VSCode.

## 🚀 Features

- **Create ResourcePaks**
- **Manage The Seed project configuration**

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
3. Follow the on-screen prompts.

## 🛠️ Development & Debugging
- Run `npm run compile` to bundle the extension.
- Use `vsce package` to package it for publishing.

## 📄 License
MIT License © [Metaverse Systems](https://github.com/metaverse-systems)

---

🔹 **Contributions & Issues**  
Found a bug or have a feature request? Open an issue on [GitHub](https://github.com/metaverse-systems/the-seed-vscode/issues).
