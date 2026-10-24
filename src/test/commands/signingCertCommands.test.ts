// Certificate commands through the command registry: Import Signing
// Certificate, Signing Certificate Info and Export Signing Certificate. The
// scope pick, the file dialogs and the notifications are stubbed; certificates
// are made and read with the loaded tool in a scratch home. None of these
// commands calls the tool's native component, so every case runs on every
// platform.
import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { createCertFor, writeScopes } from '../helpers/scratchHome';
import { useScratchState } from '../helpers/scratchState';
import { testTool } from '../helpers/tool';

const SCOPE = '@only';

suite('Signing Certificate Commands', () => {
  const state = useScratchState({ scopes: { [SCOPE]: 'Only Author' } });
  let info: sinon.SinonStub;
  let warning: sinon.SinonStub;
  let error: sinon.SinonStub;

  setup(() => {
    info = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    warning = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);
    error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
  });

  function messages(stub: sinon.SinonStub): string[] {
    return stub.getCalls().map((call) => String(call.args[0]));
  }

  function signing(): InstanceType<ReturnType<typeof testTool>['Signing']> {
    return new (testTool().Signing)();
  }

  /** A certificate and key made by the tool for the scope, copied out, and the scope's own removed. */
  async function certificateFiles(): Promise<{ cert: string; key: string; fingerprint: string }> {
    const fingerprint = await createCertFor(SCOPE);
    const dir = state.dir('certificate');
    const cert = path.join(dir, 'cert.pem');
    const key = path.join(dir, 'key.pem');
    fs.copyFileSync(signing().scopeCertPath(SCOPE), cert);
    fs.copyFileSync(signing().scopeKeyPath(SCOPE), key);
    fs.rmSync(path.dirname(signing().scopeCertPath(SCOPE)), { recursive: true, force: true });
    return { cert, key, fingerprint };
  }

  function stubDialogs(...files: (string | undefined)[]): sinon.SinonStub {
    const dialog = sinon.stub(vscode.window, 'showOpenDialog');
    files.forEach((file, index) => {
      dialog.onCall(index).resolves(file === undefined ? undefined : [vscode.Uri.file(file)]);
    });
    return dialog;
  }

  suite('Import Signing Certificate', () => {
    test('a dismissed scope pick does nothing', async () => {
      writeScopes({ '@a': 'A', '@b': 'B' });
      const pick = sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);
      const dialog = sinon.stub(vscode.window, 'showOpenDialog').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.importSigningCert');

      assert.strictEqual(pick.callCount, 1);
      assert.ok(dialog.notCalled, 'no file is asked for');
      assert.strictEqual(signing().hasCert('@a'), false);
      assert.strictEqual(signing().hasCert('@b'), false);
      assert.strictEqual(info.callCount + warning.callCount + error.callCount, 0);
    });

    test('a dismissed certificate dialog does nothing', async () => {
      const dialog = stubDialogs(undefined);

      await vscode.commands.executeCommand('the-seed.importSigningCert');

      assert.strictEqual(dialog.callCount, 1);
      assert.strictEqual(signing().hasCert(SCOPE), false);
      assert.strictEqual(info.callCount + warning.callCount + error.callCount, 0);
    });

    test('a dismissed key dialog does nothing', async () => {
      const files = await certificateFiles();
      const dialog = stubDialogs(files.cert, undefined);

      await vscode.commands.executeCommand('the-seed.importSigningCert');

      assert.strictEqual(dialog.callCount, 2);
      assert.strictEqual(signing().hasCert(SCOPE), false);
      assert.strictEqual(info.callCount + warning.callCount + error.callCount, 0);
    });

    test('a successful import shows the subject and fingerprint', async () => {
      const files = await certificateFiles();
      stubDialogs(files.cert, files.key);

      await vscode.commands.executeCommand('the-seed.importSigningCert');

      const stored = signing().getCertInfo(SCOPE);
      assert.ok(stored, 'the certificate is stored for the scope');
      assert.strictEqual(stored.fingerprint, files.fingerprint);
      assert.ok(warning.notCalled, 'no overwrite question without a certificate');
      assert.deepStrictEqual(messages(info), [
        `Certificate imported. Subject: ${signing()._formatSubject(stored.subject)} | Fingerprint: ${files.fingerprint}`,
      ]);
      assert.ok(error.notCalled);
    });

    test('an existing certificate asks before overwriting, and Cancel keeps it', async () => {
      const files = await certificateFiles();
      const existing = await createCertFor(SCOPE);
      stubDialogs(files.cert, files.key);
      warning.resolves('Cancel');

      await vscode.commands.executeCommand('the-seed.importSigningCert');

      assert.strictEqual(warning.callCount, 1);
      assert.deepStrictEqual(warning.firstCall.args, ['A signing certificate already exists. Overwrite?', 'Overwrite', 'Cancel']);
      assert.strictEqual(signing().getCertInfo(SCOPE)?.fingerprint, existing);
      assert.ok(info.notCalled);
      assert.ok(error.notCalled);
    });

    test('an existing certificate is replaced after Overwrite', async () => {
      const files = await certificateFiles();
      await createCertFor(SCOPE);
      stubDialogs(files.cert, files.key);
      warning.resolves('Overwrite');

      await vscode.commands.executeCommand('the-seed.importSigningCert');

      assert.strictEqual(warning.callCount, 1);
      assert.strictEqual(signing().getCertInfo(SCOPE)?.fingerprint, files.fingerprint);
      assert.strictEqual(info.callCount, 1);
    });

    test('a key that does not belong to the certificate shows Import failed', async () => {
      const files = await certificateFiles();
      const other = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      const badKey = path.join(state.dir('bad-key'), 'key.pem');
      fs.writeFileSync(badKey, other.privateKey.export({ type: 'pkcs8', format: 'pem' }));
      stubDialogs(files.cert, badKey);

      await vscode.commands.executeCommand('the-seed.importSigningCert');

      assert.deepStrictEqual(messages(error), ['Import failed: Certificate and key do not match.']);
      assert.strictEqual(signing().hasCert(SCOPE), false);
      assert.ok(info.notCalled);
    });

    test('an unreadable key file shows Import failed with the reason', async () => {
      const files = await certificateFiles();
      const badKey = path.join(state.dir('bad-key'), 'key.pem');
      fs.writeFileSync(badKey, 'not a key\n');
      stubDialogs(files.cert, badKey);

      await vscode.commands.executeCommand('the-seed.importSigningCert');

      assert.strictEqual(error.callCount, 1);
      const shown = String(error.firstCall.args[0]);
      assert.ok(shown.startsWith(`Import failed: The key file ${badKey} cannot be read: `), shown);
      assert.strictEqual(signing().hasCert(SCOPE), false);
      assert.ok(info.notCalled);
    });
  });

  suite('Signing Certificate Info', () => {
    let executed: string[];

    setup(() => {
      executed = [];
      const original = vscode.commands.executeCommand.bind(vscode.commands);
      sinon.stub(vscode.commands, 'executeCommand').callsFake(((command: string, ...args: unknown[]) => {
        executed.push(command);
        if (command === 'the-seed.createSigningCert' || command === 'the-seed.importSigningCert') {
          return Promise.resolve(undefined);
        }
        return original(command, ...args);
      }) as typeof vscode.commands.executeCommand);
    });

    for (const [action, command] of [['Create', 'the-seed.createSigningCert'], ['Import', 'the-seed.importSigningCert']] as const) {
      test(`no certificate offers Create and Import, and ${action} runs ${command}`, async () => {
        info.resolves(action);

        await vscode.commands.executeCommand('the-seed.signingCertInfo');

        assert.strictEqual(info.callCount, 1);
        assert.deepStrictEqual(info.firstCall.args, ['No signing certificate found.', 'Create', 'Import']);
        assert.deepStrictEqual(executed, ['the-seed.signingCertInfo', command]);
      });
    }

    test('with a certificate, the subject, issuer, status and fingerprint are shown', async () => {
      const fingerprint = await createCertFor(SCOPE);
      const stored = signing().getCertInfo(SCOPE);
      assert.ok(stored);

      await vscode.commands.executeCommand('the-seed.signingCertInfo');

      assert.deepStrictEqual(messages(info), [
        `Certificate: ${signing()._formatSubject(stored.subject)} | Issuer: ${stored.issuer} | Status: Active | Fingerprint: ${fingerprint}`,
      ]);
      assert.deepStrictEqual(executed, ['the-seed.signingCertInfo']);
      assert.ok(error.notCalled);
    });
  });

  suite('Export Signing Certificate', () => {
    test('no certificate gives the error and asks for no file', async () => {
      const dialog = sinon.stub(vscode.window, 'showSaveDialog').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.exportSigningCert');

      assert.deepStrictEqual(messages(error), [`No signing certificate for scope ${SCOPE}.`]);
      assert.ok(dialog.notCalled);
      assert.ok(info.notCalled);
    });

    test('a dismissed save dialog writes nothing', async () => {
      await createCertFor(SCOPE);
      const target = state.dir('export');
      const dialog = sinon.stub(vscode.window, 'showSaveDialog').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.exportSigningCert');

      assert.strictEqual(dialog.callCount, 1);
      const options = dialog.firstCall.args[0] as vscode.SaveDialogOptions;
      assert.strictEqual(path.basename(options.defaultUri!.fsPath), 'signing-cert.pem');
      assert.deepStrictEqual(options.filters, { 'PEM Files': ['pem'] });
      assert.deepStrictEqual(fs.readdirSync(target), []);
      assert.ok(info.notCalled);
      assert.ok(error.notCalled);
    });

    test('with a folder open the save dialog starts at signing-cert.pem in the first folder', async () => {
      await createCertFor(SCOPE);
      const first = state.dir('first');
      state.setWorkspaceFolders([first, state.dir('second')]);
      const dialog = sinon.stub(vscode.window, 'showSaveDialog').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.exportSigningCert');

      assert.strictEqual(dialog.callCount, 1);
      const options = dialog.firstCall.args[0] as vscode.SaveDialogOptions;
      assert.strictEqual(options.defaultUri?.fsPath, path.join(first, 'signing-cert.pem'));
    });

    test('with no folder open the save dialog starts at signing-cert.pem in the home directory', async () => {
      await createCertFor(SCOPE);
      assert.strictEqual(os.homedir(), state.home, 'the home directory is the scratch home');
      const dialog = sinon.stub(vscode.window, 'showSaveDialog').resolves(undefined);

      await vscode.commands.executeCommand('the-seed.exportSigningCert');

      assert.strictEqual(dialog.callCount, 1);
      const options = dialog.firstCall.args[0] as vscode.SaveDialogOptions;
      assert.strictEqual(options.defaultUri?.fsPath, path.join(state.home, 'signing-cert.pem'));
    });

    test('an export writes the PEM to the chosen path and shows it', async () => {
      await createCertFor(SCOPE);
      const destination = path.join(state.dir('export'), 'exported.pem');
      sinon.stub(vscode.window, 'showSaveDialog').resolves(vscode.Uri.file(destination));

      await vscode.commands.executeCommand('the-seed.exportSigningCert');

      assert.strictEqual(
        fs.readFileSync(destination, 'utf-8'),
        fs.readFileSync(signing().scopeCertPath(SCOPE), 'utf-8')
      );
      assert.ok(!fs.readFileSync(destination, 'utf-8').includes('PRIVATE KEY'), 'no key is exported');
      assert.deepStrictEqual(messages(info), [`Certificate exported to ${destination}`]);
      assert.ok(error.notCalled);
    });
  });
});
