import React, { useState, useEffect } from 'react';
import { SectionLayout } from './SectionLayout';
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
  onBrowseResourceFile: () => void;
  onAddResource: (
    scope: string,
    pakName: string,
    resourceName: string,
    filePath: string,
    useDetectedPak: boolean
  ) => void;
  onBuildResourcePak: (scope: string, pakName: string, useDetectedPak: boolean) => void;
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

  const namePattern = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;

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
    if (!namePattern.test(resourceName)) {
      setResourceNameError('Name must start with a letter or number and contain only letters, numbers, and hyphens');
      return;
    }
    setResourceNameError(null);

    const scope = status!.scope ?? '';
    const pakName = status!.displayName ?? '';
    onAddResource(scope, pakName, resourceName, browsedFilePath!, true);
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
    const scope = status!.scope ?? '';
    const pakName = status!.displayName ?? '';
    onBuildResourcePak(scope, pakName, true);
  };

  const isBuildRunning = buildProgress?.state === 'building';

  const getBuildStatusIndicator = () => {
    if (!buildProgress) return null;
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
          No ResourcePak detected in workspace. Create one from the Templates section.
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
                <span className="resourcepak-form-label">Selected file:</span>
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
                    if (el.value && namePattern.test(el.value)) {
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
