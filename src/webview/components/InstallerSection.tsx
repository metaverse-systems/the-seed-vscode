import React from 'react';
import { SectionLayout } from './SectionLayout';
import type { InstallerStatusPayload } from '../../types/messages';

interface InstallerSectionProps {
  installerStatus: InstallerStatusPayload;
  hasProject: boolean;
  onStartInstaller: () => void;
}

export const InstallerSection: React.FC<InstallerSectionProps> = ({
  installerStatus,
  hasProject,
  onStartInstaller,
}) => {
  const isRunning = installerStatus.state === 'running';
  const isDisabled = !hasProject || isRunning;

  const getStatusIndicator = () => {
    switch (installerStatus.state) {
      case 'running':
        return (
          <div className="build-status build-status--running">
            <span className="build-status-icon">⏳</span>
            <span>
              Generating installer
              {installerStatus.currentStep && (
                <> — {installerStatus.currentStep}</>
              )}
            </span>
          </div>
        );
      case 'completed':
        return (
          <div className="build-status build-status--completed">
            <span className="build-status-icon">✓</span>
            <span>
              Installer generated
              {installerStatus.outputFile && (
                <>: {installerStatus.outputFile}</>
              )}
            </span>
            {installerStatus.timestamp && (
              <span className="build-timestamp">
                {new Date(installerStatus.timestamp).toLocaleTimeString()}
              </span>
            )}
          </div>
        );
      case 'failed':
        return (
          <div className="build-status build-status--failed">
            <span className="build-status-icon">✗</span>
            <span>Installer generation failed</span>
            {installerStatus.errorMessage && (
              <span className="build-error-msg">{installerStatus.errorMessage}</span>
            )}
            {installerStatus.timestamp && (
              <span className="build-timestamp">
                {new Date(installerStatus.timestamp).toLocaleTimeString()}
              </span>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <SectionLayout title="Installer">
      {!hasProject && (
        <div className="build-no-project">
          Configure project first to enable installer generation.
        </div>
      )}

      <div className="build-buttons">
        <vscode-button
          className="build-button"
          disabled={isDisabled || undefined}
          onClick={onStartInstaller}
        >
          {isRunning ? 'Generating...' : 'Generate Windows Installer'}
        </vscode-button>
      </div>

      {getStatusIndicator()}
    </SectionLayout>
  );
};
