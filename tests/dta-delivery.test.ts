import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, X509Certificate } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DtaValidationError,
  sleLogicalFilename,
  slePhysicalFilename,
} from "../src/domain/dta/filenames.ts";
import {
  createDtaInspectionManifest,
  refuseUnimplementedDtaTransport,
  verifyDtaInspectionManifest,
  type StagedDtaArtifact,
} from "../server/dta/export-manifest.ts";
import {
  inspectSleCertificate,
  verifyLocalCertificateChain,
} from "../server/dta/certificates.ts";
import { createLocalSeconEnvelope } from "../server/dta/secon-crypto.ts";
import { DtaCryptoError, fdPath, runOpenSsl } from "../server/dta/openssl.ts";

const hasCode = (code: string) => (error: unknown) =>
  (error instanceof DtaValidationError || error instanceof DtaCryptoError) &&
  error.code === code;
const pair = (): StagedDtaArtifact[] => [
  {
    role: "encrypted-payload",
    filename: "TSOL0007",
    bytes: Buffer.from("synthetic placeholder, not a DTA payload"),
  },
  {
    role: "order-file",
    filename: "TSOL0007.AUF",
    bytes: Buffer.from("synthetic placeholder, not an official order file"),
  },
];
const manifestInput = () => ({
  senderIk: "900123456",
  senderKind: "self-billing" as const,
  billingMonth: 10,
  transferNumber: 7,
  artifacts: pair(),
});

test("SLE logical and physical filenames follow exact published positions, without authorizing transport", () => {
  assert.equal(
    sleLogicalFilename({
      senderIk: "900123456",
      senderKind: "self-billing",
      billingMonth: 2,
    }),
    "SL012345S02",
  );
  assert.equal(
    sleLogicalFilename({
      senderIk: "900123456",
      senderKind: "billing-center",
      billingMonth: 12,
    }),
    "SL012345A12",
  );
  assert.equal(
    slePhysicalFilename({ mode: "test", transferNumber: 0 }),
    "TSOL0000",
  );
  assert.equal(
    slePhysicalFilename({ mode: "production", transferNumber: 999 }),
    "ESOL0999",
  );
  assert.throws(
    () =>
      sleLogicalFilename({
        senderIk: "900123456/../../",
        senderKind: "self-billing",
        billingMonth: 10,
      }),
    hasCode("IK_SYNTAX"),
  );
  assert.throws(
    () =>
      sleLogicalFilename({
        senderIk: "900123456",
        senderKind: "self-billing",
        billingMonth: 0,
      }),
    hasCode("BILLING_MONTH"),
  );
  assert.throws(
    () => slePhysicalFilename({ mode: "test", transferNumber: 1000 }),
    hasCode("TRANSFER_NUMBER"),
  );
});

test("local manifest hashes the separate byte pair and rejects swapped, missing, renamed and changed data", () => {
  const input = manifestInput();
  const manifest = createDtaInspectionManifest(input);
  assert.equal(manifest.productionReady, false);
  assert.equal(manifest.transportReceipt, false);
  verifyDtaInspectionManifest(manifest, [...input.artifacts].reverse());
  const changed = pair();
  changed[0].bytes[0] ^= 1;
  assert.throws(
    () => verifyDtaInspectionManifest(manifest, changed),
    hasCode("ARTIFACT_CHANGED"),
  );
  assert.throws(
    () => verifyDtaInspectionManifest(manifest, [input.artifacts[0]]),
    hasCode("ARTIFACT_PAIR"),
  );
  const renamed = pair();
  renamed[0].filename = "ESOL0007";
  assert.throws(
    () => verifyDtaInspectionManifest(manifest, renamed),
    hasCode("ARTIFACT_NAME"),
  );
  assert.throws(
    () =>
      createDtaInspectionManifest({
        ...input,
        artifacts: [input.artifacts[0], input.artifacts[0]],
      }),
    hasCode("ARTIFACT_ROLE"),
  );
  const corrupted = {
    ...manifest,
    artifacts: [manifest.artifacts[0], manifest.artifacts[0]],
  };
  assert.throws(
    () => verifyDtaInspectionManifest(corrupted, input.artifacts),
    hasCode("MANIFEST_SCHEMA"),
  );
  assert.throws(
    () => refuseUnimplementedDtaTransport(),
    hasCode("DTA_TRANSPORT_UNAVAILABLE"),
  );
});

const syntheticPassphrase = "SYNTHETIC TEST KEY ONLY";
function keyPair(bits = 4096) {
  return generateKeyPairSync("rsa", {
    modulusLength: bits,
    publicExponent: 65537,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
      cipher: "aes-256-cbc",
      passphrase: syntheticPassphrase,
    },
  });
}
const pss = [
  "-sigopt",
  "rsa_padding_mode:pss",
  "-sigopt",
  "rsa_pss_saltlen:32",
  "-sigopt",
  "rsa_mgf1_md:sha256",
];

async function fixtures() {
  const caKey = keyPair();
  const caPem = (
    await runOpenSsl(
      [
        "req",
        "-new",
        "-x509",
        "-key",
        fdPath(3),
        "-passin",
        "fd:4",
        "-days",
        "2",
        "-sha256",
        ...pss,
        "-subj",
        "/C=DE/O=TaxiDTA Synthetic Trust/OU=Synthetic CA/CN=Synthetic Test CA",
        "-addext",
        "basicConstraints=critical,CA:TRUE",
        "-addext",
        "keyUsage=critical,keyCertSign,cRLSign",
      ],
      new Uint8Array(),
      [Buffer.from(caKey.privateKey), Buffer.from(`${syntheticPassphrase}\n`)],
    )
  ).toString();
  let serial = 10;
  const issue = async (ik: string, keys = keyPair(), subject?: string) => {
    const csr = await runOpenSsl(
      [
        "req",
        "-new",
        "-key",
        fdPath(3),
        "-passin",
        "fd:4",
        "-sha256",
        "-subj",
        subject ??
          `/C=DE/O=TaxiDTA Synthetic Trust/OU=Synthetic Fixtures/OU=IK${ik}/CN=Synthetic Contact`,
      ],
      new Uint8Array(),
      [Buffer.from(keys.privateKey), Buffer.from(`${syntheticPassphrase}\n`)],
    );
    const extensions = Buffer.from(
      "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n",
    );
    const certificatePem = (
      await runOpenSsl(
        [
          "x509",
          "-req",
          "-CA",
          fdPath(3),
          "-CAkey",
          fdPath(4),
          "-passin",
          "fd:6",
          "-set_serial",
          String(serial++),
          "-days",
          "1",
          "-sha256",
          ...pss,
          "-extfile",
          fdPath(5),
        ],
        csr,
        [
          Buffer.from(caPem),
          Buffer.from(caKey.privateKey),
          extensions,
          Buffer.from(`${syntheticPassphrase}\n`),
        ],
      )
    ).toString();
    return {
      certificatePem,
      privateKeyPem: keys.privateKey,
      expectedIk: ik,
      passphrase: syntheticPassphrase,
    };
  };
  const sender = await issue("900000001");
  const recipient = await issue("900000002");
  return { caPem, caKey, sender, recipient, issue };
}
let fixturePromise: ReturnType<typeof fixtures> | undefined;
const fixture = () => (fixturePromise ??= fixtures());

async function syntheticCrl(
  f: Awaited<ReturnType<typeof fixtures>>,
  options: { revoked?: boolean; expired?: boolean } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "taxidta-synthetic-crl-"));
  const stamp = (date: Date) =>
    date.toISOString().replace(/[-:T]/g, "").slice(0, 14) + "Z";
  try {
    const cert = new X509Certificate(f.recipient.certificatePem);
    const expiry = stamp(new Date(cert.validTo)).slice(2);
    const revocation = stamp(new Date(Date.now() - 60_000)).slice(2);
    await writeFile(
      join(directory, "index"),
      options.revoked
        ? `R\t${expiry}\t${revocation}\t${cert.serialNumber}\tunknown\t/C=DE/O=Synthetic Fixture\n`
        : "",
      { mode: 0o600 },
    );
    await writeFile(join(directory, "crlnumber"), "01\n", { mode: 0o600 });
    const config = `[ca]\ndefault_ca=fixture\n[fixture]\ndatabase=${join(directory, "index")}\ncrlnumber=${join(directory, "crlnumber")}\ndefault_md=sha256\ndefault_crl_days=1\n`;
    return (
      await runOpenSsl(
        [
          "ca",
          "-gencrl",
          "-batch",
          "-config",
          fdPath(3),
          "-cert",
          fdPath(4),
          "-keyfile",
          fdPath(5),
          "-passin",
          "fd:6",
          "-md",
          "sha256",
          ...pss,
          "-crl_lastupdate",
          stamp(
            new Date(Date.now() - (options.expired ? 172_800_000 : 60_000)),
          ),
          "-crl_nextupdate",
          stamp(
            new Date(Date.now() + (options.expired ? -86_400_000 : 86_400_000)),
          ),
        ],
        new Uint8Array(),
        [
          Buffer.from(config),
          Buffer.from(f.caPem),
          Buffer.from(f.caKey.privateKey),
          Buffer.from(`${syntheticPassphrase}\n`),
        ],
      )
    ).toString();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("offline certificate inspection binds exact structured IK OU, dates, RSA profile and encrypted private key", async () => {
  const f = await fixture();
  const result = inspectSleCertificate(f.sender);
  assert.equal(result.privateKeyMatches, true);
  assert.equal(result.rsaBits, 4096);
  assert.match(result.certificateSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.productionReady, false);
  assert.throws(
    () =>
      inspectSleCertificate({
        ...f.sender,
        expectedIk: f.recipient.expectedIk,
      }),
    hasCode("CERTIFICATE_IK_MISMATCH"),
  );
  assert.throws(
    () =>
      inspectSleCertificate({
        ...f.sender,
        privateKeyPem: f.recipient.privateKeyPem,
      }),
    hasCode("PRIVATE_KEY_MISMATCH"),
  );
  assert.throws(
    () =>
      inspectSleCertificate({
        ...f.sender,
        passphrase: "wrong synthetic password",
      }),
    hasCode("PRIVATE_KEY_INVALID"),
  );
  const cert = new X509Certificate(f.sender.certificatePem);
  assert.throws(
    () =>
      inspectSleCertificate({
        ...f.sender,
        at: new Date(new Date(cert.validTo).getTime() + 1000),
      }),
    hasCode("CERTIFICATE_EXPIRED"),
  );
  assert.throws(
    () =>
      inspectSleCertificate({
        ...f.sender,
        at: new Date(new Date(cert.validFrom).getTime() - 1000),
      }),
    hasCode("CERTIFICATE_NOT_YET_VALID"),
  );
  assert.throws(
    () => inspectSleCertificate({ ...f.sender, certificatePem: f.caPem }),
    hasCode("CERTIFICATE_IS_CA"),
  );
  assert.throws(
    () =>
      inspectSleCertificate({
        ...f.sender,
        certificatePem: f.sender.certificatePem + f.recipient.certificatePem,
      }),
    hasCode("CERTIFICATE_ENCODING"),
  );
});

test("certificate IK text in CN cannot replace an IK OU; duplicate IK roles and RSA2048 are refused", async () => {
  const f = await fixture();
  const existingKeys = { privateKey: f.sender.privateKeyPem, publicKey: "" };
  const misleading = await f.issue(
    "900000001",
    existingKeys,
    "/C=DE/O=TaxiDTA Synthetic Trust/OU=Synthetic Fixtures/CN=IK900000001",
  );
  assert.throws(
    () => inspectSleCertificate(misleading),
    hasCode("CERTIFICATE_IK_MISMATCH"),
  );
  const duplicate = await f.issue(
    "900000001",
    existingKeys,
    "/C=DE/O=TaxiDTA Synthetic Trust/OU=IK900000001/OU=IK900000002/CN=Synthetic Contact",
  );
  assert.throws(
    () => inspectSleCertificate(duplicate),
    hasCode("CERTIFICATE_IK_MISMATCH"),
  );
  const weak = await f.issue("900000003", keyPair(2048));
  assert.throws(
    () => inspectSleCertificate(weak),
    hasCode("CERTIFICATE_KEY_PROFILE"),
  );
});

test("explicit local chain succeeds without claiming revocation; missing/wrong anchor and invalid CRL fail closed", async () => {
  const f = await fixture();
  const result = await verifyLocalCertificateChain({
    certificatePem: f.sender.certificatePem,
    anchorPems: [f.caPem],
  });
  assert.deepEqual(result, {
    chainVerified: true,
    revocationChecked: false,
    trustScope: "caller-supplied-anchors",
    productionReady: false,
  });
  await assert.rejects(
    () =>
      verifyLocalCertificateChain({
        certificatePem: f.sender.certificatePem,
        anchorPems: [],
      }),
    hasCode("TRUST_ANCHORS_MISSING"),
  );
  await assert.rejects(
    () =>
      verifyLocalCertificateChain({
        certificatePem: f.sender.certificatePem,
        anchorPems: [f.recipient.certificatePem],
      }),
    hasCode("OPENSSL_REJECTED"),
  );
  await assert.rejects(
    () =>
      verifyLocalCertificateChain({
        certificatePem: f.sender.certificatePem,
        anchorPems: [f.caPem],
        crlPems: ["not a CRL"],
      }),
    hasCode("CRL_ENCODING"),
  );
});

test("real offline CRL verification accepts current clean list and rejects a revoked recipient or expired list", async () => {
  const f = await fixture();
  const clean = await syntheticCrl(f);
  const options = {
    certificatePem: f.recipient.certificatePem,
    anchorPems: [f.caPem],
  };
  const result = await verifyLocalCertificateChain({
    ...options,
    crlPems: [clean],
  });
  assert.equal(result.revocationChecked, true);
  assert.equal(result.productionReady, false);
  const revoked = await syntheticCrl(f, { revoked: true });
  await assert.rejects(
    () => verifyLocalCertificateChain({ ...options, crlPems: [revoked] }),
    hasCode("OPENSSL_REJECTED"),
  );
  const stale = await syntheticCrl(f, { expired: true });
  await assert.rejects(
    () => verifyLocalCertificateChain({ ...options, crlPems: [stale] }),
    hasCode("OPENSSL_REJECTED"),
  );
  await assert.rejects(
    () =>
      createLocalSeconEnvelope({
        payload: Buffer.from("SYNTHETIC ONLY"),
        sender: f.sender,
        recipient: f.recipient,
        anchorPems: [f.caPem],
        crlPems: [revoked],
      }),
    hasCode("OPENSSL_REJECTED"),
  );
});

test("real CMS DER roundtrip uses PSS/SHA256/salt32 then OAEP/SHA256 and AES256CBC; wrong decryptor and tampering fail", async () => {
  const f = await fixture();
  const payload = Buffer.concat([
    Buffer.from("SYNTHETIC BINARY PAYLOAD ONLY\n"),
    Buffer.from([0, 13, 10, 255, 128]),
  ]);
  const request = {
    payload,
    sender: f.sender,
    recipient: f.recipient,
    anchorPems: [f.caPem],
  };
  const envelope = await createLocalSeconEnvelope(request);
  const second = await createLocalSeconEnvelope(request);
  assert.equal(envelope.productionReady, false);
  assert.equal(envelope.revocationChecked, false);
  assert.ok(envelope.blockers.includes("REVOCATION_UNCHECKED"));
  assert.notDeepEqual(
    envelope.encryptedDer,
    second.encryptedDer,
    "fresh random message key/IV/signature salt",
  );
  assert.equal(
    envelope.payloadSha256,
    createHash("sha256").update(payload).digest("hex"),
  );
  const encryptedDescription = (
    await runOpenSsl(
      ["cms", "-cmsout", "-print", "-inform", "DER"],
      envelope.encryptedDer,
    )
  ).toString();
  assert.match(encryptedDescription, /pkcs7-envelopedData/);
  assert.match(encryptedDescription, /rsaesOaep/);
  assert.match(encryptedDescription, /aes-256-cbc/);
  assert.match(encryptedDescription, /sha256/);
  assert.doesNotMatch(encryptedDescription, /sha1/);
  const decrypt = (bytes: Uint8Array, holder = f.recipient) =>
    runOpenSsl(
      [
        "cms",
        "-decrypt",
        "-binary",
        "-inform",
        "DER",
        "-recip",
        fdPath(3),
        "-inkey",
        fdPath(4),
        "-passin",
        "fd:5",
      ],
      bytes,
      [
        Buffer.from(holder.certificatePem),
        Buffer.from(holder.privateKeyPem),
        Buffer.from(`${syntheticPassphrase}\n`),
      ],
    );
  await assert.rejects(
    () => decrypt(envelope.encryptedDer, f.sender),
    hasCode("OPENSSL_REJECTED"),
  );
  const signed = await decrypt(envelope.encryptedDer);
  const signedDescription = (
    await runOpenSsl(["cms", "-cmsout", "-print", "-inform", "DER"], signed)
  ).toString();
  assert.match(signedDescription, /rsassaPss/);
  assert.match(
    signedDescription,
    /INTEGER\s+:20/,
    "PSS salt length hexadecimal20=decimal32",
  );
  assert.doesNotMatch(signedDescription, /S\/MIME Capabilities/);
  const verify = (bytes: Uint8Array) =>
    runOpenSsl(
      [
        "cms",
        "-verify",
        "-binary",
        "-inform",
        "DER",
        "-no-CApath",
        "-no-CAstore",
        "-CAfile",
        fdPath(3),
      ],
      bytes,
      [Buffer.from(f.caPem)],
    );
  assert.deepEqual(await verify(signed), payload);
  const corrupt = Buffer.from(signed);
  const position = corrupt.indexOf(payload);
  assert.ok(position >= 0, "payload encapsulated in SignedData");
  corrupt[position] ^= 1;
  await assert.rejects(() => verify(corrupt), hasCode("OPENSSL_REJECTED"));
  assert.deepEqual(payload, request.payload, "caller buffer was not zeroed");
});

test("crypto subset refuses empty payload and unreviewed future profile, never sends or returns a receipt", async () => {
  const f = await fixture();
  await assert.rejects(
    () =>
      createLocalSeconEnvelope({
        payload: new Uint8Array(),
        sender: f.sender,
        recipient: f.recipient,
        anchorPems: [f.caPem],
      }),
    hasCode("PAYLOAD_SIZE"),
  );
  await assert.rejects(
    () =>
      createLocalSeconEnvelope({
        payload: Buffer.from("synthetic"),
        sender: f.sender,
        recipient: f.recipient,
        anchorPems: [f.caPem],
        at: new Date("2027-01-01T12:00:00Z"),
      }),
    hasCode("CRYPTO_PROFILE_DATE"),
  );
});

test("envelope snapshots caller-owned payload, certificates, trust arrays and Date before awaited verification", async () => {
  const f = await fixture();
  const originalPayload = Buffer.from("SYNTHETIC INPUT SNAPSHOT REGRESSION");
  const request = {
    payload: Buffer.from(originalPayload),
    sender: { ...f.sender },
    recipient: { ...f.recipient },
    anchorPems: [f.caPem],
    intermediatePems: [] as string[],
    crlPems: [] as string[],
    at: new Date(),
  };
  const pending = createLocalSeconEnvelope(request);
  request.payload.fill(88);
  request.sender.certificatePem = f.recipient.certificatePem;
  request.sender.privateKeyPem = f.recipient.privateKeyPem;
  request.recipient.certificatePem = f.sender.certificatePem;
  request.recipient.expectedIk = f.sender.expectedIk;
  request.anchorPems.length = 0;
  request.intermediatePems.push("not a certificate");
  request.crlPems.push("not a CRL");
  request.at.setUTCFullYear(2030);
  const envelope = await pending;
  assert.equal(
    envelope.payloadSha256,
    createHash("sha256").update(originalPayload).digest("hex"),
  );
  assert.equal(
    envelope.senderCertificateSha256,
    inspectSleCertificate(f.sender).certificateSha256,
  );
  assert.equal(
    envelope.recipientCertificateSha256,
    inspectSleCertificate(f.recipient).certificateSha256,
  );
  const signed = await runOpenSsl(
    [
      "cms",
      "-decrypt",
      "-binary",
      "-inform",
      "DER",
      "-recip",
      fdPath(3),
      "-inkey",
      fdPath(4),
      "-passin",
      "fd:5",
    ],
    envelope.encryptedDer,
    [
      Buffer.from(f.recipient.certificatePem),
      Buffer.from(f.recipient.privateKeyPem),
      Buffer.from(`${syntheticPassphrase}\n`),
    ],
  );
  const verified = await runOpenSsl(
    [
      "cms",
      "-verify",
      "-binary",
      "-inform",
      "DER",
      "-no-CApath",
      "-no-CAstore",
      "-CAfile",
      fdPath(3),
    ],
    signed,
    [Buffer.from(f.caPem)],
  );
  assert.deepEqual(verified, originalPayload);
});

test("OpenSSL temporary-file validation and write use immutable snapshots of caller buffers", async () => {
  const f = await fixture();
  const mutableKey = Buffer.from(f.sender.privateKeyPem);
  const password = Buffer.from(`${syntheticPassphrase}\n`);
  const pending = runOpenSsl(
    ["pkey", "-in", fdPath(3), "-passin", "fd:4", "-pubout"],
    new Uint8Array(),
    [mutableKey, password],
  );
  mutableKey.fill(0);
  password.fill(0);
  const publicKey = await pending;
  assert.match(publicKey.toString(), /^-----BEGIN PUBLIC KEY-----/);
});
