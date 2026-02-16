import React from 'react';
import { SectionLayout } from './SectionLayout';
import type { DependencyStatusPayload, InstallProgressPayload } from '../../types/messages';

interface DependenciesSectionProps {
  nativeStatus: DependencyStatusPayload | null;
  windowsStatus: DependencyStatusPayload | null;
  isCheckingNative: boolean;
  isCheckingWindows: boolean;
  isInstalling: boolean;
  installProgress: InstallProgressPayload | null;
  installError: string | null;
  hasConfig: boolean;
  onCheck: (target: 'native' | 'windows') => void;
  onInstall: (target: 'native' | 'windows') => void;
  onCancelInstall: () => void;
}

export const DependenciesSection: React.FC<DependenciesSectionProps> = ({
  nativeStatus,
  windowsStatus,
  isCheckingNative,
  isCheckingWindows,
  isInstalling,
  installProgress,
  installError,
  hasConfig,
  onCheck,
  onInstall,
  onCancelInstall,
}) => {
  const allInstalled = (status: DependencyStatusPayload | null) =>
    (status?.libraries.length ?? 0) > 0 && status!.libraries.every((lib) => lib.installed);

  const hasMissing = (status: DependencyStatusPayload | null) =>
    status?.libraries.some((lib) => !lib.installed) ?? false;

  const bothFullyInstalled =
    allInstalled(nativeStatus) && allInstalled(windowsStatus);

  const getLibraryStatusIcon = (installed: boolean) =>
    installed ? '✓' : '⚠';

  const getLibraryStatusClass = (installed: boolean) =>
    installed ? 'dep-status--installed' : 'dep-status--missing';

  const installingTarget = installProgress?.target as 'native' | 'windows' | undefined;

  const renderTargetGroup = (
    label: string,
    target: 'native' | 'windows',
    status: DependencyStatusPayload | null,
    isChecking: boolean
  ) => {
    const isInstallingThis = isInstalling && installingTarget === target;
    const isCheckDisabled = !hasConfig || isChecking || isInstalling;
    const isInstallDisabled = !hasConfig || !hasMissing(status) || isInstalling || isChecking;

    return (
      <div className="dep-target-group">
        <h3 className="dep-target-label">{label}</h3>

        {isChecking && (
          <div className="dep-checking">
            <span className="dep-spinner">⏳</span>
            <span>Checking…</span>
          </div>
        )}

        {!isChecking && status && (
          <div className="dep-status-list">
            {status.libraries.map((lib) => (
              <div
                key={lib.name}
                className={`dep-status-row ${getLibraryStatusClass(lib.installed)}`}
              >
                <span className="dep-status-icon">{getLibraryStatusIcon(lib.installed)}</span>
                <span className="dep-status-name">{lib.name}</span>
                <span className="dep-status-label">
                  {lib.installed ? 'installed' : 'missing'}
                </span>
              </div>
            ))}
            {status.timestamp && (
              <div className="dep-timestamp">
                Last checked: {new Date(status.timestamp).toLocaleTimeString()}
              </div>
            )}
          </div>
        )}

        {isInstallingThis && installProgress && (
          <div className="dep-install-progress">
            <span className="dep-spinner">⏳</span>
            <span>
              Installing{installProgress.currentLibrary ? ` ${installProgress.currentLibrary}` : ''}
              {installProgress.currentStep ? ` — ${installProgress.currentStep}` : ''}
              {installProgress.stepIndex && installProgress.totalSteps
                ? ` (${installProgress.stepIndex}/${installProgress.totalSteps})`
                : ''}
            </span>
          </div>
        )}

        <div className="dep-buttons">
          <vscode-button
            disabled={isCheckDisabled || undefined}
            onClick={() => onCheck(target)}
          >
            {isChecking ? 'Checking…' : 'Check'}
          </vscode-button>

          {!isInstallingThis ? (
            <vscode-button
              disabled={isInstallDisabled || undefined}
              onClick={() => onInstall(target)}
            >
              Install
            </vscode-button>
          ) : (
            <vscode-button
              appearance="secondary"
              onClick={onCancelInstall}
            >
              Cancel
            </vscode-button>
          )}
        </div>
      </div>
    );
  };

  return (
    <SectionLayout title="Dependencies" defaultCollapsed={bothFullyInstalled}>
      {!hasConfig && (
        <div className="dep-no-config">
          No configuration found. Configure a prefix to check dependencies.
        </div>
      )}

      {installError && (
        <div className="dep-error">
          <span className="dep-error-icon">✗</span>
          <span>{installError}</span>
        </div>
      )}

      {renderTargetGroup('Native', 'native', nativeStatus, isCheckingNative)}
      {renderTargetGroup('Windows', 'windows', windowsStatus, isCheckingWindows)}
    </SectionLayout>
  );
};
