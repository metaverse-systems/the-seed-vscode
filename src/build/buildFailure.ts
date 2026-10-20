import type { BuildStatusPayload } from '../types/messages';

/** The text shown for a build step that failed. */
export function describeFailedStep(step: string, message: string): string {
  return `Build failed at ${step}: ${message}`;
}

/**
 * Maps an error that rejected a build to what the editor shows: the failed
 * status for the panel, a line for the output channel and the notification.
 */
export function describeBuildRejection(
  error: unknown,
  buildLabel: string,
  timestamp: string
): { status: BuildStatusPayload; outputLine: string; notification: string } {
  const message = error instanceof Error ? error.message : String(error);
  return {
    status: {
      state: 'failed',
      target: buildLabel,
      errorMessage: message,
      timestamp,
    },
    outputLine: `\n── Build failed: ${message} ──`,
    notification: message,
  };
}
