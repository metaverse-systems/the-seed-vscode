import React from 'react';
import type { ScopeEntry, ScopeFormData } from '../../types/messages';

interface ScopesListProps {
  scopes: ScopeEntry[];
  editingScopeId: string | null;
  onStartEdit: (scopeName: string) => void;
  onCancelEdit: () => void;
  onEditScope: (data: ScopeFormData) => void;
  onDeleteScope: (scopeName: string) => void;
}

export const ScopesList: React.FC<ScopesListProps> = ({
  scopes,
  editingScopeId,
  onStartEdit,
  onCancelEdit,
  onEditScope,
  onDeleteScope,
}) => {
  if (scopes.length === 0) {
    return (
      <div className="scopes-empty">
        <p>No scopes configured.</p>
        <p className="scopes-empty-hint">Click "Add Scope" to create your first scope.</p>
      </div>
    );
  }

  return (
    <div className="scopes-list">
      <label className="scopes-label">Scopes</label>
      {scopes.map((scope) => (
        <ScopeRow
          key={scope.name}
          scope={scope}
          isEditing={editingScopeId === scope.name}
          onStartEdit={() => onStartEdit(scope.name)}
          onCancelEdit={onCancelEdit}
          onEditScope={onEditScope}
          onDelete={() => onDeleteScope(scope.name)}
        />
      ))}
    </div>
  );
};

interface ScopeRowProps {
  scope: ScopeEntry;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onEditScope: (data: ScopeFormData) => void;
  onDelete: () => void;
}

const ScopeRow: React.FC<ScopeRowProps> = ({
  scope,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onEditScope,
  onDelete,
}) => {
  const [authorName, setAuthorName] = React.useState(scope.author.name);
  const [authorEmail, setAuthorEmail] = React.useState(scope.author.email);
  const [authorUrl, setAuthorUrl] = React.useState(scope.author.url);

  React.useEffect(() => {
    if (isEditing) {
      setAuthorName(scope.author.name);
      setAuthorEmail(scope.author.email);
      setAuthorUrl(scope.author.url);
    }
  }, [isEditing, scope]);

  if (isEditing) {
    return (
      <div className="scope-row scope-row-editing">
        <div className="scope-name">{scope.name}</div>
        <div className="scope-edit-fields">
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
          <div className="scope-edit-actions">
            <vscode-button
              onClick={() => {
                if (authorName.trim()) {
                  onEditScope({
                    scopeName: scope.name,
                    authorName: authorName.trim(),
                    authorEmail: authorEmail.trim(),
                    authorUrl: authorUrl.trim(),
                  });
                }
              }}
              disabled={!authorName.trim() ? true : undefined}
            >
              Save
            </vscode-button>
            <vscode-button appearance="secondary" onClick={onCancelEdit}>
              Cancel
            </vscode-button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="scope-row">
      <div className="scope-info">
        <span className="scope-name">{scope.name}</span>
        <span className="scope-author">{scope.author.name}</span>
        {scope.author.email && (
          <span className="scope-detail">{scope.author.email}</span>
        )}
        {scope.author.url && (
          <span className="scope-detail">{scope.author.url}</span>
        )}
      </div>
      <div className="scope-actions">
        <vscode-button appearance="icon" onClick={onStartEdit} aria-label="Edit scope">
          ✎
        </vscode-button>
        <vscode-button appearance="icon" onClick={onDelete} aria-label="Delete scope">
          ✕
        </vscode-button>
      </div>
    </div>
  );
};

