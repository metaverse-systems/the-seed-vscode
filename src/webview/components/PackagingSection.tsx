import React from 'react';
import { SectionLayout } from './SectionLayout';
import type { PackageStatusPayload } from '../../types/messages';

interface PackagingSectionProps {
  packageStatus: PackageStatusPayload;
  hasProject: boolean;
  onStartPackage: () => void;
}

export const PackagingSection: React.FC<PackagingSectionProps> = ({
  packageStatus,
  hasProject,
  onStartPackage,
}) => {
  const isRunning = packageStatus.state === 'running';
  const isDisabled = !hasProject || isRunning;

  const getStatusIndicator = () => {
    switch (packageStatus.state) {
      case 'running':
        return (
          <div className="build-status build-status--running">
            <span className="build-status-icon">⏳</span>
            <span>
              Packaging
              {packageStatus.currentFile && (
                <> — {packageStatus.currentFile}</>
              )}
              {packageStatus.filesCopied !== undefined && (
                <> ({packageStatus.filesCopied} files)</>
              )}
            </span>
          </div>
        );
      case 'completed':
        return (
          <div className="build-status build-status--completed">
            <span className="build-status-icon">✓</span>
            <span>
              Packaged {packageStatus.filesCopied ?? packageStatus.totalFiles ?? 0} files into dist/
            </span>
            {packageStatus.timestamp && (
              <span className="build-timestamp">
                {new Date(packageStatus.timestamp).toLocaleTimeString()}
              </span>
            )}
          </div>
        );
      case 'failed':
        return (
          <div className="build-status build-status--failed">
            <span className="build-status-icon">✗</span>
            <span>Packaging failed</span>
            {packageStatus.errorMessage && (
              <span className="build-error-msg">{packageStatus.errorMessage}</span>
            )}
            {packageStatus.timestamp && (
              <span className="build-timestamp">
                {new Date(packageStatus.timestamp).toLocaleTimeString()}
              </span>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <SectionLayout title="Packaging">
      {!hasProject && (
        <div className="build-no-project">
          Configure project first to enable packaging.
        </div>
      )}

      <div className="build-buttons">
        <vscode-button
          className="build-button"
          disabled={isDisabled || undefined}
          onClick={onStartPackage}
        >
          {isRunning ? 'Packaging...' : 'Package'}
        </vscode-button>
      </div>

      {getStatusIndicator()}
    </SectionLayout>
  );
};
