// Wording shared by the host and the page, so it holds no dependency on either.

/** "1 project" or "N projects". */
export function projectCount(count: number): string {
  return `${count} project${count === 1 ? '' : 's'}`;
}
