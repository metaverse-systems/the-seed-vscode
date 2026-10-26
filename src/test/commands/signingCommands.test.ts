// Signing commands. The first suites need no native call: the refusals when no
// file is available, the offer made when a scope has no certificate, and the
// cancelled export. The native suite starts Sign File and Verify Signature the
// way the explorer context menu and the palette do, through the command
// registry, against a copy of the tiny.exe fixture and a text file, and
// observes which files reach the loaded tool with spies that call through.
// Each case runs against a scratch home with one scope, so the scope is chosen
// without a prompt.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as crypto from 'crypto';
import { createCertFor, fixturePath } from '../helpers/scratchHome';
import { useScratchState } from '../helpers/scratchState';
import { requires } from '../harness/platform';
import { withoutInternalMembers } from '../helpers/stubTool';
import { testTool, useToolApi } from '../helpers/tool';

const NO_FILE_MESSAGE = 'No file selected. Open a file or use the context menu.';

function digest(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function listFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        found.push(full);
      }
    }
  };
  walk(root);
  return found.sort();
}

suite('Signing Commands', () => {
  const state = useScratchState({ scopes: { '@only': 'Only Author' } });

  suite('with a certificate and no file', () => {
    setup(async () => {
      await createCertFor('@only');
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    test('signFile with no file selected and no active editor shows the no-file error', async () => {
      const error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.signFile');

      assert.strictEqual(error.callCount, 1);
      assert.strictEqual(error.firstCall.args[0], NO_FILE_MESSAGE);
    });

    test('verifySignature with no file selected and no active editor shows the no-file error', async () => {
      const error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.verifySignature');

      assert.strictEqual(error.callCount, 1);
      assert.strictEqual(error.firstCall.args[0], NO_FILE_MESSAGE);
    });

    test('exportSigningCert with the save dialog dismissed shows the dialog once and writes nothing', async () => {
      const dialog = sinon.stub(vscode.window, 'showSaveDialog').resolves(undefined);
      const info = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
      const error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      const before = listFiles(state.home);

      await vscode.commands.executeCommand('the-seed.exportSigningCert');

      assert.strictEqual(dialog.callCount, 1);
      assert.ok(info.notCalled, 'no information message');
      assert.ok(error.notCalled, 'no error message');
      assert.deepStrictEqual(listFiles(state.home), before);
    });
  });

  suite('without a certificate', () => {
    test('signingCertInfo offers Create and Import, and dismissing runs nothing', async () => {
      const info = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
      const original = vscode.commands.executeCommand;
      const executed: string[] = [];
      sinon.stub(vscode.commands, 'executeCommand').callsFake((id: string, ...args: unknown[]) => {
        executed.push(id);
        return original.call(vscode.commands, id, ...args);
      });

      await vscode.commands.executeCommand('the-seed.signingCertInfo');

      assert.strictEqual(info.callCount, 1);
      assert.deepStrictEqual(info.firstCall.args, ['No signing certificate found.', 'Create', 'Import']);
      assert.ok(!executed.includes('the-seed.createSigningCert'), 'create was not run');
      assert.ok(!executed.includes('the-seed.importSigningCert'), 'import was not run');
    });
  });

  suite('started on chosen files', () => {
    requires('native-component');
    let program: string;
    let second: string;
    let notes: string;
    let originalDigest: string;
    let info: sinon.SinonStub;
    let warning: sinon.SinonStub;
    let error: sinon.SinonStub;

    const messages = (stub: sinon.SinonStub): string[] => stub.getCalls().map((call) => String(call.args[0]));
    const notificationCount = (): number => info.callCount + warning.callCount + error.callCount;

    setup(async () => {
      await createCertFor('@only');
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      program = path.join(state.home, 'tiny.exe');
      second = path.join(state.home, 'second.exe');
      notes = path.join(state.home, 'notes.txt');
      fs.copyFileSync(fixturePath('tiny.exe'), program);
      fs.copyFileSync(fixturePath('tiny.exe'), second);
      fs.writeFileSync(notes, 'plain text, not a program\n');
      originalDigest = digest(program);
      info = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
      warning = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);
      error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
    });

    teardown(async () => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    async function openEditorOn(file: string): Promise<void> {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      await vscode.window.showTextDocument(document);
    }

    // The editor cannot show a program as text, so the active editor is stood in for.
    function showAsActiveEditor(file: string): void {
      const editor = { document: { uri: vscode.Uri.file(file) } } as unknown as vscode.TextEditor;
      sinon.stub(vscode.window, 'activeTextEditor').get(() => editor);
    }

    test('Reproduction 1a: signFile started on a chosen file signs that file', async () => {
      const spy = sinon.spy(testTool().Signing.prototype, 'signFile');
      const uri = vscode.Uri.file(program);

      await vscode.commands.executeCommand('the-seed.signFile', uri, [uri]);

      assert.deepStrictEqual(messages(error), [], 'no error, in particular not "No file selected"');
      assert.strictEqual(spy.callCount, 1);
      assert.strictEqual(spy.firstCall.args[0], program);
      assert.deepStrictEqual(spy.firstCall.args[1], { scope: '@only' });
      assert.notStrictEqual(digest(program), originalDigest, 'the program should carry a signature');
      assert.strictEqual(info.callCount, 1);
      assert.strictEqual(String(info.firstCall.args[0]).includes('tiny.exe'), true);
    });

    test('Reproduction 1b: verifySignature started on a chosen file verifies that file', async () => {
      const uri = vscode.Uri.file(program);
      await vscode.commands.executeCommand('the-seed.signFile', uri, [uri]);
      info.resetHistory();
      warning.resetHistory();
      error.resetHistory();
      const spy = sinon.spy(testTool().Signing.prototype, 'verifyFile');

      await vscode.commands.executeCommand('the-seed.verifySignature', uri, [uri]);

      assert.deepStrictEqual(messages(error), [], 'no error, in particular not "No file selected"');
      assert.strictEqual(spy.callCount, 1);
      assert.strictEqual(spy.firstCall.args[0], program);
      assert.strictEqual(notificationCount(), 1);
    });

    test('verifySignature shows the signer through the tool\'s public formatSubject', async () => {
      const config = new (testTool().Config)();
      config.config.scopes['@only'].author.email = 'only@example.com';
      config.saveConfig();
      await createCertFor('@only');
      const uri = vscode.Uri.file(program);
      await vscode.commands.executeCommand('the-seed.signFile', uri, [uri]);
      info.resetHistory();
      warning.resetHistory();
      error.resetHistory();
      await useToolApi(withoutInternalMembers(testTool()));

      await vscode.commands.executeCommand('the-seed.verifySignature', uri, [uri]);

      const all = [...messages(info), ...messages(warning), ...messages(error)];
      assert.strictEqual(all.length, 1, all.join('\n'));
      assert.ok(all[0].includes('Signer: CN=Only Author, EMAIL=only@example.com, O=@only'), all[0]);
    });

    test('signFile with an editor open on another file signs the chosen file', async () => {
      await openEditorOn(notes);
      const spy = sinon.spy(testTool().Signing.prototype, 'signFile');
      const uri = vscode.Uri.file(program);

      await vscode.commands.executeCommand('the-seed.signFile', uri, [uri]);

      assert.deepStrictEqual(spy.getCalls().map((call) => call.args[0]), [program]);
    });

    test('verifySignature with an editor open on another file verifies the chosen file', async () => {
      await openEditorOn(notes);
      const spy = sinon.spy(testTool().Signing.prototype, 'verifyFile');

      await vscode.commands.executeCommand('the-seed.verifySignature', vscode.Uri.file(program));

      assert.deepStrictEqual(spy.getCalls().map((call) => call.args[0]), [program]);
    });

    test('verifySignature started from the palette verifies the editor file', async () => {
      showAsActiveEditor(program);
      const spy = sinon.spy(testTool().Signing.prototype, 'verifyFile');

      await vscode.commands.executeCommand('the-seed.verifySignature');

      assert.deepStrictEqual(spy.getCalls().map((call) => call.args[0]), [program]);
      assert.ok(!messages(error).includes(NO_FILE_MESSAGE));
    });

    test('signFile started from the palette signs the editor file', async () => {
      showAsActiveEditor(program);
      const spy = sinon.spy(testTool().Signing.prototype, 'signFile');

      await vscode.commands.executeCommand('the-seed.signFile');

      assert.deepStrictEqual(spy.getCalls().map((call) => call.args[0]), [program]);
      assert.notStrictEqual(digest(program), originalDigest);
    });

    test('signFile on a text file warns by name and asks for neither scope nor certificate', async () => {
      const sign = sinon.spy(testTool().Signing.prototype, 'signFile');
      const hasCert = sinon.spy(testTool().Signing.prototype, 'hasCert');
      const isBinary = sinon.spy(testTool().Signing.prototype, 'isBinaryFile');
      const pick = sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.signFile', vscode.Uri.file(notes));

      assert.deepStrictEqual(isBinary.getCalls().map((call) => call.args[0]), [notes], 'the chosen file was checked');
      assert.deepStrictEqual(messages(warning), ['Only binary files can be signed: notes.txt.']);
      assert.ok(sign.notCalled);
      assert.ok(hasCert.notCalled, 'the certificate check did not run');
      assert.ok(pick.notCalled, 'no scope choice');
      assert.strictEqual(notificationCount(), 1);
    });

    test('signFile on a selection of two programs and a text file signs both and summarises', async () => {
      const sign = sinon.spy(testTool().Signing.prototype, 'signFile');
      const hasCert = sinon.spy(testTool().Signing.prototype, 'hasCert');
      const isBinary = sinon.spy(testTool().Signing.prototype, 'isBinaryFile');
      const selection = [vscode.Uri.file(program), vscode.Uri.file(notes), vscode.Uri.file(second)];

      await vscode.commands.executeCommand('the-seed.signFile', selection[0], selection);

      // The command checks every selected file before signing any; the tool may check again while signing.
      assert.deepStrictEqual(isBinary.getCalls().slice(0, 3).map((call) => call.args[0]), [program, notes, second]);
      assert.deepStrictEqual(sign.getCalls().map((call) => call.args[0]), [program, second]);
      assert.strictEqual(hasCert.callCount, 1);
      const warnings = messages(warning);
      assert.strictEqual(warnings.filter((text) => text.includes('notes.txt')).length, 1);
      assert.ok(warnings.some((text) => text === 'Only binary files can be signed; skipped: notes.txt.'));
      assert.ok(warnings.some((text) => text === 'Signed 2 of 3 files: 1 skipped, 0 failed. See the output for details.'));
      assert.strictEqual(error.callCount, 0);
      assert.strictEqual(info.callCount, 0, 'no per-file notifications');
    });

    test('signFile on a selection of two programs reports that both were signed', async () => {
      const selection = [vscode.Uri.file(program), vscode.Uri.file(second)];

      await vscode.commands.executeCommand('the-seed.signFile', selection[0], selection);

      assert.deepStrictEqual(messages(info), ['Signed 2 files.']);
      assert.strictEqual(warning.callCount, 0);
      assert.strictEqual(error.callCount, 0);
    });

    test('signFile continues with the next file after one signing fails', async () => {
      const prototype = testTool().Signing.prototype;
      const original = prototype.signFile;
      const attempted: string[] = [];
      sinon.stub(prototype, 'signFile').callsFake(function (this: unknown, file: string, options?: never) {
        attempted.push(file);
        if (attempted.length === 1) {
          return Promise.reject(new Error('signing broke'));
        }
        return original.call(this as never, file, options);
      } as never);
      const selection = [vscode.Uri.file(program), vscode.Uri.file(second)];

      await vscode.commands.executeCommand('the-seed.signFile', selection[0], selection);

      assert.deepStrictEqual(attempted, [program, second]);
      assert.strictEqual(digest(program), originalDigest, 'the first program is unchanged');
      assert.notStrictEqual(digest(second), originalDigest, 'the second program is signed');
      assert.strictEqual(error.callCount, 1);
      assert.ok(String(error.firstCall.args[0]).includes('1 failed'), String(error.firstCall.args[0]));
    });

    test('verifySignature on a selection of two files verifies each and summarises once', async () => {
      const spy = sinon.spy(testTool().Signing.prototype, 'verifyFile');
      const selection = [vscode.Uri.file(program), vscode.Uri.file(second)];

      await vscode.commands.executeCommand('the-seed.verifySignature', selection[0], selection);

      assert.deepStrictEqual(spy.getCalls().map((call) => call.args[0]), [program, second]);
      assert.strictEqual(notificationCount(), 1);
      const all = [...messages(info), ...messages(warning), ...messages(error)];
      assert.ok(/^Verified 2 files: \d+ passed, \d+ with warnings, \d+ failed\. See the output for details\.$/.test(all[0]), all[0]);
    });
  });
});
