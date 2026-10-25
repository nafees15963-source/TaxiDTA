import { createHash, createPrivateKey, randomBytes } from "node:crypto";
import {
  inspectSleCertificate,
  verifyLocalCertificateChain,
} from "./certificates.ts";
import { DtaCryptoError, fdPath, runOpenSsl } from "./openssl.ts";

/**
 * Local cryptographic subset of GGT16 (02.09.2025, valid01.01.2026), §§2/3.
 * No TA serializer, official trust import, routing, transport, receipt or GKV admission.
 * Payload is piped. Temporary keys use encrypted PKCS8 with a random in-memory password.
 */
export async function createLocalSeconEnvelope(input: {
  payload: Uint8Array;
  sender: {
    certificatePem: string;
    privateKeyPem: string;
    expectedIk: string;
    passphrase?: string;
  };
  recipient: { certificatePem: string; expectedIk: string };
  intermediatePems?: readonly string[];
  anchorPems: readonly string[];
  crlPems?: readonly string[];
  at?: Date;
}): Promise<{
  profile: "SECON-2026-cryptographic-subset";
  productionReady: false;
  encryptedDer: Buffer;
  payloadSha256: string;
  senderCertificateSha256: string;
  recipientCertificateSha256: string;
  revocationChecked: boolean;
  blockers: string[];
}> {
  if (
    !(input.payload instanceof Uint8Array) ||
    input.payload.byteLength === 0 ||
    input.payload.byteLength > 16 * 1024 * 1024
  ) {
    throw new DtaCryptoError(
      "PAYLOAD_SIZE",
      "Die Nutzdaten überschreiten das lokale Prüfprofil oder fehlen.",
    );
  }
  // Caller-owned arrays, nested objects, Date and payload may change while OpenSSL awaits.
  // Snapshot before the first await, so inspected fingerprints describe exactly the bytes used.
  const snapshot = {
    sender: { ...input.sender },
    recipient: { ...input.recipient },
    anchorPems: [...input.anchorPems],
    intermediatePems: input.intermediatePems
      ? [...input.intermediatePems]
      : undefined,
    crlPems: input.crlPems ? [...input.crlPems] : undefined,
    at: input.at ? new Date(input.at.getTime()) : new Date(),
  };
  const payload = Buffer.from(input.payload);
  let signed: Buffer | undefined;
  const signInputs: Buffer[] = [];
  try {
    const at = snapshot.at;
    if (at.getUTCFullYear() !== 2026) {
      throw new DtaCryptoError(
        "CRYPTO_PROFILE_DATE",
        "Dieser Baustein wurde ausschließlich für das Kryptoprofil 2026 geprüft.",
      );
    }
    const sender = inspectSleCertificate({ ...snapshot.sender, at });
    const recipient = inspectSleCertificate({ ...snapshot.recipient, at });
    const chainOptions = {
      anchorPems: snapshot.anchorPems,
      intermediatePems: snapshot.intermediatePems,
      crlPems: snapshot.crlPems,
      at,
    };
    await verifyLocalCertificateChain({
      ...chainOptions,
      certificatePem: snapshot.sender.certificatePem,
    });
    const recipientChain = await verifyLocalCertificateChain({
      ...chainOptions,
      certificatePem: snapshot.recipient.certificatePem,
    });
    if (
      snapshot.sender.passphrase?.includes("\n") ||
      snapshot.sender.passphrase?.includes("\r") ||
      snapshot.sender.passphrase?.includes("\0")
    ) {
      throw new DtaCryptoError(
        "PASSPHRASE_ENCODING",
        "Dieses lokale Werkzeug unterstützt keine Zeilenumbrüche im Schlüsselpasswort.",
      );
    }
    const chain = [
      ...(snapshot.intermediatePems ?? []),
      ...snapshot.anchorPems,
    ].join("\n");
    const signArgs = [
      "cms",
      "-sign",
      "-binary",
      "-nodetach",
      "-nosmimecap",
      "-md",
      "sha256",
      "-outform",
      "DER",
      "-signer",
      fdPath(3),
      "-inkey",
      fdPath(4),
      "-certfile",
      fdPath(5),
      "-keyopt",
      "rsa_padding_mode:pss",
      "-keyopt",
      "rsa_pss_saltlen:32",
      "-keyopt",
      "rsa_mgf1_md:sha256",
    ];
    const temporaryPassword = randomBytes(32).toString("hex");
    const encryptedTemporaryKey = createPrivateKey({
      key: snapshot.sender.privateKeyPem,
      passphrase: snapshot.sender.passphrase,
    }).export({
      type: "pkcs8",
      format: "pem",
      cipher: "aes-256-cbc",
      passphrase: temporaryPassword,
    });
    signInputs.push(
      Buffer.from(snapshot.sender.certificatePem),
      Buffer.from(encryptedTemporaryKey),
      Buffer.from(chain),
    );
    // Always provide passin: OpenSSL must never prompt interactively.
    signArgs.push("-passin", `fd:${signInputs.length + 3}`);
    signInputs.push(Buffer.from(`${temporaryPassword}\n`));
    signed = await runOpenSsl(signArgs, payload, signInputs);
    const encryptedDer = await runOpenSsl(
      [
        "cms",
        "-encrypt",
        "-binary",
        "-outform",
        "DER",
        "-aes-256-cbc",
        "-recip",
        fdPath(3),
        "-keyopt",
        "rsa_padding_mode:oaep",
        "-keyopt",
        "rsa_oaep_md:sha256",
        "-keyopt",
        "rsa_mgf1_md:sha256",
      ],
      signed,
      [Buffer.from(snapshot.recipient.certificatePem)],
    );
    return {
      profile: "SECON-2026-cryptographic-subset",
      productionReady: false,
      encryptedDer,
      payloadSha256: createHash("sha256").update(payload).digest("hex"),
      senderCertificateSha256: sender.certificateSha256,
      recipientCertificateSha256: recipient.certificateSha256,
      revocationChecked: recipientChain.revocationChecked,
      blockers: [
        "TA_PAYLOAD_NOT_VALIDATED",
        "OFFICIAL_TRUST_IMPORT_NOT_RELEASED",
        ...(recipientChain.revocationChecked ? [] : ["REVOCATION_UNCHECKED"]),
        "FULL_CERTIFICATE_PROFILE_NOT_VALIDATED",
        "OFFICIAL_ROUTING_NOT_VERIFIED",
        "TRANSPORT_NOT_IMPLEMENTED",
        "RECIPIENT_TEST_OUTSTANDING",
      ],
    };
  } finally {
    payload.fill(0);
    signed?.fill(0);
    signInputs.forEach((buffer) => buffer.fill(0));
  }
}
