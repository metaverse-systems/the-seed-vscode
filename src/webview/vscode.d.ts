/**
 * Type declarations for the VS Code Webview API and the
 * @vscode-elements custom elements used as JSX in the sidebar.
 * acquireVsCodeApi is provided by VS Code at runtime.
 */

import type * as React from 'react';

declare global {
  interface VsCodeApi {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
  }

  function acquireVsCodeApi(): VsCodeApi;
}

// The element props replace React's handlers of the same name, so the
// handler types declared here do not intersect with React's.
type ElementProps = Omit<
  React.HTMLAttributes<HTMLElement>,
  'onInput' | 'onChange' | 'onClick'
>;

type ElementAttributes<P = object> = React.DetailedHTMLProps<
  ElementProps & P,
  HTMLElement
>;

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'vscode-textfield': ElementAttributes<{
        value?: string;
        placeholder?: string;
        disabled?: boolean;
        onInput?: (e: Event) => void;
      }>;
      'vscode-button': ElementAttributes<{
        appearance?: string;
        disabled?: boolean;
        onClick?: (e: Event) => void;
      }>;
      'vscode-textarea': ElementAttributes<{
        value?: string;
        placeholder?: string;
        rows?: number;
        onInput?: (e: Event) => void;
      }>;
      'vscode-divider': ElementAttributes;
      'vscode-single-select': ElementAttributes<{
        value?: string;
        disabled?: boolean;
        onChange?: (e: Event) => void;
      }>;
      'vscode-option': ElementAttributes<{
        value?: string;
        selected?: boolean;
      }>;
    }
  }
}
