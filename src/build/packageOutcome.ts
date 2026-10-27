import type { PackageResult } from '@metaverse-systems/the-seed/types';
import type { PackageStatusPayload } from '../types/messages';

/**
 * Maps the result of a packaging run into `outputDir` to the final status sent to the panel.
 */
export function packageStatusFrom(result: PackageResult, timestamp: string, outputDir: string): PackageStatusPayload {
  if (result.success) {
    return {
      state: 'completed',
      filesCopied: result.fileCount,
      totalFiles: result.fileCount,
      outputDir,
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
 * Builds the notification shown when a packaging run into `outputDir` ends.
 */
export function packageNotification(result: PackageResult, outputDir: string): { kind: 'info' | 'error'; text: string } {
  if (result.success) {
    return { kind: 'info', text: `Packaged ${result.fileCount} files into ${outputDir}` };
  }
  const firstLine = (result.message ?? '').split('\n')[0];
  return { kind: 'error', text: firstLine ? `Packaging failed: ${firstLine}` : 'Packaging failed' };
}
