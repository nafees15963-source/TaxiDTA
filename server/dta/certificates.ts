import {X509Certificate, createPrivateKey} from 'node:crypto';
import {assertIkSyntax} from '../../src/domain/dta/filenames.ts';
import {DtaCryptoError, fdPath, runOpenSsl} from './openssl.ts';

export interface LocalCertificateInspection {
  certificateSha256: string;
  subjectIk: string;
  validFrom: string;
  validUntil: string;
  rsaBits: 4096;
  publicExponent: '65537';
  privateKeyMatches: boolean | null;
  productionReady: false;
}

export function parseSingleCertificate(pem: string): X509Certificate {
  if (typeof pem !== 'string' || pem.length > 32_768 || !/^\s*-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END CERTIFICATE-----\s*$/.test(pem)) {
    throw new DtaCryptoError('CERTIFICATE_ENCODING', 'Genau ein PEM-kodiertes Zertifikat wird erwartet.');
  }
  try { return new X509Certificate(pem); }
  catch { throw new DtaCryptoError('CERTIFICATE_ENCODING', 'Das Zertifikat kann nicht gelesen werden.'); }
}

/** Offline checks only; caller-supplied certificates do not establish GKV trust or routing. */
export function inspectSleCertificate(input: {
  certificatePem: string;
  expectedIk: string;
  at?: Date;
  privateKeyPem?: string;
  passphrase?: string;
}): LocalCertificateInspection {
  assertIkSyntax(input.expectedIk);
  const certificate = parseSingleCertificate(input.certificatePem);
  const at = input.at ?? new Date();
  const validFrom = new Date(certificate.validFrom);
  const validUntil = new Date(certificate.validTo);
  if (!Number.isFinite(at.getTime())) throw new DtaCryptoError('CERTIFICATE_TIME', 'Der Prüfzeitpunkt ist ungültig.');
  if (at < validFrom) throw new DtaCryptoError('CERTIFICATE_NOT_YET_VALID', 'Das Zertifikat ist noch nicht gültig.');
  if (at > validUntil) throw new DtaCryptoError('CERTIFICATE_EXPIRED', 'Das Zertifikat ist abgelaufen.');
  if (certificate.ca) throw new DtaCryptoError('CERTIFICATE_IS_CA', 'Ein CA-Zertifikat ist kein Teilnehmerzertifikat.');
  // Structured subject values preserve duplicate OU fields; never parse the printable DN.
  const subject = certificate.toLegacyObject().subject;
  const ou = subject.OU;
  const organizationalUnits = Array.isArray(ou) ? ou : typeof ou === 'string' ? [ou] : [];
  const identifiers = organizationalUnits.filter(value => /^IK\d{9}$/.test(value));
  if (subject.C !== 'DE' || identifiers.length !== 1 || identifiers[0] !== `IK${input.expectedIk}`) {
    throw new DtaCryptoError('CERTIFICATE_IK_MISMATCH', 'Das Zertifikat ist dem ausdrücklich erwarteten IK nicht eindeutig zugeordnet.');
  }
  const key = certificate.publicKey;
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails?.modulusLength !== 4096 || key.asymmetricKeyDetails?.publicExponent !== 65537n) {
    throw new DtaCryptoError('CERTIFICATE_KEY_PROFILE', 'Dieses enge Profil verlangt RSA 4096 mit Exponent 65537.');
  }
  let privateKeyMatches: boolean | null = null;
  if (input.privateKeyPem !== undefined) {
    if (input.privateKeyPem.length > 32_768) throw new DtaCryptoError('PRIVATE_KEY_INVALID', 'Der private Schlüssel kann nicht geprüft werden.');
    try {
      const privateKey = createPrivateKey({key: input.privateKeyPem, passphrase: input.passphrase});
      privateKeyMatches = certificate.checkPrivateKey(privateKey);
    } catch { throw new DtaCryptoError('PRIVATE_KEY_INVALID', 'Schlüssel oder Schlüsselpasswort können nicht geprüft werden.'); }
    if (!privateKeyMatches) throw new DtaCryptoError('PRIVATE_KEY_MISMATCH', 'Der private Schlüssel gehört nicht zum Teilnehmerzertifikat.');
  }
  return {
    certificateSha256: certificate.fingerprint256.replaceAll(':', '').toLowerCase(),
    subjectIk: input.expectedIk, validFrom: validFrom.toISOString(), validUntil: validUntil.toISOString(),
    rsaBits: 4096, publicExponent: '65537', privateKeyMatches, productionReady: false,
  };
}

/** Verifies a local chain to explicitly supplied anchors. There is no system-CA fallback or network fetch. */
export async function verifyLocalCertificateChain(input: {
  certificatePem: string;
  intermediatePems?: readonly string[];
  anchorPems: readonly string[];
  crlPems?: readonly string[];
  at?: Date;
}): Promise<{chainVerified: true; revocationChecked: boolean; trustScope: 'caller-supplied-anchors'; productionReady: false}> {
  parseSingleCertificate(input.certificatePem);
  if (input.anchorPems.length < 1 || input.anchorPems.length > 8 || (input.intermediatePems?.length ?? 0) > 8 || (input.crlPems?.length ?? 0) > 8) {
    throw new DtaCryptoError('TRUST_ANCHORS_MISSING', 'Eine begrenzte, ausdrücklich vorgegebene Vertrauenskette ist erforderlich.');
  }
  input.anchorPems.forEach(parseSingleCertificate);
  input.intermediatePems?.forEach(parseSingleCertificate);
  const at = input.at ?? new Date();
  if (!Number.isFinite(at.getTime())) throw new DtaCryptoError('CERTIFICATE_TIME', 'Der Prüfzeitpunkt ist ungültig.');
  const sources = [Buffer.from(input.anchorPems.join('\n')), Buffer.from(input.certificatePem)];
  const args = ['verify', '-no-CApath', '-no-CAstore', '-CAfile', fdPath(3), '-attime', String(Math.floor(at.getTime() / 1000)), '-x509_strict', '-auth_level', '2', '-purpose', 'any'];
  if (input.intermediatePems?.length) {
    args.push('-untrusted', fdPath(sources.length + 3));
    sources.push(Buffer.from(input.intermediatePems.join('\n')));
  }
  const revocationChecked = Boolean(input.crlPems?.length);
  if (revocationChecked) {
    for (const crl of input.crlPems!) {
      if (crl.length > 1024 * 1024 || !/^\s*-----BEGIN X509 CRL-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END X509 CRL-----\s*$/.test(crl)) {
        throw new DtaCryptoError('CRL_ENCODING', 'Die Sperrliste ist nicht im unterstützten PEM-Format.');
      }
    }
    args.push('-CRLfile', fdPath(sources.length + 3), '-crl_check_all');
    sources.push(Buffer.from(input.crlPems!.join('\n')));
  }
  args.push(fdPath(4));
  await runOpenSsl(args, new Uint8Array(), sources);
  return {chainVerified: true, revocationChecked, trustScope: 'caller-supplied-anchors', productionReady: false};
}
