/** The text shown when signing a file is rejected. */
export function describeSignFailure(
  error: unknown,
  timestamp: string
): { logLine: string; notification: string } {
  const message = error instanceof Error ? error.message : String(error);
  return {
    logLine: `[${timestamp}] Signing failed: ${message}`,
    notification: message,
  };
}
