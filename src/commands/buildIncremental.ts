// Build Incremental command handler
// This is a thin wrapper — the actual implementation is in buildNative.ts
// which exports buildIncrementalCommand() using Build.getSteps('native', false)
export { buildIncrementalCommand } from './buildNative';
