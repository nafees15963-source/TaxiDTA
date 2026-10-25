import {createHash} from 'node:crypto';
import {DtaValidationError, sleLogicalFilename, slePhysicalFilename} from '../../src/domain/dta/filenames.ts';

export interface StagedDtaArtifact {
  role: 'encrypted-payload' | 'order-file';
  filename: string;
  bytes: Uint8Array;
}

/** Local integrity metadata only. This schema is NOT an official GKV transport format. */
export interface DtaExportManifest {
  kind: 'taxidta-local-inspection-manifest';
  version: 1;
  productionReady: false;
  transportReceipt: false;
  mode: 'test';
  createdAt: string;
  logicalFilename: string;
  physicalFilename: string;
  artifacts: {role: StagedDtaArtifact['role']; filename: string; size: number; sha256: string}[];
  blockers: string[];
}

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function validateArtifacts(artifacts: readonly StagedDtaArtifact[], physicalFilename: string): void {
  if (artifacts.length !== 2) throw new DtaValidationError('ARTIFACT_PAIR', 'Nutzdatei und Auftragsdatei müssen getrennt vorliegen.');
  const roles = new Set<string>();
  const names = new Set<string>();
  for (const artifact of artifacts) {
    if (!['encrypted-payload', 'order-file'].includes(artifact.role) || roles.has(artifact.role)) {
      throw new DtaValidationError('ARTIFACT_ROLE', 'Dateirollen fehlen oder sind doppelt.');
    }
    roles.add(artifact.role);
    const expectedName = artifact.role === 'encrypted-payload' ? physicalFilename : `${physicalFilename}.AUF`;
    if (artifact.filename !== expectedName || names.has(artifact.filename)) {
      throw new DtaValidationError('ARTIFACT_NAME', 'Dateinamen passen nicht zum geprüften Transfer.');
    }
    names.add(artifact.filename);
    if (!(artifact.bytes instanceof Uint8Array) || artifact.bytes.byteLength === 0 || artifact.bytes.byteLength > 16 * 1024 * 1024) {
      throw new DtaValidationError('ARTIFACT_SIZE', 'Dateien müssen vorhanden sein und innerhalb der lokalen Prüfgrenze liegen.');
    }
  }
}

export function createDtaInspectionManifest(input: {
  senderIk: string;
  senderKind: 'self-billing' | 'billing-center';
  billingMonth: number;
  transferNumber: number;
  artifacts: readonly StagedDtaArtifact[];
  createdAt?: Date;
}): DtaExportManifest {
  const physicalFilename = slePhysicalFilename({mode: 'test', transferNumber: input.transferNumber});
  const logicalFilename = sleLogicalFilename(input);
  validateArtifacts(input.artifacts, physicalFilename);
  const createdAt = input.createdAt ?? new Date();
  if (!Number.isFinite(createdAt.getTime())) throw new DtaValidationError('CREATION_TIME', 'Ungültiger Erstellungszeitpunkt.');
  return {
    kind: 'taxidta-local-inspection-manifest', version: 1, productionReady: false, transportReceipt: false,
    mode: 'test', createdAt: createdAt.toISOString(), physicalFilename, logicalFilename,
    artifacts: input.artifacts.map(artifact => ({role: artifact.role, filename: artifact.filename, size: artifact.bytes.byteLength, sha256: digest(artifact.bytes)})),
    blockers: ['TA_PAYLOAD_NOT_VALIDATED', 'ORDER_FILE_NOT_VALIDATED', 'OFFICIAL_ROUTING_NOT_VERIFIED', 'TRUST_AND_REVOCATION_NOT_RELEASED', 'TRANSPORT_NOT_IMPLEMENTED', 'RECIPIENT_TEST_OUTSTANDING'],
  };
}

/** Rechecks the exact original byte pair. Hashes do not establish authenticity or compliance. */
export function verifyDtaInspectionManifest(manifest: DtaExportManifest, artifacts: readonly StagedDtaArtifact[]): void {
  if (manifest.kind !== 'taxidta-local-inspection-manifest' || manifest.version !== 1 || manifest.mode !== 'test' ||
      manifest.productionReady !== false || manifest.transportReceipt !== false || !/^TSOL0\d{3}$/.test(manifest.physicalFilename) ||
      !/^SL\d{6}[SA](0[1-9]|1[0-2])$/.test(manifest.logicalFilename) || manifest.artifacts.length !== 2) {
    throw new DtaValidationError('MANIFEST_SCHEMA', 'Das lokale Prüfmanifest ist ungültig.');
  }
  validateArtifacts(artifacts, manifest.physicalFilename);
  const roles = new Set<string>();
  for (const recorded of manifest.artifacts) {
    if (roles.has(recorded.role)) throw new DtaValidationError('MANIFEST_SCHEMA', 'Das Prüfmanifest enthält doppelte Rollen.');
    roles.add(recorded.role);
    const actual = artifacts.find(artifact => artifact.role === recorded.role);
    if (!actual || actual.filename !== recorded.filename || actual.bytes.byteLength !== recorded.size || digest(actual.bytes) !== recorded.sha256) {
      throw new DtaValidationError('ARTIFACT_CHANGED', 'Die Dateien stimmen nicht mehr mit dem Prüfmanifest überein.');
    }
  }
}

/** Deliberately has no network implementation and cannot turn inspection evidence into authorization. */
export function refuseUnimplementedDtaTransport(): never {
  throw new DtaValidationError('DTA_TRANSPORT_UNAVAILABLE', 'Echter §302-Versand ist noch nicht implementiert und für diesen Empfänger nicht abgenommen.');
}
