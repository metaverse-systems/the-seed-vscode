import type { ToolStatusPayload } from '../types/messages';
import type { LookupReport, ToolCandidate } from './resolveTool';
import { INSTALL_COMMAND, REQUIRED_TOOL_VERSION, SUPPORTED_RANGE_TEXT, TOOL_PACKAGE_NAME, TOOL_SETTING } from './requiredVersion';

export type ToolState = 'checking' | 'usable' | 'notFound' | 'notTheTool' | 'tooOld' | 'tooNew' | 'notLoadable' | 'reloadRequired';

/** What the last check found, and the text that says so. */
export interface ToolStatus {
  state: ToolState;
  /** The installation in use, or the one that failed. */
  installation: ToolCandidate | undefined;
  /** The other candidates the lookup found. */
  others: ToolCandidate[];
  report: LookupReport;
  /** First line of the error that stopped the tool from loading. */
  loadError: string | undefined;
  /** The version loaded before the installation changed under the running window. */
  previousVersion: string | undefined;
  message: string;
  /** `state|location|version`; a notice is shown once per key. */
  key: string;
}

const MAJOR = REQUIRED_TOOL_VERSION.split('.')[0];

function howFound(candidate: ToolCandidate): string {
  switch (candidate.foundThrough) {
    case 'setting':
      return `the "${TOOL_SETTING}" setting`;
    case 'global':
      return `the global installation (${candidate.detail})`;
    default:
      return `the the-seed command on the path (${candidate.detail})`;
  }
}

function alsoFound(status: ToolStatus): string {
  if (status.installation?.foundThrough === 'setting' || status.report.settingValue !== undefined) {
    return '';
  }
  const other = status.others.find((candidate) => candidate.verdict === 'compatible');
  if (!other) {
    return '';
  }
  return ` Also found the-seed ${other.version} at ${other.packageDir} (through ${howFound(other)}); set "${TOOL_SETTING}" to "${other.packageDir}" to use it.`;
}

/** The text of a status, built from the version constants. */
export function describeToolStatus(status: ToolStatus): string {
  const found = status.installation;
  const location = found?.packageDir ?? '';
  const how = found ? howFound(found) : '';
  const version = found?.version;

  switch (status.state) {
    case 'checking':
      return 'Looking for the the-seed tool.';
    case 'usable':
      return `Using the-seed ${version} at ${location} (found through ${how}).`;
    case 'notFound':
      return `The the-seed tool was not found. Looked in: ${status.report.looked.join('; ')}. `
        + `This extension needs the-seed ${SUPPORTED_RANGE_TEXT}. Install it with: ${INSTALL_COMMAND}. `
        + `If it is installed somewhere else, set "${TOOL_SETTING}" to its directory.`;
    case 'notTheTool':
      return `The "${TOOL_SETTING}" setting is "${status.report.settingValue ?? ''}", which is not the the-seed tool: ${status.report.settingProblem ?? 'it could not be used'}. `
        + `Set it to the directory of an installed ${TOOL_PACKAGE_NAME} ${SUPPORTED_RANGE_TEXT}, or clear it to use the global installation. `
        + `Install the tool with: ${INSTALL_COMMAND}.`;
    case 'tooOld':
      return `The the-seed tool at ${location} (found through ${how}) is version ${version}; this extension needs ${SUPPORTED_RANGE_TEXT}. `
        + `Update it with: ${INSTALL_COMMAND}.${alsoFound(status)}`;
    case 'tooNew':
      return `The the-seed tool at ${location} (found through ${how}) is version ${version}; this extension supports ${MAJOR}.x (${REQUIRED_TOOL_VERSION} or later). `
        + `Install a ${MAJOR}.x tool with: ${INSTALL_COMMAND}, or update the extension.${alsoFound(status)}`;
    case 'notLoadable':
      return `The the-seed tool at ${location} (found through ${how}, version ${version ?? 'unknown'}) could not be loaded: ${status.loadError ?? 'unknown error'}. `
        + `Reinstall it with: ${INSTALL_COMMAND}.${alsoFound(status)}`;
    default:
      return `The the-seed tool at ${location} changed from ${status.previousVersion ?? 'an earlier version'} to ${version ?? 'an unreadable version'} while this window was open. `
        + `Reload the window to use it. This extension needs ${SUPPORTED_RANGE_TEXT}.`;
  }
}

/** `state|location|version`, the location being the setting value when there is no installation. */
export function statusKey(state: ToolState, installation: ToolCandidate | undefined, report: LookupReport): string {
  const location = installation?.packageDir ?? (state === 'notTheTool' ? report.settingValue ?? '' : '');
  return `${state}|${location}|${installation?.version ?? ''}`;
}

/** The form of a status that is sent to the sidebar. */
export function toToolStatusPayload(status: ToolStatus): ToolStatusPayload {
  return {
    state: status.state,
    usable: status.state === 'usable',
    message: status.message,
    location: status.installation?.packageDir,
    version: status.installation?.version,
    foundThrough: status.installation?.foundThrough,
    required: REQUIRED_TOOL_VERSION,
    setting: TOOL_SETTING,
  };
}
