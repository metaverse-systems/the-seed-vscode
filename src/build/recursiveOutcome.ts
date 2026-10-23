import type { BuildStatusPayload, RecursiveBuildCompletePayload } from '../types/messages';
import type { ToolApi } from '../tool/toolApi';

/**
 * Maps an error thrown while discovering the projects of a recursive build to the
 * payloads of a failed build. Returns null for anything that is not a discovery error.
 */
export function discoveryFailure(
  error: unknown,
  target: 'native' | 'windows',
  timestamp: string,
  tool: ToolApi
): { status: BuildStatusPayload; complete: RecursiveBuildCompletePayload; message: string } | null {
  if (!(error instanceof tool.DependencyDiscoveryError)) {
    return null;
  }
  return {
    status: {
      state: 'failed',
      target: `${target} (recursive)`,
      errorMessage: error.message,
      timestamp,
    },
    complete: { success: false, completedCount: 0, totalCount: 0 },
    message: error.message,
  };
}
