import type Build from '@metaverse-systems/the-seed/Build';
import type Config from '@metaverse-systems/the-seed/Config';
import type { ConfigError, configFilePath } from '@metaverse-systems/the-seed/Config';
import type { checkLibEcs, checkLibTheSeed, getInstallSteps, runInstallSteps } from '@metaverse-systems/the-seed/Dependencies';
import type {
  ConflictingProjectError,
  CyclicDependencyError,
  DependencyDiscoveryError,
  DiscoveryCancelledError,
  ProjectManifestError,
  walkDependencies,
} from '@metaverse-systems/the-seed/DependencyWalker';
import type { replaceResourceHint } from '@metaverse-systems/the-seed/Hints';
import type Installer from '@metaverse-systems/the-seed/Installer';
import type { NativeComponentMissingError, nativeComponentMessage } from '@metaverse-systems/the-seed/NativeComponent';
import type Package from '@metaverse-systems/the-seed/Package';
import type { ProjectError } from '@metaverse-systems/the-seed/ProjectError';
import type { buildRecursive } from '@metaverse-systems/the-seed/RecursiveBuild';
import type ResourcePak from '@metaverse-systems/the-seed/ResourcePak';
import type Scopes from '@metaverse-systems/the-seed/Scopes';
import type { validateScopeName } from '@metaverse-systems/the-seed/Scopes';
import type Signing from '@metaverse-systems/the-seed/Signing';
import type { DEFAULT_VALIDITY_DAYS, MAX_VALIDITY_DAYS } from '@metaverse-systems/the-seed/Signing';
import type Template from '@metaverse-systems/the-seed/Template';

/** The values the extension takes from the tool, all from one loaded copy. */
export interface ToolApi {
  readonly Config: typeof Config;
  readonly ConfigError: typeof ConfigError;
  readonly configFilePath: typeof configFilePath;
  readonly Scopes: typeof Scopes;
  readonly validateScopeName: typeof validateScopeName;
  readonly Template: typeof Template;
  readonly ResourcePak: typeof ResourcePak;
  readonly Signing: typeof Signing;
  readonly DEFAULT_VALIDITY_DAYS: typeof DEFAULT_VALIDITY_DAYS;
  readonly MAX_VALIDITY_DAYS: typeof MAX_VALIDITY_DAYS;
  readonly Build: typeof Build;
  readonly buildRecursive: typeof buildRecursive;
  readonly Package: typeof Package;
  readonly Installer: typeof Installer;
  readonly ProjectError: typeof ProjectError;
  readonly DependencyDiscoveryError: typeof DependencyDiscoveryError;
  readonly ConflictingProjectError: typeof ConflictingProjectError;
  readonly CyclicDependencyError: typeof CyclicDependencyError;
  readonly DiscoveryCancelledError: typeof DiscoveryCancelledError;
  readonly ProjectManifestError: typeof ProjectManifestError;
  readonly walkDependencies: typeof walkDependencies;
  readonly replaceResourceHint: typeof replaceResourceHint;
  readonly checkLibEcs: typeof checkLibEcs;
  readonly checkLibTheSeed: typeof checkLibTheSeed;
  readonly getInstallSteps: typeof getInstallSteps;
  readonly runInstallSteps: typeof runInstallSteps;
  readonly nativeComponentMessage: typeof nativeComponentMessage;
  readonly NativeComponentMissingError: typeof NativeComponentMissingError;
}

export type ExportKind = 'class' | 'function' | 'number';

export interface ExportRow {
  subpath: string;
  exportName: string;
  member: keyof ToolApi;
  kind: ExportKind;
}

const row = (subpath: string, exportName: string, member: keyof ToolApi, kind: ExportKind): ExportRow => (
  { subpath, exportName, member, kind }
);

/** Where each member of the API comes from and what kind of value it must be. */
export const EXPORT_TABLE: readonly ExportRow[] = [
  row('Config', 'default', 'Config', 'class'),
  row('Config', 'ConfigError', 'ConfigError', 'class'),
  row('Config', 'configFilePath', 'configFilePath', 'function'),
  row('Scopes', 'default', 'Scopes', 'class'),
  row('Scopes', 'validateScopeName', 'validateScopeName', 'function'),
  row('Template', 'default', 'Template', 'class'),
  row('ResourcePak', 'default', 'ResourcePak', 'class'),
  row('Signing', 'default', 'Signing', 'class'),
  row('Signing', 'DEFAULT_VALIDITY_DAYS', 'DEFAULT_VALIDITY_DAYS', 'number'),
  row('Signing', 'MAX_VALIDITY_DAYS', 'MAX_VALIDITY_DAYS', 'number'),
  row('Build', 'default', 'Build', 'class'),
  row('RecursiveBuild', 'buildRecursive', 'buildRecursive', 'function'),
  row('Package', 'default', 'Package', 'class'),
  row('Installer', 'default', 'Installer', 'class'),
  row('ProjectError', 'ProjectError', 'ProjectError', 'class'),
  row('DependencyWalker', 'DependencyDiscoveryError', 'DependencyDiscoveryError', 'class'),
  row('DependencyWalker', 'ConflictingProjectError', 'ConflictingProjectError', 'class'),
  row('DependencyWalker', 'CyclicDependencyError', 'CyclicDependencyError', 'class'),
  row('DependencyWalker', 'DiscoveryCancelledError', 'DiscoveryCancelledError', 'class'),
  row('DependencyWalker', 'ProjectManifestError', 'ProjectManifestError', 'class'),
  row('DependencyWalker', 'walkDependencies', 'walkDependencies', 'function'),
  row('Hints', 'replaceResourceHint', 'replaceResourceHint', 'function'),
  row('Dependencies', 'checkLibEcs', 'checkLibEcs', 'function'),
  row('Dependencies', 'checkLibTheSeed', 'checkLibTheSeed', 'function'),
  row('Dependencies', 'getInstallSteps', 'getInstallSteps', 'function'),
  row('Dependencies', 'runInstallSteps', 'runInstallSteps', 'function'),
  row('NativeComponent', 'nativeComponentMessage', 'nativeComponentMessage', 'function'),
  row('NativeComponent', 'NativeComponentMissingError', 'NativeComponentMissingError', 'class'),
];
