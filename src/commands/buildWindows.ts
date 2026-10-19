// Build Windows command handler
// This is a thin wrapper — the actual implementation is in buildNative.ts
// which exports buildWindowsCommand() through Build.buildProject with the windows target
export { buildWindowsCommand } from './buildNative';
