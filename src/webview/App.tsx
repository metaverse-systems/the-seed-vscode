import React, { useEffect, useState } from 'react';
import { getVsCodeApi } from './hooks/useVsCodeApi';
import { ConfigurationSection } from './components/ConfigurationSection';
import { TemplatesSection } from './components/TemplatesSection';
import type {
  ExtensionToWebviewMessage,
  ConfigPayload,
  ScopeFormData,
} from '../types/messages';
import '@vscode-elements/elements';

const vscode = getVsCodeApi();

export const App: React.FC = () => {
  const [config, setConfig] = useState<ConfigPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingOverwrite, setPendingOverwrite] = useState<string | null>(null);
  const [pendingOverwriteData, setPendingOverwriteData] = useState<ScopeFormData | null>(null);

  // Template state
  const [templateCreating, setTemplateCreating] = useState(false);
  const [templateSuccess, setTemplateSuccess] = useState<{ message: string; path: string } | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templateExistsWarning, setTemplateExistsWarning] = useState<string | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<ExtensionToWebviewMessage>) => {
      const message = event.data;
      switch (message.type) {
        case 'configLoaded':
          setConfig(message.payload);
          setError(null);
          break;
        case 'prefixSaved':
          setConfig((prev) =>
            prev ? { ...prev, prefix: message.payload.prefix } : prev
          );
          setError(null);
          break;
        case 'scopeAdded':
        case 'scopeEdited':
        case 'scopeDeleted':
          setConfig(message.payload);
          setPendingOverwrite(null);
          setPendingOverwriteData(null);
          setError(null);
          break;
        case 'scopeExists':
          setPendingOverwrite(message.payload.scopeName);
          break;
        case 'templateCreated':
          setTemplateCreating(false);
          setTemplateSuccess({
            message: `${message.payload.templateType.charAt(0).toUpperCase() + message.payload.templateType.slice(1)} created successfully`,
            path: message.payload.projectPath,
          });
          setTemplateError(null);
          setTemplateExistsWarning(null);
          break;
        case 'templateExists':
          setTemplateCreating(false);
          setTemplateExistsWarning(message.payload.projectPath);
          break;
        case 'error':
          setError(message.payload.message);
          setTemplateCreating(false);
          setTemplateError(message.payload.message);
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ command: 'ready' });

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleSavePrefix = (prefix: string) => {
    vscode.postMessage({
      command: 'savePrefix',
      requestId: crypto.randomUUID(),
      data: { prefix },
    });
  };

  const handleAddScope = (data: ScopeFormData) => {
    setPendingOverwriteData(data);
    vscode.postMessage({
      command: 'addScope',
      requestId: crypto.randomUUID(),
      data,
    });
  };

  const handleConfirmOverwriteScope = (data: ScopeFormData) => {
    vscode.postMessage({
      command: 'confirmOverwriteScope',
      requestId: crypto.randomUUID(),
      data,
    });
  };

  const handleEditScope = (data: ScopeFormData) => {
    vscode.postMessage({
      command: 'editScope',
      requestId: crypto.randomUUID(),
      data,
    });
  };

  const handleDeleteScope = (scopeName: string) => {
    vscode.postMessage({
      command: 'deleteScope',
      requestId: crypto.randomUUID(),
      data: { scopeName },
    });
  };

  const handleCancelOverwrite = () => {
    setPendingOverwrite(null);
    setPendingOverwriteData(null);
  };

  const handleCreateTemplate = (
    templateType: 'component' | 'system' | 'program',
    scopeName: string,
    templateName: string
  ) => {
    setTemplateCreating(true);
    setTemplateError(null);
    setTemplateExistsWarning(null);
    vscode.postMessage({
      command: 'createTemplate',
      requestId: crypto.randomUUID(),
      data: { templateType, scopeName, templateName },
    });
  };

  return (
    <div className="app-container">
      {error && (
        <div className="error-banner" role="alert">
          <span className="error-icon">⚠</span>
          <span>{error}</span>
          <button
            className="error-dismiss"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}
      <ConfigurationSection
        config={config}
        onSavePrefix={handleSavePrefix}
        onAddScope={handleAddScope}
        onConfirmOverwriteScope={() => {
          if (pendingOverwriteData) {
            handleConfirmOverwriteScope(pendingOverwriteData);
          }
        }}
        onEditScope={handleEditScope}
        onDeleteScope={handleDeleteScope}
        pendingOverwrite={pendingOverwrite}
        onCancelOverwrite={handleCancelOverwrite}
      />
      <div className="section-divider" />
      <TemplatesSection
        scopes={config?.scopes ?? []}
        onCreateTemplate={handleCreateTemplate}
        loading={templateCreating}
        success={templateSuccess}
        error={templateError}
        existsWarning={templateExistsWarning}
        onDismissSuccess={() => setTemplateSuccess(null)}
        onDismissError={() => setTemplateError(null)}
        onDismissWarning={() => setTemplateExistsWarning(null)}
      />
    </div>
  );
};
