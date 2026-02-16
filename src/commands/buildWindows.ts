// Build Windows command handler
// This is a thin wrapper — the actual implementation is in buildNative.ts
// which exports buildWindowsCommand() using Build.getSteps('windows', true)
export { buildWindowsCommand } from './buildNative';
