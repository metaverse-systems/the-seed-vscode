import React, { useEffect, useRef, useState } from 'react';
import { getVsCodeApi } from './hooks/useVsCodeApi';
import { ConfigurationSection } from './components/ConfigurationSection';
import { DependenciesSection } from './components/DependenciesSection';
import { TemplatesSection } from './components/TemplatesSection';
import { BuildSection } from './components/BuildSection';
import { ResourcePakSection } from './components/ResourcePakSection';
import { PackagingSection } from './components/PackagingSection';
import { InstallerSection } from './components/InstallerSection';
import type {
  ExtensionToWebviewMessage,
  ConfigPayload,
  ScopeFormData,
  BuildStatusPayload,
  ResourcePakStatusPayload,
  ResourcePakBuildProgressPayload,
  DependencyStatusPayload,
  InstallProgressPayload,
  PackageStatusPayload,
  InstallerStatusPayload,
  RecursiveBuildProgressPayload,
  RecursiveBuildCompletePayload,
  ToolStatusPayload,
  WebviewToExtensionMessage,
} from '../types/messages';
import { errorPlacement } from './logic/errorPlacement';
import type { SectionArea } from './logic/errorPlacement';
import '@vscode-elements/elements';

const vscode = getVsCodeApi();

/** Posts a section's request and records that section as the one waiting for its answer. */
function postRequest(
  pending: Map<string, SectionArea>,
  area: SectionArea,
  message: Extract<WebviewToExtensionMessage, { requestId: string }>
): void {
  pending.set(message.requestId, area);
  vscode.postMessage(message);
}

const CHECKING_TOOL: ToolStatusPayload = {
  state: 'checking',
  usable: false,
  message: 'Looking for the the-seed tool.',
  location: undefined,
  version: undefined,
  foundThrough: undefined,
  required: '2.0.0',
  setting: 'the-seed.toolPath',
};

export const App: React.FC = () => {
  const [config, setConfig] = useState<ConfigPayload | null>(null);
  const [toolStatus, setToolStatus] = useState<ToolStatusPayload>(CHECKING_TOOL);
  const wasUsable = useRef(false);
  // The section that sent each request still waiting for an answer.
  const pendingRequests = useRef(new Map<string, SectionArea>());
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

  // Recursive Build state
  const [recursiveBuildProgress, setRecursiveBuildProgress] = useState<RecursiveBuildProgressPayload | null>(null);
  const [recursiveBuildComplete, setRecursiveBuildComplete] = useState<RecursiveBuildCompletePayload | null>(null);

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

  // Package state
  const [packageStatus, setPackageStatus] = useState<PackageStatusPayload>({ state: 'idle', timestamp: new Date().toISOString() });

  // Installer state
  const [installerStatus, setInstallerStatus] = useState<InstallerStatusPayload>({ state: 'idle', timestamp: new Date().toISOString() });

  useEffect(() => {
    const handleMessage = (event: MessageEvent<ExtensionToWebviewMessage>) => {
      const message = event.data;
      switch (message.type) {
        case 'configLoaded':
          setConfig(message.payload);
          setError(null);
          break;
        case 'toolStatus':
          setToolStatus(message.payload);
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
          {
            const text = message.payload.hint
              ? `${message.payload.message} ${message.payload.hint}`
              : message.payload.message;
            const area = errorPlacement(message.requestId, pendingRequests.current);
            if (area === 'banner') {
              setError(text);
            } else if (area === 'templates') {
              setTemplateCreating(false);
              setTemplateError(text);
            } else if (area === 'resourcePak') {
              setResourcePakLoading(false);
              setResourcePakError(text);
            } else {
              setIsCheckingNative(false);
              setIsCheckingWindows(false);
              setInstallError(text);
            }
            if (message.payload.code === 'toolUnavailable') {
              // A refused request never produces its normal answer; end what was waiting for one.
              setIsCheckingNative(false);
              setIsCheckingWindows(false);
              setIsInstalling(false);
              setInstallError(text);
            }
          }
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
        case 'recursiveBuildProgress':
          setRecursiveBuildProgress(message.payload);
          break;
        case 'recursiveBuildComplete':
          setRecursiveBuildComplete(message.payload);
          setRecursiveBuildProgress(null);
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
          postRequest(pendingRequests.current, 'resourcePak', {
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
          // A run has started, from here or the command palette; the last run's progress no longer applies.
          setIsInstalling(true);
          setInstallError(null);
          setInstallProgress(null);
          break;
        case 'installDependenciesCancelled':
          setIsInstalling(false);
          setInstallProgress(null);
          break;
        case 'installDependenciesProgress':
          setInstallProgress(message.payload);
          if (message.payload.state === 'running') {
            setIsInstalling(true);
          } else if (message.payload.state === 'completed') {
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
        case 'packageStatus':
          setPackageStatus(message.payload);
          break;
        case 'packageStarted':
          // Acknowledged — status updates come via packageStatus pushes
          break;
        case 'packageStatusResponse':
          setPackageStatus(message.payload);
          break;
        case 'installerStatus':
          setInstallerStatus(message.payload);
          break;
      }
      // An answer, error or not, ends the wait for its request.
      const answered = (message as { requestId?: string }).requestId;
      if (answered !== undefined) {
        pendingRequests.current.delete(answered);
      }
    };

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ command: 'ready' });
    postRequest(pendingRequests.current, 'resourcePak', {
      command: 'getResourcePakStatus',
      requestId: crypto.randomUUID(),
    });
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Once the tool is usable, load the configuration again. The extension checks the dependencies itself.
  useEffect(() => {
    if (toolStatus.usable && !wasUsable.current) {
      vscode.postMessage({ command: 'getConfig', requestId: crypto.randomUUID() });
    }
    wasUsable.current = toolStatus.usable;
  }, [toolStatus.usable]);

  const handleToolAction = (action: 'openToolSetting' | 'checkTool') => {
    if (action === 'checkTool') {
      vscode.postMessage({ command: 'checkTool', requestId: crypto.randomUUID() });
    } else {
      vscode.postMessage({ command: 'openToolSetting' });
    }
  };

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
    postRequest(pendingRequests.current, 'templates', {
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

  const handleStartRecursiveBuild = (target: 'native' | 'windows') => {
    setRecursiveBuildComplete(null);
    setRecursiveBuildProgress(null);
    vscode.postMessage({
      command: 'startRecursiveBuild',
      requestId: crypto.randomUUID(),
      data: { target },
    });
  };

  const handleCancelRecursiveBuild = () => {
    vscode.postMessage({
      command: 'cancelRecursiveBuild',
      requestId: crypto.randomUUID(),
    });
  };

  // ResourcePak handlers
  const handleCreateResourcePak = (scopeName: string, pakName: string) => {
    setResourcePakLoading(true);
    setResourcePakError(null);
    setResourcePakCreateSuccess(null);
    postRequest(pendingRequests.current, 'resourcePak', {
      command: 'createResourcePak',
      requestId: crypto.randomUUID(),
      data: { scopeName, pakName },
    });
  };

  const handleBrowseResourceFile = () => {
    setResourcePakLoading(true);
    setBrowsedFilePath(null);
    setBrowsedFileName(null);
    postRequest(pendingRequests.current, 'resourcePak', {
      command: 'browseResourceFile',
      requestId: crypto.randomUUID(),
    });
  };

  const handleAddResource = (resourceName: string, filePath: string) => {
    setResourcePakLoading(true);
    setResourcePakError(null);
    postRequest(pendingRequests.current, 'resourcePak', {
      command: 'addResource',
      requestId: crypto.randomUUID(),
      data: { resourceName, filePath },
    });
  };

  const handleBuildResourcePak = () => {
    setResourcePakLoading(true);
    setResourcePakError(null);
    setResourcePakActionSuccess(null);
    setResourcePakBuildProgress(null);
    postRequest(pendingRequests.current, 'resourcePak', {
      command: 'buildResourcePak',
      requestId: crypto.randomUUID(),
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
    postRequest(pendingRequests.current, 'dependencies', {
      command: 'checkDependencies',
      requestId: crypto.randomUUID(),
      data: { target },
    });
  };

  // The command reports the run's start, steps and outcome; until then nothing is shown running.
  const handleInstallDependencies = (target: 'native' | 'windows') => {
    setInstallError(null);
    postRequest(pendingRequests.current, 'dependencies', {
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

  const handleStartPackage = () => {
    vscode.postMessage({
      command: 'startPackage',
      requestId: crypto.randomUUID(),
    });
  };

  const handleStartInstaller = () => {
    vscode.postMessage({
      command: 'generateInstaller',
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
        toolStatus={toolStatus}
        onToolAction={handleToolAction}
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
        configState={config === null ? 'loading' : 'loaded'}
        onStartBuild={handleStartBuild}
        onCancelBuild={handleCancelBuild}
        onStartRecursiveBuild={handleStartRecursiveBuild}
        onCancelRecursiveBuild={handleCancelRecursiveBuild}
        recursiveBuildProgress={recursiveBuildProgress}
        recursiveBuildComplete={recursiveBuildComplete}
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
      <div className="section-divider" />
      <PackagingSection
        packageStatus={packageStatus}
        hasProject={config !== null && config.prefix !== ''}
        onStartPackage={handleStartPackage}
      />
      <div className="section-divider" />
      <InstallerSection
        installerStatus={installerStatus}
        hasProject={config !== null && config.prefix !== ''}
        onStartInstaller={handleStartInstaller}
      />
    </div>
  );
};
