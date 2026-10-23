// Records what one run of an operation shows the user: the output panel, the
// notifications (with the progress notification's title and reports) and every
// message the sidebar's provider posts, so a run started from the sidebar can
// be compared with the same run started from the command palette.
import * as assert from 'assert';
import * as os from 'os';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { getOperationLock } from '../../operationLock';
import { getOutputChannel } from '../../outputChannel';
import { TheSeedViewProvider } from '../../panels/TheSeedViewProvider';

/** Stands in the panel list for a call to the output panel's `show`. */
export const SHOW = '<show>';

export type NotificationRecord =
  | { kind: 'info' | 'warning' | 'error'; text: string }
  | { kind: 'progress'; title: string | undefined; cancellable: boolean | undefined }
  | { kind: 'report'; message: string | undefined };

export interface Recording {
  /** `append` text, `appendLine` text plus a newline, and `SHOW` for each `show`, in order. */
  panel: string[];
  notifications: NotificationRecord[];
  /** Every message given to `TheSeedViewProvider.prototype.postMessage`, in order. */
  sidebar: unknown[];
}

export interface Recorder extends Recording {
  /** Returns what has been recorded so far and starts the lists afresh. */
  take(): Recording;
  /** Cancels the token of every progress notification shown since the recorder was made, as the notification's Cancel button does. */
  cancelProgress(): void;
  /**
   * Waits until an information, warning or error message has been shown and no
   * dependency installation holds the lock, then a little longer for the last
   * posts; fails after `timeoutMs` naming what was recorded.
   */
  outcome(timeoutMs?: number): Promise<void>;
}

/**
 * Starts recording. The stubs are sinon's, so they are removed by the
 * `sinon.restore()` of the scratch state's teardown.
 */
export function recordOperation(): Recorder {
  const sources: vscode.CancellationTokenSource[] = [];
  const recorder: Recorder = {
    panel: [],
    notifications: [],
    sidebar: [],
    take: () => {
      const taken: Recording = { panel: recorder.panel.splice(0), notifications: recorder.notifications.splice(0), sidebar: recorder.sidebar.splice(0) };
      return taken;
    },
    cancelProgress: () => {
      for (const source of sources) {
        source.cancel();
      }
    },
    outcome: async (timeoutMs = 15000) => {
      const deadline = Date.now() + timeoutMs;
      const shown = (): boolean => recorder.notifications.some((entry) => entry.kind === 'info' || entry.kind === 'warning' || entry.kind === 'error');
      while (!shown() || getOperationLock().type === 'install') {
        if (Date.now() > deadline) {
          throw new Error(`timed out waiting for the operation's outcome; recorded so far: ${JSON.stringify({ panel: recorder.panel, notifications: recorder.notifications, sidebar: recorder.sidebar })}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    },
  };

  const channel = getOutputChannel();
  sinon.stub(channel, 'append').callsFake((text: string) => { recorder.panel.push(text); });
  sinon.stub(channel, 'appendLine').callsFake((text: string) => { recorder.panel.push(text + '\n'); });
  sinon.stub(channel, 'show').callsFake(() => { recorder.panel.push(SHOW); });

  const notify = (kind: 'info' | 'warning' | 'error') => (text: string): Promise<undefined> => {
    recorder.notifications.push({ kind, text });
    return Promise.resolve(undefined);
  };
  sinon.stub(vscode.window, 'showInformationMessage').callsFake(notify('info') as never);
  sinon.stub(vscode.window, 'showWarningMessage').callsFake(notify('warning') as never);
  sinon.stub(vscode.window, 'showErrorMessage').callsFake(notify('error') as never);

  const withProgress = vscode.window.withProgress.bind(vscode.window);
  sinon.stub(vscode.window, 'withProgress').callsFake(((
    options: vscode.ProgressOptions,
    task: (progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken) => Thenable<unknown>,
  ) => {
    recorder.notifications.push({ kind: 'progress', title: options.title, cancellable: options.cancellable });
    return withProgress(options, (progress, token) => {
      const source = new vscode.CancellationTokenSource();
      sources.push(source);
      const forward = token.onCancellationRequested(() => source.cancel());
      const reporting = {
        report: (value: { message?: string; increment?: number }) => {
          recorder.notifications.push({ kind: 'report', message: value.message });
          progress.report(value);
        },
      };
      return Promise.resolve(task(reporting, source.token)).finally(() => forward.dispose());
    });
  }) as typeof vscode.window.withProgress);

  const post = TheSeedViewProvider.prototype.postMessage;
  sinon.stub(TheSeedViewProvider.prototype, 'postMessage').callsFake(function (this: TheSeedViewProvider, message) {
    recorder.sidebar.push(JSON.parse(JSON.stringify(message)));
    return post.call(this, message);
  });

  return recorder;
}

const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SCRATCH = new RegExp(`${escapeRegExp(os.tmpdir())}[\\\\/]the-seed-ext-[^\\\\/\\s"']+`, 'g');

function normaliseText(text: string): string {
  return text.replace(ISO_TIME, '<time>').replace(SCRATCH, '<scratch>');
}

function normaliseValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return normaliseText(value);
  }
  if (Array.isArray(value)) {
    return value.map(normaliseValue);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(value)) {
      if (key !== 'requestId') {
        result[key] = normaliseValue(field);
      }
    }
    return result;
  }
  return value;
}

/**
 * A recording with ISO times replaced by `<time>`, scratch directories by
 * `<scratch>` and every `requestId` dropped. The panel's consecutive text
 * entries are joined, so how a process's output happened to be split into
 * chunks does not matter; `SHOW` markers stay separate entries.
 */
export function normalise(recording: Recording): Recording {
  const panel: string[] = [];
  let text: string | null = null;
  for (const entry of recording.panel) {
    if (entry === SHOW) {
      if (text !== null) {
        panel.push(text);
        text = null;
      }
      panel.push(SHOW);
    } else {
      text = (text ?? '') + entry;
    }
  }
  if (text !== null) {
    panel.push(text);
  }
  return {
    panel: panel.map(normaliseText),
    notifications: normaliseValue(recording.notifications) as NotificationRecord[],
    sidebar: normaliseValue(recording.sidebar) as unknown[],
  };
}

/** Asserts that two runs showed the user the same thing once normalised. */
export function assertSameRun(a: Recording, b: Recording): void {
  assert.deepStrictEqual(normalise(a), normalise(b));
}

/** The panel's text, joined, with `SHOW` markers left out. */
export function panelText(recording: Recording): string {
  return recording.panel.filter((entry) => entry !== SHOW).join('');
}
