// Where the sidebar shows an `error` message. Kept free of React and the DOM
// so the host test suite can run it.

/** A place on the page that can show an error. */
export type ErrorArea = 'banner' | 'templates' | 'resourcePak' | 'dependencies';

/** The sections that send requests and have an error area of their own. */
export type SectionArea = Exclude<ErrorArea, 'banner'>;

/**
 * The one area that shows an `error` message: the section that sent the request it answers, or the
 * banner for an error that answers no section's request.
 * @param requestId the request the error answers, if any
 * @param pending the section that sent each request still waiting for an answer
 */
export function errorPlacement(requestId: string | undefined, pending: ReadonlyMap<string, SectionArea>): ErrorArea {
  if (requestId === undefined) {
    return 'banner';
  }
  return pending.get(requestId) ?? 'banner';
}
