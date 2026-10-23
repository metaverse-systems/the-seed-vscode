import type { ToolStatusPayload } from './messages';

export interface ToolBlockButton {
  label: string;
  action: 'openToolSetting' | 'checkTool';
}

export interface ToolBlockView {
  text: string;
  buttons: ToolBlockButton[];
  /** Whether the configuration editors are shown. */
  showEditors: boolean;
  /** Whether the "Loading configuration…" line is shown. */
  showLoading: boolean;
}

function howFound(payload: ToolStatusPayload): string {
  switch (payload.foundThrough) {
    case 'setting':
      return `the ${payload.setting} setting`;
    case 'global':
      return 'global installation';
    default:
      return 'command on the path';
  }
}

/** What the tool block of the configuration section shows for a status. */
export function toolBlockView(payload: ToolStatusPayload): ToolBlockView {
  if (payload.state === 'checking') {
    return { text: payload.message, buttons: [], showEditors: false, showLoading: true };
  }
  if (payload.usable) {
    return {
      text: `the-seed ${payload.version ?? ''} — ${payload.location ?? ''} (${howFound(payload)})`,
      buttons: [{ label: 'Check Again', action: 'checkTool' }],
      showEditors: true,
      showLoading: false,
    };
  }
  return {
    text: payload.message,
    buttons: [
      { label: 'Set Tool Location', action: 'openToolSetting' },
      { label: 'Check Again', action: 'checkTool' },
    ],
    showEditors: false,
    showLoading: false,
  };
}
