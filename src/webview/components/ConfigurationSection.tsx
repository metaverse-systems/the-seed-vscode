import React, { useState } from 'react';
import { SectionLayout } from './SectionLayout';
import { PrefixEditor } from './PrefixEditor';
import { ScopesList } from './ScopesList';
import { ScopeForm } from './ScopeForm';
import { ConfirmDialog } from './ConfirmDialog';
import type { ConfigPayload, ScopeFormData } from '../../types/messages';

interface ConfigurationSectionProps {
  config: ConfigPayload | null;
  onSavePrefix: (prefix: string) => void;
  onAddScope: (data: ScopeFormData) => void;
  onConfirmOverwriteScope: () => void;
  onEditScope: (data: ScopeFormData) => void;
  onDeleteScope: (scopeName: string) => void;
  pendingOverwrite: string | null;
  onCancelOverwrite: () => void;
}

export const ConfigurationSection: React.FC<ConfigurationSectionProps> = ({
  config,
  onSavePrefix,
  onAddScope,
  onConfirmOverwriteScope,
  onEditScope,
  onDeleteScope,
  pendingOverwrite,
  onCancelOverwrite,
}) => {
  const [editingScopeId, setEditingScopeId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  if (!config) {
    return (
      <SectionLayout title="Configuration">
        <p>Loading configuration...</p>
      </SectionLayout>
    );
  }

  return (
    <SectionLayout title="Configuration">
      <PrefixEditor
        prefix={config.prefix}
        isDefault={config.isDefault}
        onSave={onSavePrefix}
      />

      <div className="section-divider" />

      <ScopesList
        scopes={config.scopes}
        editingScopeId={editingScopeId}
        onStartEdit={(scopeName) => {
          setEditingScopeId(scopeName);
          setShowAddForm(false);
        }}
        onCancelEdit={() => setEditingScopeId(null)}
        onEditScope={(data) => {
          onEditScope(data);
          setEditingScopeId(null);
        }}
        onDeleteScope={(scopeName) => setPendingDelete(scopeName)}
      />

      {pendingDelete && (
        <ConfirmDialog
          message={<>Are you sure you want to delete scope <strong>{pendingDelete}</strong>?</>}
          confirmLabel="Delete"
          onConfirm={() => {
            onDeleteScope(pendingDelete);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {pendingOverwrite && (
        <ConfirmDialog
          message={<>Scope <strong>{pendingOverwrite}</strong> already exists. Overwrite?</>}
          confirmLabel="Overwrite"
          onConfirm={onConfirmOverwriteScope}
          onCancel={onCancelOverwrite}
        />
      )}

      {showAddForm ? (
        <ScopeForm
          onSubmit={(data) => {
            onAddScope(data);
            setShowAddForm(false);
          }}
          onCancel={() => setShowAddForm(false)}
        />
      ) : (
        <vscode-button
          onClick={() => {
            setShowAddForm(true);
            setEditingScopeId(null);
          }}
          style={{ marginTop: '8px' }}
        >
          Add Scope
        </vscode-button>
      )}
    </SectionLayout>
  );
};
