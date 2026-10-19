import * as assert from 'assert';
import type { CertInfo, CertSubject, IntegrityResult, TrustResult, VerifyResult, VerifyStatus } from '@metaverse-systems/the-seed/dist/types';
import { describeVerification } from '../../signing/verificationMessage';

// Hand-made results only: no signing, no files and nothing from the VS Code API, so these cases run
// under plain Mocha as well as in the extension host.
//
// Wording these tests fix:
//   - <form> in a summary is the short form name: "detached", "Windows program", "installer" or "Mac program"
//   - the VALID summary ends with "Trusted by: scope <scope>" or "Trusted by: certificate <path>"
//   - details lines for a signer are "Signer: <subject>", "Fingerprint: <fp>" and "Valid: <date> to <date>" (UTC, YYYY-MM-DD)
//   - a Mac slice line is "Slice <arch>: <state text>" (any number of spaces after the colon)
//   - with both kinds of signature there is one line per kind starting "Signature embedded:" and
//     "Signature detached:" and containing that kind's status, the embedded one first
//   - every warning is "Warning: <text>" and the last line is "Not checked: <items joined by ', '>"

const NOT_CHECKED = ['certificate chains', 'revocation', 'signing time', "acceptance by the platform's own verifier"];
const NOT_CHECKED_LINE = 'Not checked: ' + NOT_CHECKED.join(', ');

const formatSubject = (subject: CertSubject): string => 'CN=' + subject.commonName + (subject.organization ? ', O=' + subject.organization : '');

const signer: CertInfo = {
  subject: { commonName: 'Signer A', organization: '@ta' },
  issuer: 'self-signed',
  fingerprint: 'SHA256:' + 'ab'.repeat(32),
  keyType: 'ECDSA P-256',
  notBefore: new Date('2026-10-18T00:00:00Z'),
  notAfter: new Date('2027-10-18T00:00:00Z'),
  isExpired: false,
  isNotYetValid: false,
  certPath: ''
};

const intact: IntegrityResult = { state: 'intact', checked: ['every page fingerprint', 'signature over the code directory'] };
const trusted: TrustResult = { state: 'trusted', anchor: { source: 'scope', scope: '@ta', fingerprint: signer.fingerprint, certPath: '/x/cert.pem' } };
const notApplicable: TrustResult = { state: 'not-applicable' };

function result(status: VerifyStatus, extra: Partial<VerifyResult>): VerifyResult {
  return {
    filePath: '/work/prog',
    status,
    integrity: intact,
    trust: trusted,
    warnings: [],
    notChecked: [...NOT_CHECKED],
    ...extra
  };
}

suite('describeVerification', () => {
  test('VALID is information with the form, signer and the scope that trusts it', () => {
    const message = describeVerification(result('VALID', { form: 'mac-program', signatureType: 'embedded', signer }), formatSubject);
    assert.strictEqual(message.severity, 'information');
    assert.ok(message.summary.startsWith('Verification: VALID ✓ (Mac program)'), message.summary);
    assert.ok(message.summary.includes('Signer: CN=Signer A, O=@ta'), message.summary);
    assert.ok(message.summary.includes('Trusted by: scope @ta'), message.summary);
  });

  test('VALID trusted by a supplied certificate names the certificate file', () => {
    const supplied: TrustResult = { state: 'trusted', anchor: { source: 'supplied', path: '/certs/b.pem', fingerprint: signer.fingerprint } };
    const message = describeVerification(result('VALID', { form: 'windows-program', signer, trust: supplied }), formatSubject);
    assert.ok(message.summary.includes('(Windows program)'), message.summary);
    assert.ok(message.summary.includes('Trusted by: certificate /certs/b.pem'), message.summary);
  });

  test('UNTRUSTED is a warning with the trust message, the signer and its fingerprint', () => {
    const untrusted: TrustResult = { state: 'untrusted', reason: 'unknown-signer', message: 'signer certificate is not one of the trusted certificates' };
    const message = describeVerification(result('UNTRUSTED', { form: 'installer', signer, trust: untrusted, reason: untrusted.message }), formatSubject);
    assert.strictEqual(message.severity, 'warning');
    assert.ok(message.summary.startsWith('Verification: intact, NOT TRUSTED (installer)'), message.summary);
    assert.ok(message.summary.includes('signer certificate is not one of the trusted certificates'), message.summary);
    assert.ok(message.summary.includes('Signer: CN=Signer A, O=@ta'), message.summary);
    assert.ok(message.summary.includes('Fingerprint: ' + signer.fingerprint), message.summary);
  });

  test('UNTRUSTED for an ad-hoc signed program says the signature has no signer', () => {
    const adHoc: TrustResult = { state: 'untrusted', reason: 'no-signer', message: 'the signature has no signer (ad-hoc)' };
    const message = describeVerification(result('UNTRUSTED', { form: 'mac-program', trust: adHoc, reason: adHoc.message }), formatSubject);
    assert.strictEqual(message.severity, 'warning');
    assert.ok(message.summary.includes('NOT TRUSTED'), message.summary);
    assert.ok(message.summary.includes('the signature has no signer'), message.summary);
    assert.ok(!message.summary.includes('Signer:'), message.summary);
    assert.ok(!message.summary.includes('Fingerprint:'), message.summary);
  });

  test('NOT_CHECKED is a warning with the reason', () => {
    const notChecked: IntegrityResult = { state: 'not-checked', reason: 'the native component could not be loaded', checked: [] };
    const message = describeVerification(result('NOT_CHECKED', { form: 'windows-program', integrity: notChecked, trust: notApplicable, reason: notChecked.reason }), formatSubject);
    assert.strictEqual(message.severity, 'warning');
    assert.ok(message.summary.startsWith('Verification: signature present, NOT CHECKED (Windows program)'), message.summary);
    assert.ok(message.summary.includes('the native component could not be loaded'), message.summary);
  });

  test('INVALID is an error with the reason', () => {
    const invalid: IntegrityResult = { state: 'invalid', reason: 'slice arm64: page 1 fingerprint does not match', checked: [] };
    const message = describeVerification(result('INVALID', { form: 'mac-program', integrity: invalid, reason: invalid.reason }), formatSubject);
    assert.strictEqual(message.severity, 'error');
    assert.ok(message.summary.startsWith('Verification: INVALID ✗ (Mac program)'), message.summary);
    assert.ok(message.summary.includes('slice arm64: page 1 fingerprint does not match'), message.summary);
  });

  test('NOT_FULLY_SIGNED is an error with the reason', () => {
    const partly: IntegrityResult = { state: 'invalid', reason: 'slice x86_64 is not signed', checked: [], unsignedOnly: ['x86_64'] };
    const message = describeVerification(result('NOT_FULLY_SIGNED', { form: 'mac-program', integrity: partly, reason: partly.reason }), formatSubject);
    assert.strictEqual(message.severity, 'error');
    assert.ok(message.summary.startsWith('Verification: NOT FULLY SIGNED ✗ (Mac program)'), message.summary);
    assert.ok(message.summary.includes('slice x86_64 is not signed'), message.summary);
  });

  test('NOT_FOUND is information saying no signature was found', () => {
    const none: IntegrityResult = { state: 'none', reason: 'no signature', checked: [] };
    const message = describeVerification(result('NOT_FOUND', { integrity: none, trust: notApplicable, reason: none.reason }), formatSubject);
    assert.strictEqual(message.severity, 'information');
    assert.strictEqual(message.summary, 'No signature found for this file.');
  });

  test('details start with Integrity, Trust and Form, then the signer, one line per Mac slice, warnings and the not-checked list', () => {
    const message = describeVerification(
      result('VALID', {
        form: 'mac-program',
        signatureType: 'embedded',
        signer,
        warnings: ['the certificate expires on 2027-10-18'],
        slices: [
          { arch: 'x86_64', cpuType: 0x01000007, offset: 4096, size: 8192, state: 'intact', codeDirectories: [{ slot: 0, hashType: 'sha256', pages: 2, pagesMismatched: 0, codeLimit: 8192 }], adHoc: false },
          { arch: 'arm64', cpuType: 0x0100000c, offset: 16384, size: 20480, state: 'intact', codeDirectories: [{ slot: 0, hashType: 'sha256', pages: 5, pagesMismatched: 0, codeLimit: 20480 }], adHoc: false }
        ]
      }),
      formatSubject
    );
    const details = message.details;
    assert.ok(details[0].startsWith('Integrity: intact'), details[0]);
    assert.ok(details[1].startsWith('Trust: trusted: certificate of scope @ta'), details[1]);
    assert.ok(details[2].startsWith('Form: Mac program (embedded, 2 slices)'), details[2]);
    const at = (pattern: RegExp): number => details.findIndex((line) => pattern.test(line));
    const indexes = [
      at(/^Signer: CN=Signer A, O=@ta$/),
      at(new RegExp('^Fingerprint: ' + signer.fingerprint + '$')),
      at(/^Valid: 2026-10-18 to 2027-10-18$/),
      at(/^Slice x86_64: +intact/),
      at(/^Slice arm64: +intact/),
      at(/^Warning: the certificate expires on 2027-10-18$/),
      details.length - 1
    ];
    for (const index of indexes) {
      assert.ok(index >= 3, 'a line is missing from: ' + details.join(' / '));
    }
    assert.deepStrictEqual([...indexes].sort((a, b) => a - b), indexes, 'lines are out of order: ' + details.join(' / '));
    assert.strictEqual(details[details.length - 1], NOT_CHECKED_LINE);
  });

  test('the form of a detached signature names its signature file, as the command line does', () => {
    const message = describeVerification(result('VALID', { form: 'detached', signatureType: 'detached', signer, filePath: '/work/config.json' }), formatSubject);
    assert.ok(message.details.includes('Form: detached (config.json.sig)'), message.details.join('\n'));
  });

  test('a result with both kinds of signature lists both, the embedded one first', () => {
    const embedded = result('VALID', { form: 'windows-program', signatureType: 'embedded', signer });
    const bad: IntegrityResult = { state: 'invalid', reason: 'stale detached signature: the file changed after it was made', checked: [] };
    const detached = result('INVALID', { form: 'detached', signatureType: 'detached', integrity: bad, reason: bad.reason });
    const message = describeVerification(
      result('INVALID', { form: 'windows-program', integrity: bad, reason: bad.reason, signer, signatures: [embedded, detached], warnings: ['both an embedded and a detached signature are present'] }),
      formatSubject
    );
    assert.strictEqual(message.severity, 'error');
    const first = message.details.findIndex((line) => /^Signature embedded\b.*VALID/.test(line));
    const second = message.details.findIndex((line) => /^Signature detached\b.*INVALID/.test(line));
    assert.ok(first >= 0, message.details.join(' / '));
    assert.ok(second > first, message.details.join(' / '));
    assert.ok(message.details.includes('Warning: both an embedded and a detached signature are present'));
  });

  test('every warning is in the details, in order', () => {
    const warnings = ['the certificate has expired', 'a nested signature was found', 'both an embedded and a detached signature are present'];
    const message = describeVerification(result('VALID', { form: 'installer', signer, warnings }), formatSubject);
    const lines = message.details.filter((line) => line.startsWith('Warning: '));
    assert.deepStrictEqual(lines, warnings.map((warning) => 'Warning: ' + warning));
  });

  test('the not-checked list is always the last line, for every status, with file-specific items after the fixed four', () => {
    const statuses: VerifyStatus[] = ['VALID', 'UNTRUSTED', 'NOT_CHECKED', 'INVALID', 'NOT_FULLY_SIGNED', 'NOT_FOUND'];
    for (const status of statuses) {
      const message = describeVerification(result(status, { form: 'mac-program', signer, notChecked: [...NOT_CHECKED, 'the extended signature stream'] }), formatSubject);
      assert.strictEqual(message.details[message.details.length - 1], NOT_CHECKED_LINE + ', the extended signature stream', status);
    }
    const plain = describeVerification(result('VALID', { form: 'installer', signer }), formatSubject);
    assert.strictEqual(plain.details[plain.details.length - 1], NOT_CHECKED_LINE);
  });
});
