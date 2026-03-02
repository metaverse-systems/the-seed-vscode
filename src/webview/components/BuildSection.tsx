import React from 'react';
import { SectionLayout } from './SectionLayout';
import type { BuildStatusPayload, RecursiveBuildProgressPayload, RecursiveBuildCompletePayload } from '../../types/messages';

interface BuildSectionProps {
  buildStatus: BuildStatusPayload;
  hasProject: boolean;
  onStartBuild: (target: 'native' | 'windows' | 'incremental') => void;
  onCancelBuild: () => void;
  onStartRecursiveBuild: (target: 'native' | 'windows') => void;
  onCancelRecursiveBuild: () => void;
  recursiveBuildProgress: RecursiveBuildProgressPayload | null;
  recursiveBuildComplete: RecursiveBuildCompletePayload | null;
}

export const BuildSection: React.FC<BuildSectionProps> = ({
  buildStatus,
  hasProject,
  onStartBuild,
  onCancelBuild,
  onStartRecursiveBuild,
  onCancelRecursiveBuild,
  recursiveBuildProgress,
  recursiveBuildComplete,
}) => {
  const isRunning = buildStatus.state === 'running';
  const isDisabled = !hasProject || isRunning;

  const getStatusIndicator = () => {
    switch (buildStatus.state) {
      case 'running':
        return (
          <div className="build-status build-status--running">
            <span className="build-status-icon">⏳</span>
            <span>
              Building {buildStatus.target}
              {buildStatus.currentStep && (
                <> — Step {buildStatus.stepIndex}/{buildStatus.totalSteps}: {buildStatus.currentStep}</>
              )}
            </span>
          </div>
        );
      case 'completed':
        return (
          <div className="build-status build-status--completed">
            <span className="build-status-icon">✓</span>
            <span>Build succeeded</span>
            {buildStatus.timestamp && (
              <span className="build-timestamp">
                {new Date(buildStatus.timestamp).toLocaleTimeString()}
              </span>
            )}
          </div>
        );
      case 'failed':
        return (
          <div className="build-status build-status--failed">
            <span className="build-status-icon">✗</span>
            <span>Build failed</span>
            {buildStatus.errorMessage && (
              <span className="build-error-msg">{buildStatus.errorMessage}</span>
            )}
            {buildStatus.timestamp && (
              <span className="build-timestamp">
                {new Date(buildStatus.timestamp).toLocaleTimeString()}
              </span>
            )}
          </div>
        );
      case 'cancelled':
        return (
          <div className="build-status build-status--cancelled">
            <span className="build-status-icon">⊘</span>
            <span>Build cancelled</span>
            {buildStatus.timestamp && (
              <span className="build-timestamp">
                {new Date(buildStatus.timestamp).toLocaleTimeString()}
              </span>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <SectionLayout title="Build">
      {!hasProject && (
        <div className="build-no-project">
          No buildable project detected. Open a file in a The Seed project.
        </div>
      )}

      <div className="build-buttons">
        <vscode-button
          className="build-button"
          disabled={isDisabled || undefined}
          onClick={() => onStartBuild('native')}
        >
          {isRunning && buildStatus.target === 'native' ? 'Building...' : 'Build Native'}
        </vscode-button>

        <vscode-button
          className="build-button"
          disabled={isDisabled || undefined}
          onClick={() => onStartBuild('windows')}
        >
          {isRunning && buildStatus.target === 'windows' ? 'Building...' : 'Build Windows'}
        </vscode-button>

        <vscode-button
          className="build-button"
          appearance="secondary"
          disabled={isDisabled || undefined}
          onClick={() => onStartBuild('incremental')}
        >
          {isRunning && buildStatus.target === 'incremental' ? 'Building...' : 'Build (Incremental)'}
        </vscode-button>

        <vscode-button
          className="build-button"
          disabled={isDisabled || undefined}
          onClick={() => onStartRecursiveBuild('native')}
        >
          {isRunning && buildStatus.target === 'native (recursive)' ? 'Building...' : 'Build Native Recursive'}
        </vscode-button>

        <vscode-button
          className="build-button"
          disabled={isDisabled || undefined}
          onClick={() => onStartRecursiveBuild('windows')}
        >
          {isRunning && buildStatus.target === 'windows (recursive)' ? 'Building...' : 'Build Windows Recursive'}
        </vscode-button>
      </div>

      {isRunning && (
        <div className="build-cancel-container">
          <vscode-button
            className="build-cancel-button"
            appearance="secondary"
            onClick={buildStatus.target?.includes('recursive') ? onCancelRecursiveBuild : onCancelBuild}
          >
            Cancel Build
          </vscode-button>
        </div>
      )}

      {recursiveBuildProgress && isRunning && buildStatus.target?.includes('recursive') && (
        <div className="build-status build-status--running">
          <span className="build-status-icon">⏳</span>
          <span>
            Building {recursiveBuildProgress.currentProject}
            {' '}({recursiveBuildProgress.projectIndex + 1}/{recursiveBuildProgress.totalProjects})
            {recursiveBuildProgress.currentStep && <> — {recursiveBuildProgress.currentStep}</>}
          </span>
        </div>
      )}

      {recursiveBuildComplete && !isRunning && (
        <div className={`build-status ${recursiveBuildComplete.success ? 'build-status--completed' : 'build-status--failed'}`}>
          <span className="build-status-icon">{recursiveBuildComplete.success ? '✓' : '✗'}</span>
          <span>
            {recursiveBuildComplete.success
              ? `Recursive build complete: ${recursiveBuildComplete.completedCount} projects built`
              : recursiveBuildComplete.cancelled
                ? `Recursive build cancelled. ${recursiveBuildComplete.completedCount}/${recursiveBuildComplete.totalCount} complete`
                : `Recursive build failed on ${recursiveBuildComplete.failedProject}`
            }
          </span>
        </div>
      )}

      {getStatusIndicator()}
    </SectionLayout>
  );
};
