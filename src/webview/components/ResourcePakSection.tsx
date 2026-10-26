import React, { useState, useEffect } from 'react';
import { SectionLayout } from './SectionLayout';
import { resourcePakHint, SELECTED_FILE_LABEL } from '../logic/resourcePakForm';
import type {
  ResourcePakStatusPayload,
  ResourcePakBuildProgressPayload,
} from '../../types/messages';

interface ResourcePakSectionProps {
  status: ResourcePakStatusPayload | null;
  loading: boolean;
  error: string | null;
  success: string | null;
  buildProgress: ResourcePakBuildProgressPayload | null;
  onChooseResourcePak: () => void;
  onBrowseResourceFile: () => void;
  onAddResource: (resourceName: string, filePath: string) => void;
  onBuildResourcePak: () => void;
  onDismissError: () => void;
  onDismissSuccess: () => void;
  browsedFilePath: string | null;
  browsedFileName: string | null;
}

type ActiveAction = 'addResource' | null;

export const ResourcePakSection: React.FC<ResourcePakSectionProps> = ({
  status,
  loading,
  error,
  success,
  buildProgress,
  onChooseResourcePak,
  onBrowseResourceFile,
  onAddResource,
  onBuildResourcePak,
  onDismissError,
  onDismissSuccess,
  browsedFilePath,
  browsedFileName,
}) => {
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);
  const [resourceName, setResourceName] = useState('');
  const [resourceNameError, setResourceNameError] = useState<string | null>(null);

  // Reset to buttons view on success
  useEffect(() => {
    if (success && activeAction === 'addResource') {
      setActiveAction(null);
      setResourceName('');
      setResourceNameError(null);
    }
  }, [success]);

  // When file is browsed, proceed to name input in addResource flow
  const hasBrowsedFile = browsedFilePath !== null && activeAction === 'addResource';

  const isDetected = status?.detected === true;

  const handleAddResourceStart = () => {
    onDismissSuccess();
    onDismissError();
    setResourceName('');
    setResourceNameError(null);
    setActiveAction('addResource');
    onBrowseResourceFile();
  };

  const handleAddResourceSubmit = () => {
    if (!resourceName.trim()) {
      setResourceNameError('Resource name is required');
      return;
    }
    setResourceNameError(null);
    onAddResource(resourceName, browsedFilePath!);
  };

  const handleAddResourceCancel = () => {
    setActiveAction(null);
    setResourceName('');
    setResourceNameError(null);
    onDismissError();
  };

  const handleBuild = () => {
    onDismissSuccess();
    onDismissError();
    onBuildResourcePak();
  };

  const isBuildRunning = buildProgress?.state === 'building';

  const getBuildStatusIndicator = () => {
    if (!buildProgress) {return null;}
    switch (buildProgress.state) {
      case 'building':
        return (
          <div className="build-status build-status--running">
            <span className="build-status-icon">⏳</span>
            <span>
              Building ResourcePak
              {buildProgress.currentResource && (
                <> — {buildProgress.currentResource} ({buildProgress.resourceIndex}/{buildProgress.totalResources})</>
              )}
            </span>
          </div>
        );
      case 'completed':
        return (
          <div className="build-status build-status--completed">
            <span className="build-status-icon">✓</span>
            <span>ResourcePak built successfully</span>
          </div>
        );
      case 'failed':
        return (
          <div className="build-status build-status--failed">
            <span className="build-status-icon">✗</span>
            <span>Build failed</span>
            {buildProgress.errorMessage && (
              <span className="build-error-msg">{buildProgress.errorMessage}</span>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <SectionLayout title="ResourcePaks">
      {/* Auto-detect info bar */}
      {isDetected && (
        <div className="resourcepak-detected" role="status">
          <div className="resourcepak-detected-label">Detected:</div>
          <div className="resourcepak-detected-name">{status!.pakName}</div>
          <div className="resourcepak-detected-count">
            {status!.resourceCount} resource{status!.resourceCount !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      {/* Hint when no pak detected */}
      {!isDetected && status !== null && (
        <p className="resourcepak-no-detect">
          {resourcePakHint(status!.choices ?? 0)}
        </p>
      )}

      {/* Success message */}
      {success && (
        <div className="resourcepak-success" role="status">
          <span>{success}</span>
          <button
            className="resourcepak-dismiss"
            onClick={onDismissSuccess}
            aria-label="Dismiss success message"
          >
            ✕
          </button>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="resourcepak-error" role="alert">
          <span>{error}</span>
          <button
            className="resourcepak-dismiss"
            onClick={onDismissError}
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {/* Action buttons */}
      {activeAction === null && (
        <div className="resourcepak-buttons">
          <vscode-button
            disabled={(!isDetected || loading) || undefined}
            onClick={handleAddResourceStart}
          >
            Add Resource
          </vscode-button>
          <vscode-button
            disabled={(!isDetected || loading || isBuildRunning) || undefined}
            onClick={handleBuild}
          >
            {isBuildRunning ? 'Building...' : 'Build'}
          </vscode-button>
          <vscode-button
            appearance="secondary"
            disabled={loading || undefined}
            onClick={onChooseResourcePak}
          >
            Choose ResourcePak
          </vscode-button>
        </div>
      )}

      {/* Add Resource flow */}
      {activeAction === 'addResource' && (
        <div className="resourcepak-add-resource">
          {!hasBrowsedFile && (
            <p className="resourcepak-browse-hint">Select a file using the file picker…</p>
          )}
          {hasBrowsedFile && (
            <>
              <div className="resourcepak-browsed-file">
                <span className="resourcepak-form-label">{SELECTED_FILE_LABEL}</span>
                <span>{browsedFileName}</span>
              </div>
              <div className="resourcepak-form-field">
                <label className="resourcepak-form-label">Resource name</label>
                <vscode-textfield
                  value={resourceName}
                  placeholder="my-resource"
                  onInput={(e: Event) => {
                    const el = e.target as HTMLInputElement;
                    setResourceName(el.value);
                    if (el.value.trim()) {
                      setResourceNameError(null);
                    }
                  }}
                  onKeyDown={(e: React.KeyboardEvent) => {
                    if (e.key === 'Enter') {
                      handleAddResourceSubmit();
                    }
                  }}
                />
                {resourceNameError && (
                  <span className="resourcepak-form-error">{resourceNameError}</span>
                )}
              </div>
              <div className="resourcepak-form-actions">
                <vscode-button onClick={handleAddResourceSubmit} disabled={loading || undefined}>
                  {loading ? 'Adding…' : 'Add Resource'}
                </vscode-button>
                <vscode-button appearance="secondary" onClick={handleAddResourceCancel}>
                  Cancel
                </vscode-button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Build progress */}
      {getBuildStatusIndicator()}
    </SectionLayout>
  );
};
