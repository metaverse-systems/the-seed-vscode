import type { CertSubject, SignatureForm, VerifyResult } from '@metaverse-systems/the-seed/types';

/**
 * What the verify command shows for one verification: a severity and one-line summary for the notification,
 * and the lines for the output channel (integrity and trust separately, the form, the signer, one line per
 * Mac slice, one per signature when a file has both kinds, every warning, and what was not checked).
 *
 * Only types are imported from the-seed and nothing from the VS Code API, so this runs under plain Mocha.
 */
export interface VerificationMessage {
  severity: 'information' | 'warning' | 'error';
  summary: string;
  details: string[];
}

const FORM_NAMES: Record<SignatureForm, string> = {
  'detached': 'detached',
  'windows-program': 'Windows program',
  'installer': 'installer',
  'mac-program': 'Mac program'
};

const day = (date: Date): string => new Date(date).toISOString().slice(0, 10);

function formName(result: VerifyResult): string {
  return result.form ? FORM_NAMES[result.form] : 'unknown form';
}

function formDetail(result: VerifyResult): string {
  const kind = result.signatureType === 'detached' ? 'detached' : 'embedded';
  if (result.form === 'mac-program') {
    const count = result.slices?.length ?? 0;
    return count > 1 ? `Mac program (embedded, ${count} slices)` : 'Mac program (embedded)';
  }
  if (result.form === 'detached') {
    const name = result.filePath.split(/[\\/]/).pop() ?? result.filePath;
    return `detached (${name}.sig)`;
  }
  return result.form ? `${FORM_NAMES[result.form]} (${kind})` : 'none';
}

function integrityText(result: VerifyResult): string {
  const integrity = result.integrity;
  switch (integrity.state) {
    case 'intact':
      return `intact (${integrity.checked.join(', ')})`;
    case 'invalid':
      return `invalid: ${integrity.reason ?? 'unknown reason'}`;
    case 'not-checked':
      return `not checked: ${integrity.reason ?? 'unknown reason'}`;
    default:
      return `no signature: ${integrity.reason ?? 'none found'}`;
  }
}

function trustText(result: VerifyResult): string {
  const trust = result.trust;
  if (trust.state === 'trusted' && trust.anchor) {
    return trust.anchor.source === 'scope'
      ? `trusted: certificate of scope ${trust.anchor.scope}`
      : `trusted: supplied certificate ${trust.anchor.path}`;
  }
  if (trust.state === 'untrusted') {
    return `not trusted: ${trust.message ?? 'signer is not trusted'}`;
  }
  return 'not applicable';
}

function trustedBy(result: VerifyResult): string {
  const anchor = result.trust.anchor;
  if (!anchor) {
    return 'Unknown';
  }
  return anchor.source === 'scope' ? `scope ${anchor.scope}` : `certificate ${anchor.path}`;
}

function sliceLine(slice: NonNullable<VerifyResult['slices']>[number]): string {
  let text: string;
  switch (slice.state) {
    case 'intact':
      text = slice.adHoc ? 'ad-hoc (no signer)' : `intact (${slice.codeDirectories[0]?.pages ?? 0} pages)`;
      break;
    case 'invalid':
      text = `invalid: ${slice.reason ?? 'unknown reason'}`;
      break;
    case 'not-checked':
      text = `not checked: ${slice.reason ?? 'unknown reason'}`;
      break;
    default:
      text = 'unsigned';
  }
  return `Slice ${slice.arch}: ${text}`;
}

function buildDetails(result: VerifyResult, formatSubject: (subject: CertSubject) => string): string[] {
  const details = [`Integrity: ${integrityText(result)}`, `Trust: ${trustText(result)}`];
  const kinds = result.signatures;
  if (kinds && kinds.length === 2) {
    details.push(`Form: ${formDetail(kinds[0])} and ${formDetail(kinds[1])}`);
  } else {
    details.push(`Form: ${formDetail(result)}`);
  }
  if (result.signer) {
    details.push(`Signer: ${formatSubject(result.signer.subject)}`);
    details.push(`Fingerprint: ${result.signer.fingerprint}`);
    details.push(`Valid: ${day(result.signer.notBefore)} to ${day(result.signer.notAfter)}`);
  }
  for (const slice of result.slices ?? []) {
    details.push(sliceLine(slice));
  }
  if (kinds && kinds.length === 2) {
    for (const kind of kinds) {
      const name = kind.signatureType === 'detached' ? 'detached' : 'embedded';
      details.push(`Signature ${name}: ${kind.status} | Integrity: ${integrityText(kind)} | Trust: ${trustText(kind)}`);
    }
  }
  for (const warning of result.warnings) {
    details.push(`Warning: ${warning}`);
  }
  details.push(`Not checked: ${result.notChecked.join(', ')}`);
  return details;
}

/**
 * Describe a verification result for the user. `formatSubject` renders a certificate subject
 * (Signing.formatSubject in the command).
 */
export function describeVerification(
  result: VerifyResult,
  formatSubject: (subject: CertSubject) => string
): VerificationMessage {
  const details = buildDetails(result, formatSubject);
  const form = formName(result);
  const reason = result.reason ?? 'unknown reason';
  const signer = result.signer ? formatSubject(result.signer.subject) : 'Unknown';

  switch (result.status) {
    case 'VALID':
      return {
        severity: 'information',
        summary: `Verification: VALID ✓ (${form}) | Signer: ${signer} | Trusted by: ${trustedBy(result)}`,
        details
      };
    case 'UNTRUSTED': {
      const message = result.trust.reason === 'no-signer' ? 'the signature has no signer' : (result.trust.message ?? reason);
      const parts = [`Verification: intact, NOT TRUSTED (${form})`, message];
      if (result.signer) {
        parts.push(`Signer: ${signer}`, `Fingerprint: ${result.signer.fingerprint}`);
      }
      return { severity: 'warning', summary: parts.join(' | '), details };
    }
    case 'NOT_CHECKED':
      return { severity: 'warning', summary: `Verification: signature present, NOT CHECKED (${form}) | ${reason}`, details };
    case 'INVALID':
      return { severity: 'error', summary: `Verification: INVALID ✗ (${form}) | ${reason}`, details };
    case 'NOT_FULLY_SIGNED':
      return { severity: 'error', summary: `Verification: NOT FULLY SIGNED ✗ (${form}) | ${reason}`, details };
    default:
      return { severity: 'information', summary: 'No signature found for this file.', details };
  }
}
