/** The one place the supported tool version is stated. */
export const REQUIRED_TOOL_VERSION = '2.1.1';

const REQUIRED_MAJOR = REQUIRED_TOOL_VERSION.split('.')[0];

export const TOOL_PACKAGE_NAME = '@metaverse-systems/the-seed';
export const TOOL_SETTING = 'the-seed.toolPath';

/** The versions the extension supports, as written in messages. */
export const SUPPORTED_RANGE_TEXT = `${REQUIRED_TOOL_VERSION} or a later ${REQUIRED_MAJOR}.x`;

/** How a user installs a supported tool. */
export const INSTALL_COMMAND = `npm install -g --foreground-scripts ${TOOL_PACKAGE_NAME}@${REQUIRED_MAJOR}`;

export type VersionVerdict = 'compatible' | 'tooOld' | 'tooNew' | 'unparsable';

interface ParsedVersion {
  core: [number, number, number];
  prerelease: string[];
}

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseVersion(text: string): ParsedVersion | undefined {
  const match = VERSION_PATTERN.exec(text);
  if (!match) {
    return undefined;
  }
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  };
}

const isNumeric = (identifier: string): boolean => /^\d+$/.test(identifier);

function compareIdentifiers(left: string, right: string): number {
  const leftNumeric = isNumeric(left);
  const rightNumeric = isNumeric(right);
  if (leftNumeric && rightNumeric) {
    return Math.sign(Number(left) - Number(right));
  }
  if (leftNumeric !== rightNumeric) {
    // Numeric identifiers rank below alphanumeric ones.
    return leftNumeric ? -1 : 1;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

function comparePrerelease(left: string[], right: string[]): number {
  // A version with a prerelease ranks below the same version without one.
  if (left.length === 0 || right.length === 0) {
    return left.length === right.length ? 0 : left.length === 0 ? 1 : -1;
  }
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index++) {
    const order = compareIdentifiers(left[index], right[index]);
    if (order !== 0) {
      return order;
    }
  }
  // A shorter set ranks lower when everything before it is equal.
  return Math.sign(left.length - right.length);
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  for (let index = 0; index < 3; index++) {
    if (left.core[index] !== right.core[index]) {
      return left.core[index] < right.core[index] ? -1 : 1;
    }
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

const REQUIRED = parseVersion(REQUIRED_TOOL_VERSION) as ParsedVersion;

/** Sorts a tool version into the extension's support policy. */
export function classifyVersion(version: string): VersionVerdict {
  const parsed = parseVersion(version);
  if (!parsed) {
    return 'unparsable';
  }
  if (parsed.core[0] > REQUIRED.core[0]) {
    return 'tooNew';
  }
  return compareVersions(parsed, REQUIRED) < 0 ? 'tooOld' : 'compatible';
}
