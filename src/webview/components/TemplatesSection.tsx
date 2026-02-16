import React, { useState, useEffect } from 'react';
import { SectionLayout } from './SectionLayout';
import { TemplateForm } from './TemplateForm';
import { ResourcePakForm } from './ResourcePakForm';
import type { ScopeEntry } from '../../types/messages';

type TemplateType = 'component' | 'system' | 'program';

interface TemplatesSectionProps {
  scopes: ScopeEntry[];
  onCreateTemplate: (
    templateType: TemplateType,
    scopeName: string,
    templateName: string
  ) => void;
  onCreateResourcePak: (scopeName: string, pakName: string) => void;
  loading: boolean;
  success: { message: string; path: string } | null;
  error: string | null;
  existsWarning: string | null;
  resourcePakSuccess: string | null;
  resourcePakError: string | null;
  onDismissSuccess: () => void;
  onDismissError: () => void;
  onDismissWarning: () => void;
  onDismissResourcePakSuccess: () => void;
  onDismissResourcePakError: () => void;
}

type ActiveForm = TemplateType | 'resourcepak';

export const TemplatesSection: React.FC<TemplatesSectionProps> = ({
  scopes,
  onCreateTemplate,
  onCreateResourcePak,
  loading,
  success,
  error,
  existsWarning,
  resourcePakSuccess,
  resourcePakError,
  onDismissSuccess,
  onDismissError,
  onDismissWarning,
  onDismissResourcePakSuccess,
  onDismissResourcePakError,
}) => {
  const [activeForm, setActiveForm] = useState<ActiveForm | null>(null);
  const [rpCreating, setRpCreating] = useState(false);

  // Collapse form on successful creation
  useEffect(() => {
    if (success && activeForm) {
      setActiveForm(null);
    }
  }, [success]);

  // Collapse ResourcePak form on success
  useEffect(() => {
    if (resourcePakSuccess && activeForm === 'resourcepak') {
      setActiveForm(null);
      setRpCreating(false);
    }
  }, [resourcePakSuccess]);

  const handleSubmit = (scopeName: string, templateName: string) => {
    if (activeForm && activeForm !== 'resourcepak') {
      onCreateTemplate(activeForm, scopeName, templateName);
    }
  };

  const handleCancel = () => {
    setActiveForm(null);
    onDismissError();
    onDismissWarning();
  };

  // Collapse form on successful creation
  const handleButtonClick = (type: ActiveForm) => {
    onDismissSuccess();
    onDismissError();
    onDismissWarning();
    onDismissResourcePakSuccess();
    onDismissResourcePakError();
    setActiveForm(type);
  };

  const handleRpSubmit = (scopeName: string, pakName: string) => {
    setRpCreating(true);
    onCreateResourcePak(scopeName, pakName);
  };

  const handleRpCancel = () => {
    setActiveForm(null);
    setRpCreating(false);
    onDismissResourcePakError();
  };

  if (!scopes || scopes.length === 0) {
    return (
      <SectionLayout title="Templates">
        <p className="templates-no-scopes">
          No scopes configured. Add a scope in the Configuration section above to create templates.
        </p>
      </SectionLayout>
    );
  }

  return (
    <SectionLayout title="Templates">
      {success && (
        <div className="template-success" role="status">
          <span>{success.message}</span>
          <button
            className="template-dismiss"
            onClick={onDismissSuccess}
            aria-label="Dismiss success message"
          >
            ✕
          </button>
        </div>
      )}

      {resourcePakSuccess && (
        <div className="template-success" role="status">
          <span>{resourcePakSuccess}</span>
          <button
            className="template-dismiss"
            onClick={onDismissResourcePakSuccess}
            aria-label="Dismiss success message"
          >
            ✕
          </button>
        </div>
      )}

      {!activeForm && (
        <div className="template-buttons">
          <vscode-button onClick={() => handleButtonClick('component')}>
            Create Component
          </vscode-button>
          <vscode-button onClick={() => handleButtonClick('system')}>
            Create System
          </vscode-button>
          <vscode-button onClick={() => handleButtonClick('program')}>
            Create Program
          </vscode-button>
          <vscode-button onClick={() => handleButtonClick('resourcepak')}>
            Create ResourcePak
          </vscode-button>
        </div>
      )}

      {activeForm && activeForm !== 'resourcepak' && (
        <>
          {existsWarning && (
            <div className="template-warning" role="alert">
              <span>Directory already exists: {existsWarning}</span>
              <button
                className="template-dismiss"
                onClick={onDismissWarning}
                aria-label="Dismiss warning"
              >
                ✕
              </button>
            </div>
          )}
          {error && (
            <div className="template-error" role="alert">
              <span>{error}</span>
              <button
                className="template-dismiss"
                onClick={onDismissError}
                aria-label="Dismiss error"
              >
                ✕
              </button>
            </div>
          )}
          <TemplateForm
            templateType={activeForm}
            scopes={scopes}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            loading={loading}
          />
        </>
      )}

      {activeForm === 'resourcepak' && (
        <>
          {resourcePakError && (
            <div className="template-error" role="alert">
              <span>{resourcePakError}</span>
              <button
                className="template-dismiss"
                onClick={onDismissResourcePakError}
                aria-label="Dismiss error"
              >
                ✕
              </button>
            </div>
          )}
          <ResourcePakForm
            scopes={scopes}
            onSubmit={handleRpSubmit}
            onCancel={handleRpCancel}
            loading={rpCreating}
          />
        </>
      )}
    </SectionLayout>
  );
};
