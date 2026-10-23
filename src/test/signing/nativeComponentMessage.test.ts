import * as assert from 'assert';
import type { IntegrityResult, PackageResult, VerifyResult } from '@metaverse-systems/the-seed/types';
import { describeVerification } from '../../signing/verificationMessage';
import { packageNotification } from '../../build/packageOutcome';
import { testTool } from '../helpers/tool';

// The text each command shows when the tool's native component is missing must be the tool's own
// message in full, so the editor says the same thing as the command line. Plain values only: nothing
// from the VS Code API, so these cases run under plain Mocha as well as in the extension host.
//
// Helpers these tests fix (the commands call them; they hold no `vscode` import):
//   - `signing/signFailure`: `describeSignFailure(error, timestamp)` returns
//     `{ logLine, notification }`; the log line is `[<timestamp>] Signing failed: <message>` and the
//     notification is the message
//   - `build/buildFailure`: `describeBuildRejection(error, buildLabel, timestamp)` returns
//     `{ status, outputLine, notification }`, where `status` is the failed build status for the panel
//     (`state: 'failed'`, `target: buildLabel`, `errorMessage: <message>`, `timestamp`) and the
//     notification is the message; `describeFailedStep(step, message)` returns the text shown for an
//     install-phase or other failed step, `Build failed at <step>: <message>`
// The helpers are loaded when a case runs, so the suite compiles before they exist.

interface SignFailure { logLine: string; notification: string }
interface BuildRejection {
  status: { state: string; target: string; errorMessage?: string; timestamp: string };
  outputLine: string;
  notification: string;
}
interface SignFailureModule { describeSignFailure(error: unknown, timestamp: string): SignFailure }
interface BuildFailureModule {
  describeBuildRejection(error: unknown, buildLabel: string, timestamp: string): BuildRejection;
  describeFailedStep(step: string, message: string): string;
}

const signFailureModule = (): SignFailureModule => require('../../signing/signFailure') as SignFailureModule;
const buildFailureModule = (): BuildFailureModule => require('../../build/buildFailure') as BuildFailureModule;

suite('native component message in the editor', () => {
  const timestamp = '2026-01-02T03:04:05.000Z';
  const missing = (): Error => new (testTool().NativeComponentMissingError)();

  test('the message is one line, so its first line is the whole message', () => {
    const message = testTool().nativeComponentMessage();
    assert.strictEqual(missing().message, message);
    assert.strictEqual(message.split('\n')[0], message);
  });

  test('a verification that could not be checked carries the message in full', () => {
    const message = testTool().nativeComponentMessage();
    const notChecked: IntegrityResult = { state: 'not-checked', reason: message, checked: [] };
    const result: VerifyResult = {
      filePath: '/work/prog.exe',
      status: 'NOT_CHECKED',
      form: 'windows-program',
      integrity: notChecked,
      trust: { state: 'not-applicable' },
      warnings: [],
      notChecked: [],
      reason: message,
    };
    const shown = describeVerification(result, (subject) => subject.commonName);
    assert.strictEqual(shown.severity, 'warning');
    assert.ok(shown.summary.includes(message), shown.summary);
    assert.strictEqual(shown.summary.split('\n')[0].includes(message), true);
  });

  test('a refused packaging run notifies with the message in full', () => {
    const message = testTool().nativeComponentMessage();
    const result: PackageResult = {
      success: false,
      message,
      outputDir: '/work/dist',
      projects: [],
      files: [],
      signatures: 0,
      fileCount: 0,
      notPackaged: [],
    };
    const shown = packageNotification(result);
    assert.strictEqual(shown.kind, 'error');
    assert.strictEqual(shown.text, 'Packaging failed: ' + message);
  });

  test('a signing failure is logged and notified with the message in full', () => {
    const message = testTool().nativeComponentMessage();
    const shown = signFailureModule().describeSignFailure(missing(), timestamp);
    assert.strictEqual(shown.logLine, `[${timestamp}] Signing failed: ${message}`);
    assert.strictEqual(shown.notification, message);
  });

  test('a build rejection is a failed build with the message in full', () => {
    const message = testTool().nativeComponentMessage();
    const shown = buildFailureModule().describeBuildRejection(missing(), 'windows (release)', timestamp);
    assert.deepStrictEqual(shown.status, {
      state: 'failed',
      target: 'windows (release)',
      errorMessage: message,
      timestamp,
    });
    assert.strictEqual(shown.notification, message);
    assert.ok(shown.outputLine.includes(message), shown.outputLine);
  });

  test('a recursive build rejection is a failed build with the message in full', () => {
    const message = testTool().nativeComponentMessage();
    const shown = buildFailureModule().describeBuildRejection(missing(), 'windows (recursive)', timestamp);
    assert.strictEqual(shown.status.state, 'failed');
    assert.strictEqual(shown.status.target, 'windows (recursive)');
    assert.strictEqual(shown.status.errorMessage, message);
    assert.strictEqual(shown.notification, message);
  });

  test('a rejection that is not a missing component keeps its own message', () => {
    const shown = buildFailureModule().describeBuildRejection(new Error('disk full'), 'native', timestamp);
    assert.strictEqual(shown.status.state, 'failed');
    assert.strictEqual(shown.status.errorMessage, 'disk full');
    assert.strictEqual(shown.notification, 'disk full');
  });

  test('a failed install phase shows the message in full', () => {
    const message = testTool().nativeComponentMessage();
    const text = buildFailureModule().describeFailedStep('sign', message);
    assert.strictEqual(text, 'Build failed at sign: ' + message);
  });
});
