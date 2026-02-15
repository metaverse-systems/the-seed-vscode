import React, { useState } from 'react';
import '@vscode-elements/elements';

interface PrefixEditorProps {
  prefix: string;
  isDefault: boolean;
  onSave: (prefix: string) => void;
}

export const PrefixEditor: React.FC<PrefixEditorProps> = ({
  prefix,
  isDefault,
  onSave,
}) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(prefix);

  const handleSave = () => {
    const trimmed = value.trim();
    if (trimmed) {
      onSave(trimmed);
      setEditing(false);
    }
  };

  const handleCancel = () => {
    setValue(prefix);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="prefix-editor">
        <label className="prefix-label">Prefix</label>
        <div className="prefix-edit-row">
          <vscode-textfield
            value={value}
            onInput={(e: Event) =>
              setValue((e.target as HTMLInputElement).value)
            }
            style={{ flex: 1 }}
          />
          <div className="prefix-actions">
            <vscode-button onClick={handleSave}>Save</vscode-button>
            <vscode-button appearance="secondary" onClick={handleCancel}>
              Cancel
            </vscode-button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="prefix-editor">
      <label className="prefix-label">Prefix</label>
      <div className="prefix-display-row">
        <span className="prefix-value">
          {prefix}
          {isDefault && <span className="prefix-default-badge"> (default)</span>}
        </span>
        <vscode-button appearance="icon" onClick={() => {
          setValue(prefix);
          setEditing(true);
        }} aria-label="Edit prefix">
          ✎
        </vscode-button>
      </div>
    </div>
  );
};

