import React from 'react';

interface ConfirmDialogProps {
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}) => {
  return (
    <div className="confirm-dialog-overlay">
      <div className="confirm-dialog" role="alertdialog" aria-label="Confirmation">
        <div className="confirm-dialog-message">{message}</div>
        <div className="confirm-dialog-actions">
          <vscode-button onClick={onConfirm}>{confirmLabel}</vscode-button>
          <vscode-button appearance="secondary" onClick={onCancel}>
            {cancelLabel}
          </vscode-button>
        </div>
      </div>
    </div>
  );
};
