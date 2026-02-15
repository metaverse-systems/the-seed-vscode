import React, { useState, useRef, useEffect } from 'react';
import type { ScopeEntry } from '../../types/messages';

interface TemplateFormProps {
  templateType: 'component' | 'system' | 'program';
  scopes: ScopeEntry[];
  onSubmit: (scopeName: string, templateName: string) => void;
  onCancel: () => void;
  loading: boolean;
}

export const TemplateForm: React.FC<TemplateFormProps> = ({
  templateType,
  scopes,
  onSubmit,
  onCancel,
  loading,
}) => {
  const [selectedScope, setSelectedScope] = useState('');
  const [name, setName] = useState('');
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const selectRef = useRef<HTMLElement>(null);

  const namePattern = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;

  // Attach change event listener to web component via ref
  useEffect(() => {
    const selectElement = selectRef.current;
    if (!selectElement) return;

    const handleChange = (e: Event) => {
      const el = e.target as HTMLElement & { value: string };
      setSelectedScope(el.value);
      if (el.value) {
        setScopeError(null);
      }
    };

    selectElement.addEventListener('change', handleChange);
    return () => selectElement.removeEventListener('change', handleChange);
  }, []);

  const validate = (): boolean => {
    let valid = true;

    if (!selectedScope) {
      setScopeError('Please select a scope');
      valid = false;
    } else {
      setScopeError(null);
    }

    if (!name.trim()) {
      setNameError('Name is required');
      valid = false;
    } else if (!namePattern.test(name)) {
      setNameError('Name must start with a letter or number and contain only letters, numbers, and hyphens');
      valid = false;
    } else {
      setNameError(null);
    }

    return valid;
  };

  const handleSubmit = () => {
    if (validate()) {
      onSubmit(selectedScope, name);
    }
  };

  return (
    <div className="template-form">
      <div className="template-form-field">
        <label className="template-form-label">
          Scope
        </label>
        <vscode-single-select ref={selectRef}>
          <vscode-option value="">— Select scope —</vscode-option>
          {scopes.map((s) => (
            <vscode-option key={s.name} value={s.name}>
              {s.name}
            </vscode-option>
          ))}
        </vscode-single-select>
        {scopeError && (
          <span className="template-form-error">{scopeError}</span>
        )}
      </div>

      <div className="template-form-field">
        <label className="template-form-label">
          {templateType.charAt(0).toUpperCase() + templateType.slice(1)} name
        </label>
        <vscode-textfield
          value={name}
          placeholder={`my-${templateType}`}
          onInput={(e: Event) => {
            const el = e.target as HTMLInputElement;
            setName(el.value);
            if (el.value && namePattern.test(el.value)) {
              setNameError(null);
            }
          }}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === 'Enter' && !loading) {
              handleSubmit();
            }
          }}
        />
        {nameError && (
          <span className="template-form-error">{nameError}</span>
        )}
      </div>

      <div className="template-form-actions">
        <vscode-button
          onClick={handleSubmit}
          disabled={loading || undefined}
        >
          {loading ? 'Creating…' : 'Create'}
        </vscode-button>
        <vscode-button
          appearance="secondary"
          onClick={onCancel}
          disabled={loading || undefined}
        >
          Cancel
        </vscode-button>
      </div>
    </div>
  );
};
