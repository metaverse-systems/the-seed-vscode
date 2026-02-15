/**
 * Type declarations for the VS Code Webview API.
 * acquireVsCodeApi is provided by VS Code at runtime.
 */

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// Declare @vscode-elements custom elements for JSX/React
declare namespace JSX {
  interface IntrinsicElements {
    'vscode-textfield': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        value?: string;
        placeholder?: string;
        disabled?: boolean;
        onInput?: (e: Event) => void;
      },
      HTMLElement
    >;
    'vscode-button': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        appearance?: string;
        disabled?: boolean;
        onClick?: (e: Event) => void;
      },
      HTMLElement
    >;
    'vscode-textarea': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        value?: string;
        placeholder?: string;
        rows?: number;
        onInput?: (e: Event) => void;
      },
      HTMLElement
    >;
    'vscode-divider': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement>,
      HTMLElement
    >;
  }
}
