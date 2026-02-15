import React, { useState } from 'react';
import type { ScopeFormData } from '../../types/messages';

interface ScopeFormProps {
  onSubmit: (data: ScopeFormData) => void;
  onCancel: () => void;
  initialData?: Partial<ScopeFormData>;
  scopeNameReadOnly?: boolean;
}

export const ScopeForm: React.FC<ScopeFormProps> = ({
  onSubmit,
  onCancel,
  initialData,
  scopeNameReadOnly,
}) => {
  const [scopeName, setScopeName] = useState(initialData?.scopeName || '');
  const [authorName, setAuthorName] = useState(initialData?.authorName || '');
  const [authorEmail, setAuthorEmail] = useState(initialData?.authorEmail || '');
  const [authorUrl, setAuthorUrl] = useState(initialData?.authorUrl || '');

  const handleSubmit = () => {
    if (!scopeName.trim() || !authorName.trim()) {
      return;
    }
    const name = scopeName.trim().startsWith('@')
      ? scopeName.trim()
      : `@${scopeName.trim()}`;
    onSubmit({
      scopeName: name,
      authorName: authorName.trim(),
      authorEmail: authorEmail.trim(),
      authorUrl: authorUrl.trim(),
    });
  };

  return (
    <div className="scope-form">
      <label>Scope Name *</label>
      <vscode-textfield
        value={scopeName}
        onInput={(e: Event) => setScopeName((e.target as HTMLInputElement).value)}
        placeholder="@scope-name"
        disabled={scopeNameReadOnly ? true : undefined}
      />
      <label>Author Name *</label>
      <vscode-textfield
        value={authorName}
        onInput={(e: Event) => setAuthorName((e.target as HTMLInputElement).value)}
        placeholder="Author name (required)"
      />
      <label>Email</label>
      <vscode-textfield
        value={authorEmail}
        onInput={(e: Event) => setAuthorEmail((e.target as HTMLInputElement).value)}
        placeholder="Email (optional)"
      />
      <label>URL</label>
      <vscode-textfield
        value={authorUrl}
        onInput={(e: Event) => setAuthorUrl((e.target as HTMLInputElement).value)}
        placeholder="URL (optional)"
      />
      <div className="scope-form-actions">
        <vscode-button
          onClick={handleSubmit}
          disabled={!scopeName.trim() || !authorName.trim() ? true : undefined}
        >
          Save
        </vscode-button>
        <vscode-button appearance="secondary" onClick={onCancel}>
          Cancel
        </vscode-button>
      </div>
    </div>
  );
};
