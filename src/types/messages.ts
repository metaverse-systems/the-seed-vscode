// ── Webview → Extension ─────────────────────────────────────

export type WebviewToExtensionMessage =
  | { command: 'ready' }
  | { command: 'getConfig'; requestId: string }
  | { command: 'savePrefix'; requestId: string; data: { prefix: string } }
  | { command: 'addScope'; requestId: string; data: ScopeFormData }
  | { command: 'confirmOverwriteScope'; requestId: string; data: ScopeFormData }
  | { command: 'editScope'; requestId: string; data: ScopeFormData }
  | { command: 'deleteScope'; requestId: string; data: { scopeName: string } };

export interface ScopeFormData {
  scopeName: string;
  authorName: string;
  authorEmail: string;
  authorUrl: string;
}

// ── Extension → Webview ─────────────────────────────────────

export type ExtensionToWebviewMessage =
  | { type: 'configLoaded'; requestId?: string; payload: ConfigPayload }
  | { type: 'prefixSaved'; requestId: string; payload: { prefix: string } }
  | { type: 'scopeAdded'; requestId: string; payload: ConfigPayload }
  | { type: 'scopeExists'; requestId: string; payload: { scopeName: string } }
  | { type: 'scopeEdited'; requestId: string; payload: ConfigPayload }
  | { type: 'scopeDeleted'; requestId: string; payload: ConfigPayload }
  | { type: 'error'; requestId?: string; payload: { message: string } };

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
