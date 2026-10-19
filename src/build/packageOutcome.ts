import type { PackageResult } from '@metaverse-systems/the-seed/dist/types';
import type { PackageStatusPayload } from '../types/messages';

/**
 * Maps the result of a packaging run to the final status sent to the panel.
 */
export function packageStatusFrom(result: PackageResult, timestamp: string): PackageStatusPayload {
  if (result.success) {
    return {
      state: 'completed',
      filesCopied: result.fileCount,
      totalFiles: result.fileCount,
      timestamp,
    };
  }
  return {
    state: 'failed',
    errorMessage: result.message ?? 'Packaging failed',
    filesCopied: 0,
    timestamp,
  };
}

/**
 * Builds the notification shown when a packaging run ends.
 */
export function packageNotification(result: PackageResult): { kind: 'info' | 'error'; text: string } {
  if (result.success) {
    return { kind: 'info', text: `Packaged ${result.fileCount} files into dist/` };
  }
  const firstLine = (result.message ?? '').split('\n')[0];
  return { kind: 'error', text: firstLine ? `Packaging failed: ${firstLine}` : 'Packaging failed' };
}
