// ── Webview → Extension ─────────────────────────────────────

export type WebviewToExtensionMessage =
  | { command: 'ready' }
  | { command: 'getConfig'; requestId: string }
  | { command: 'savePrefix'; requestId: string; data: { prefix: string } }
  | { command: 'addScope'; requestId: string; data: ScopeFormData }
  | { command: 'confirmOverwriteScope'; requestId: string; data: ScopeFormData }
  | { command: 'editScope'; requestId: string; data: ScopeFormData }
  | { command: 'deleteScope'; requestId: string; data: { scopeName: string } }
  | { command: 'createTemplate'; requestId: string; data: TemplateFormData }
  | { command: 'startBuild'; requestId: string; data: { target: 'native' | 'windows' | 'incremental' } }
  | { command: 'cancelBuild'; requestId: string }
  | { command: 'getBuildStatus'; requestId: string }
  | { command: 'getResourcePakStatus'; requestId: string }
  | { command: 'createResourcePak'; requestId: string; data: ResourcePakFormData }
  | { command: 'browseResourceFile'; requestId: string }
  | { command: 'addResource'; requestId: string; data: AddResourceData }
  | { command: 'buildResourcePak'; requestId: string; data: BuildResourcePakData }
  | { command: 'checkDependencies'; requestId: string; data: { target: 'native' | 'windows' } }
  | { command: 'installDependencies'; requestId: string; data: { target: 'native' | 'windows' } }
  | { command: 'cancelInstallDependencies'; requestId: string }
  | { command: 'getDependencyStatus'; requestId: string };

export interface ScopeFormData {
  scopeName: string;
  authorName: string;
  authorEmail: string;
  authorUrl: string;
}

export interface TemplateFormData {
  templateType: 'component' | 'system' | 'program';
  scopeName: string;
  templateName: string;
}

export interface ResourcePakFormData {
  scopeName: string;
  pakName: string;
}

export interface AddResourceData {
  scope: string;
  pakName: string;
  resourceName: string;
  filePath: string;
  useDetectedPak: boolean;
}

export interface BuildResourcePakData {
  scope: string;
  pakName: string;
  useDetectedPak: boolean;
}

// ── Extension → Webview ─────────────────────────────────────

export type ExtensionToWebviewMessage =
  | { type: 'configLoaded'; requestId?: string; payload: ConfigPayload }
  | { type: 'prefixSaved'; requestId: string; payload: { prefix: string } }
  | { type: 'scopeAdded'; requestId: string; payload: ConfigPayload }
  | { type: 'scopeExists'; requestId: string; payload: { scopeName: string } }
  | { type: 'scopeEdited'; requestId: string; payload: ConfigPayload }
  | { type: 'scopeDeleted'; requestId: string; payload: ConfigPayload }
  | { type: 'templateCreated'; requestId: string; payload: TemplateCreatedPayload }
  | { type: 'templateExists'; requestId: string; payload: { projectPath: string } }
  | { type: 'error'; requestId?: string; payload: { message: string } }
  | { type: 'buildStatus'; payload: BuildStatusPayload }
  | { type: 'buildStarted'; requestId: string }
  | { type: 'buildCancelled'; requestId: string }
  | { type: 'buildStatusResponse'; requestId: string; payload: BuildStatusPayload }
  | { type: 'resourcePakStatus'; requestId: string; payload: ResourcePakStatusPayload }
  | { type: 'resourcePakCreated'; requestId: string; payload: ResourcePakCreatedPayload }
  | { type: 'resourceFileBrowsed'; requestId: string; payload: ResourceFileBrowsedPayload }
  | { type: 'resourceAdded'; requestId: string; payload: ResourceAddedPayload }
  | { type: 'resourcePakBuilt'; requestId: string; payload: ResourcePakBuiltPayload }
  | { type: 'resourcePakBuildProgress'; payload: ResourcePakBuildProgressPayload }
  | { type: 'dependencyStatus'; requestId?: string; payload: DependencyStatusPayload }
  | { type: 'installDependenciesStarted'; requestId: string }
  | { type: 'installDependenciesCancelled'; requestId: string }
  | { type: 'installDependenciesProgress'; payload: InstallProgressPayload };

export interface TemplateCreatedPayload {
  projectPath: string;
  templateType: 'component' | 'system' | 'program';
  openFolder?: boolean;
}

export interface ConfigPayload {
  prefix: string;
  isDefault: boolean;
  scopes: ScopeEntry[];
}

export interface ScopeEntry {
  name: string;
  author: {
    name: string;
    email: string;
    url: string;
  };
}

// ── Build Types ─────────────────────────────────────────────

export type BuildState = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface BuildStatusPayload {
  /** Current overall state of the build */
  state: BuildState;
  /** Which build target is running ('native' | 'windows' | 'incremental') */
  target: string;
  /** Current step label */
  currentStep?: string;
  /** 1-based index of the current step */
  stepIndex?: number;
  /** Total number of steps in this build */
  totalSteps?: number;
  /** Error message if state is 'failed' */
  errorMessage?: string;
  /** ISO 8601 timestamp of last state change */
  timestamp?: string;
}

// ── ResourcePak Types ───────────────────────────────────────

export interface ResourcePakStatusPayload {
  detected: boolean;
  pakName?: string;
  scope?: string;
  displayName?: string;
  resourceCount?: number;
  packageDir?: string;
}

export interface ResourcePakCreatedPayload {
  scope: string;
  pakName: string;
  packageDir: string;
  openFolder?: boolean;
}

export interface ResourceFileBrowsedPayload {
  filePath: string | null;
  fileName: string | null;
}

export interface ResourceAddedPayload {
  resourceName: string;
  fileName: string;
  size: number;
  totalResources: number;
}

export interface ResourcePakBuiltPayload {
  pakName: string;
  pakFilePath: string;
  resourceCount: number;
}

export type ResourcePakBuildState = 'building' | 'completed' | 'failed';

export interface ResourcePakBuildProgressPayload {
  state: ResourcePakBuildState;
  currentResource?: string;
  resourceIndex?: number;
  totalResources?: number;
  errorMessage?: string;
  timestamp: string;
}

// ── Dependency Types ────────────────────────────────────────

export interface LibraryStatus {
  name: string;
  installed: boolean;
}

export interface DependencyStatusPayload {
  target: string;
  libraries: LibraryStatus[];
  checking: boolean;
  timestamp: string;
}

export type InstallState = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface InstallProgressPayload {
  state: InstallState;
  target: string;
  currentLibrary?: string;
  currentStep?: string;
  stepIndex?: number;
  totalSteps?: number;
  errorMessage?: string;
  timestamp: string;
}
