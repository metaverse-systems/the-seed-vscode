import React, { useState, useEffect } from 'react';
import { SectionLayout } from './SectionLayout';
import { TemplateForm } from './TemplateForm';
import type { ScopeEntry } from '../../types/messages';

type TemplateType = 'component' | 'system' | 'program';

interface TemplatesSectionProps {
  scopes: ScopeEntry[];
  onCreateTemplate: (
    templateType: TemplateType,
    scopeName: string,
    templateName: string
  ) => void;
  loading: boolean;
  success: { message: string; path: string } | null;
  error: string | null;
  existsWarning: string | null;
  onDismissSuccess: () => void;
  onDismissError: () => void;
  onDismissWarning: () => void;
}

export const TemplatesSection: React.FC<TemplatesSectionProps> = ({
  scopes,
  onCreateTemplate,
  loading,
  success,
  error,
  existsWarning,
  onDismissSuccess,
  onDismissError,
  onDismissWarning,
}) => {
  const [activeForm, setActiveForm] = useState<TemplateType | null>(null);

  // Collapse form on successful creation
  useEffect(() => {
    if (success && activeForm) {
      setActiveForm(null);
    }
  }, [success]);

  const handleSubmit = (scopeName: string, templateName: string) => {
    if (activeForm) {
      onCreateTemplate(activeForm, scopeName, templateName);
    }
  };

  const handleCancel = () => {
    setActiveForm(null);
    onDismissError();
    onDismissWarning();
  };

  // Collapse form on successful creation
  const handleButtonClick = (type: TemplateType) => {
    onDismissSuccess();
    onDismissError();
    onDismissWarning();
    setActiveForm(type);
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
        </div>
      )}

      {activeForm && (
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
    </SectionLayout>
  );
};
