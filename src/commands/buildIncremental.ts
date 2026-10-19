// Build Incremental command handler
// This is a thin wrapper — the actual implementation is in buildNative.ts
// which exports buildIncrementalCommand() through Build.buildProject without a target
export { buildIncrementalCommand } from './buildNative';
