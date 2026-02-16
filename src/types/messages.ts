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
  | { command: 'getBuildStatus'; requestId: string };

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
  | { type: 'buildStatusResponse'; requestId: string; payload: BuildStatusPayload };

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
