import React, { useEffect, useState } from 'react';
import { getVsCodeApi } from './hooks/useVsCodeApi';
import { ConfigurationSection } from './components/ConfigurationSection';
import { DependenciesSection } from './components/DependenciesSection';
import { TemplatesSection } from './components/TemplatesSection';
import { BuildSection } from './components/BuildSection';
import { ResourcePakSection } from './components/ResourcePakSection';
import type {
  ExtensionToWebviewMessage,
  ConfigPayload,
  ScopeFormData,
  BuildStatusPayload,
  ResourcePakStatusPayload,
  ResourcePakBuildProgressPayload,
  DependencyStatusPayload,
  InstallProgressPayload,
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

  // Build state
  const [buildStatus, setBuildStatus] = useState<BuildStatusPayload>({ state: 'idle', target: '' });

  // ResourcePak state
  const [resourcePakStatus, setResourcePakStatus] = useState<ResourcePakStatusPayload | null>(null);
  const [resourcePakLoading, setResourcePakLoading] = useState(false);
  const [resourcePakError, setResourcePakError] = useState<string | null>(null);
  const [resourcePakCreateSuccess, setResourcePakCreateSuccess] = useState<string | null>(null);
  const [resourcePakActionSuccess, setResourcePakActionSuccess] = useState<string | null>(null);
  const [resourcePakBuildProgress, setResourcePakBuildProgress] = useState<ResourcePakBuildProgressPayload | null>(null);
  const [browsedFilePath, setBrowsedFilePath] = useState<string | null>(null);
  const [browsedFileName, setBrowsedFileName] = useState<string | null>(null);

  // Dependency state (per-target)
  const [nativeDepStatus, setNativeDepStatus] = useState<DependencyStatusPayload | null>(null);
  const [windowsDepStatus, setWindowsDepStatus] = useState<DependencyStatusPayload | null>(null);
  const [isCheckingNative, setIsCheckingNative] = useState(false);
  const [isCheckingWindows, setIsCheckingWindows] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState<InstallProgressPayload | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

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
          setResourcePakLoading(false);
          setResourcePakError(message.payload.message);
          break;
        case 'buildStatus':
          setBuildStatus(message.payload);
          break;
        case 'buildStarted':
          // Acknowledged — status updates come via buildStatus pushes
          break;
        case 'buildCancelled':
          // Acknowledged — status updates come via buildStatus pushes
          break;
        case 'buildStatusResponse':
          setBuildStatus(message.payload);
          break;
        case 'resourcePakStatus':
          setResourcePakStatus(message.payload);
          setResourcePakLoading(false);
          break;
        case 'resourcePakCreated':
          setResourcePakLoading(false);
          setResourcePakCreateSuccess(
            `ResourcePak '${message.payload.pakName}' created in scope '${message.payload.scope}'`
          );
          setResourcePakError(null);
          break;
        case 'resourceFileBrowsed':
          setBrowsedFilePath(message.payload.filePath);
          setBrowsedFileName(message.payload.fileName);
          setResourcePakLoading(false);
          break;
        case 'resourceAdded':
          setResourcePakLoading(false);
          setResourcePakActionSuccess(
            `Resource '${message.payload.resourceName}' added (${message.payload.totalResources} total)`
          );
          setResourcePakError(null);
          setBrowsedFilePath(null);
          setBrowsedFileName(null);
          // Refresh status to get updated resource count
          vscode.postMessage({
            command: 'getResourcePakStatus',
            requestId: crypto.randomUUID(),
          });
          break;
        case 'resourcePakBuilt':
          setResourcePakLoading(false);
          setResourcePakActionSuccess(
            `ResourcePak built: ${message.payload.pakFilePath}`
          );
          break;
        case 'resourcePakBuildProgress':
          setResourcePakBuildProgress(message.payload);
          if (message.payload.state === 'failed') {
            setResourcePakLoading(false);
          }
          break;
        case 'dependencyStatus':
          if (message.payload.target === 'native') {
            setNativeDepStatus(message.payload);
            setIsCheckingNative(false);
          } else {
            setWindowsDepStatus(message.payload);
            setIsCheckingWindows(false);
          }
          // If install was running and we get a status update, it means auto-refresh after install
          if (isInstalling) {
            setIsInstalling(false);
            setInstallProgress(null);
          }
          break;
        case 'installDependenciesStarted':
          setIsInstalling(true);
          setInstallError(null);
          break;
        case 'installDependenciesCancelled':
          setIsInstalling(false);
          setInstallProgress(null);
          break;
        case 'installDependenciesProgress':
          setInstallProgress(message.payload);
          if (message.payload.state === 'completed') {
            setIsInstalling(false);
            setInstallError(null);
          } else if (message.payload.state === 'failed') {
            setIsInstalling(false);
            setInstallError(message.payload.errorMessage ?? 'Installation failed');
          } else if (message.payload.state === 'cancelled') {
            setIsInstalling(false);
            setInstallProgress(null);
          }
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ command: 'ready' });
    vscode.postMessage({
      command: 'getResourcePakStatus',
      requestId: crypto.randomUUID(),
    });
    // Auto-check dependencies for both targets on mount
    vscode.postMessage({
      command: 'checkDependencies',
      requestId: crypto.randomUUID(),
      data: { target: 'native' },
    });
    vscode.postMessage({
      command: 'checkDependencies',
      requestId: crypto.randomUUID(),
      data: { target: 'windows' },
    });

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

  const handleStartBuild = (target: 'native' | 'windows' | 'incremental') => {
    vscode.postMessage({
      command: 'startBuild',
      requestId: crypto.randomUUID(),
      data: { target },
    });
  };

  const handleCancelBuild = () => {
    vscode.postMessage({
      command: 'cancelBuild',
      requestId: crypto.randomUUID(),
    });
  };

  // ResourcePak handlers
  const handleCreateResourcePak = (scopeName: string, pakName: string) => {
    setResourcePakLoading(true);
    setResourcePakError(null);
    setResourcePakCreateSuccess(null);
    vscode.postMessage({
      command: 'createResourcePak',
      requestId: crypto.randomUUID(),
      data: { scopeName, pakName },
    });
  };

  const handleBrowseResourceFile = () => {
    setResourcePakLoading(true);
    setBrowsedFilePath(null);
    setBrowsedFileName(null);
    vscode.postMessage({
      command: 'browseResourceFile',
      requestId: crypto.randomUUID(),
    });
  };

  const handleAddResource = (
    scope: string,
    pakName: string,
    resourceName: string,
    filePath: string,
    useDetectedPak: boolean
  ) => {
    setResourcePakLoading(true);
    setResourcePakError(null);
    vscode.postMessage({
      command: 'addResource',
      requestId: crypto.randomUUID(),
      data: { scope, pakName, resourceName, filePath, useDetectedPak },
    });
  };

  const handleBuildResourcePak = (
    scope: string,
    pakName: string,
    useDetectedPak: boolean
  ) => {
    setResourcePakLoading(true);
    setResourcePakError(null);
    setResourcePakActionSuccess(null);
    setResourcePakBuildProgress(null);
    vscode.postMessage({
      command: 'buildResourcePak',
      requestId: crypto.randomUUID(),
      data: { scope, pakName, useDetectedPak },
    });
  };

  // Dependency handlers
  const handleCheckDependencies = (target: 'native' | 'windows') => {
    if (target === 'native') {
      setIsCheckingNative(true);
    } else {
      setIsCheckingWindows(true);
    }
    setInstallError(null);
    vscode.postMessage({
      command: 'checkDependencies',
      requestId: crypto.randomUUID(),
      data: { target },
    });
  };

  const handleInstallDependencies = (target: 'native' | 'windows') => {
    setIsInstalling(true);
    setInstallError(null);
    setInstallProgress(null);
    vscode.postMessage({
      command: 'installDependencies',
      requestId: crypto.randomUUID(),
      data: { target },
    });
  };

  const handleCancelInstallDependencies = () => {
    vscode.postMessage({
      command: 'cancelInstallDependencies',
      requestId: crypto.randomUUID(),
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
      <DependenciesSection
        nativeStatus={nativeDepStatus}
        windowsStatus={windowsDepStatus}
        isCheckingNative={isCheckingNative}
        isCheckingWindows={isCheckingWindows}
        isInstalling={isInstalling}
        installProgress={installProgress}
        installError={installError}
        hasConfig={config !== null && config.prefix !== ''}
        onCheck={handleCheckDependencies}
        onInstall={handleInstallDependencies}
        onCancelInstall={handleCancelInstallDependencies}
      />
      <div className="section-divider" />
      <TemplatesSection
        scopes={config?.scopes ?? []}
        onCreateTemplate={handleCreateTemplate}
        onCreateResourcePak={handleCreateResourcePak}
        loading={templateCreating}
        success={templateSuccess}
        error={templateError}
        existsWarning={templateExistsWarning}
        resourcePakSuccess={resourcePakCreateSuccess}
        resourcePakError={resourcePakError}
        onDismissSuccess={() => setTemplateSuccess(null)}
        onDismissError={() => setTemplateError(null)}
        onDismissWarning={() => setTemplateExistsWarning(null)}
        onDismissResourcePakSuccess={() => setResourcePakCreateSuccess(null)}
        onDismissResourcePakError={() => setResourcePakError(null)}
      />
      <div className="section-divider" />
      <BuildSection
        buildStatus={buildStatus}
        hasProject={config !== null}
        onStartBuild={handleStartBuild}
        onCancelBuild={handleCancelBuild}
      />
      <div className="section-divider" />
      <ResourcePakSection
        status={resourcePakStatus}
        loading={resourcePakLoading}
        error={resourcePakError}
        success={resourcePakActionSuccess}
        buildProgress={resourcePakBuildProgress}
        onBrowseResourceFile={handleBrowseResourceFile}
        onAddResource={handleAddResource}
        onBuildResourcePak={handleBuildResourcePak}
        onDismissError={() => setResourcePakError(null)}
        onDismissSuccess={() => setResourcePakActionSuccess(null)}
        browsedFilePath={browsedFilePath}
        browsedFileName={browsedFileName}
      />
    </div>
  );
};
