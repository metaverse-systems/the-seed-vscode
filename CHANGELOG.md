# Change Log

All notable changes to the "the-seed-vscode" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.2] - 2026-02-15

### Added
- **Check Dependencies** command — verify libecs-cpp and libthe-seed installation status via `pkg-config` for native or Windows targets (Command Palette + webview)
- **Install Dependencies** command — clone and build missing dependencies from source with real-time output streaming, progress notification, and cancellation support (Command Palette + webview)
- **Dependencies sidebar section** — auto-checks on render, per-library status indicators (✓/⚠), target selector dropdown, Check and Install action buttons
- Shared operation lock for mutual exclusion between build and install operations
- Dependency status tracking and replay for late-joining webview panels
- Install progress tracking with per-step streaming updates

### Changed
- Refactored build commands to use shared operation lock instead of module-level variable
- Builds now report operation type in mutual exclusion warnings (build vs install)

## [Unreleased]

### Added
- **ResourcePak Add Resource** command — register files as resources from Command Palette and webview sidebar
- **ResourcePak Build** command — build ResourcePaks into `.pak` binaries from Command Palette and webview sidebar
- **ResourcePaks sidebar section** — collapsible section with Create, Add Resource, and Build action buttons
- Auto-detection of workspace folder as ResourcePak with info bar display
- Target scope/name selection UI when no ResourcePak is auto-detected
- Build progress indicator with building/completed/failed states
- File browse dialog integration for resource file selection
- Resource name input with validation during add-resource flow

### Changed
- Extended `the-seed` `ResourcePak.addResource()` and `build()` with optional `packageDir` parameter for explicit path support
- Fixed relative path bug in `ResourcePak.build()` that used wrong CWD for `.pak` output

### Initial
- Initial release