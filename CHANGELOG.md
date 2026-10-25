# Change Log

All notable changes to The Seed extension are recorded in this file, in the format of [Keep a Changelog](https://keepachangelog.com/).

## [1.0.0] - 2026-10-24

### Added

- Configuration and scopes: set the installation prefix, and add, edit, delete and list scopes with their author details (Configure Project, Show Config, Add Scope, Edit Scope, Delete Scope, List Scopes).
- Templates: create component, system and program projects in a scope, in the open folder or a folder you choose.
- Builds: build the project of the active file, or one you choose, for Linux (Build Native) or Windows with MinGW (Build Windows), rebuild it incrementally (Build (Incremental)), or build it with every project it depends on first (Build Native (Recursive), Build Windows (Recursive)). Builds report their output and can be cancelled.
- Resource paks: create a resource pak, add files to it as resources, and build its `.pak` file.
- Dependencies: check whether libecs-cpp and libthe-seed are installed for Linux or Windows, and install the missing ones into the prefix, with the installation's output streamed as it runs, cancellation, and the last status kept for the sidebar.
- Signing: create, import, export and inspect a scope's signing certificate; sign files (embedded signatures for Windows and Mac programs and installers, detached signatures for other binary files) and verify their signatures, from the Command Palette or the explorer's context menu on one or more files.
- Packaging and installer: copy a project's programs and the shared libraries they load into its `dist/` directory (Package Projects), and generate a Windows `.msi` installer (Generate Windows Installer), with the tool's own progress in the output channel and the sidebar.
- The sidebar: Configuration, Dependencies, Templates, Build, ResourcePaks, Packaging and Installer sections.
- The tool check: the extension finds the installed the-seed tool in the global npm installation, through the `the-seed` command on the path, or at the `the-seed.toolPath` setting; The Seed: Check Tool reports the version, where it was found and whether the tool's native component is built, and an unusable tool is reported with the command that installs a supported one.

### Requirements

- The the-seed tool 2.1.1 or a later 2.x, installed globally with npm.
- VS Code 1.143 or later.
- On Windows, the extension host in WSL; without WSL the operations that need the tool's native component are unavailable.

### Notes

- The first public release. The earlier 0.x versions were never released.
