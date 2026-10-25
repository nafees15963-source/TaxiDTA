import snapshot from "../../data/payers-2026-10-22.json" with { type: "json" };
import privateSnapshot from "../../data/payers-private-2026-10-23.json" with { type: "json" };
import routingSnapshot from "../../data/payers-routing-2026-09-15.json" with { type: "json" };

export interface PayerDtaRoute {
  status:
    | "published-unverified"
    | "missing"
    | "private-contract-required"
    | "synthetic-only";
  procedure: "TP5-302" | null;
  performanceCodes: string[];
  providerName: string | null;
  providerIk: string | null;
  deliveryChannel: "email" | null;
  transportAddress: string | null;
  physicalRecipientIk: string | null;
  logicalRecipientIk: string | null;
  decryptRecipientIk: string | null;
  payerIk: string | null;
  paperDestinations: {
    address: string;
    condition: string;
    shipment: "all" | "letter" | "parcel";
  }[];
  sourceUrl: string | null;
  sourceDate: string | null;
  sourcePages: number[];
  observedAt: string | null;
  currentKeVerified: false;
  notes: string[];
}
const emptyRoute = (status: PayerDtaRoute["status"]): PayerDtaRoute => ({
  status,
  procedure: status === "missing" ? "TP5-302" : null,
  performanceCodes: [],
  providerName: null,
  providerIk: null,
  deliveryChannel: null,
  transportAddress: null,
  physicalRecipientIk: null,
  logicalRecipientIk: null,
  decryptRecipientIk: null,
  payerIk: null,
  paperDestinations: [],
  sourceUrl: null,
  sourceDate: null,
  sourcePages: [],
  observedAt: null,
  currentKeVerified: false,
  notes: [],
});

export type PayerIkStatus =
  "source-verified" | "reference-only" | "missing" | "synthetic";
export interface PayerRecord {
  id: string;
  insurerType: "statutory" | "private" | "special" | "synthetic";
  listingStatus: "current" | "directory-only" | "historical" | "synthetic";
  membership: "regular" | "extraordinary" | "associated" | null;
  successorId: string | null;
  dtaWorkflow:
    "gkv-302-unverified" | "private-contract-required" | "synthetic-only";
  dta: PayerDtaRoute;
  name: string;
  aliases: string[];
  /** Institution/search reference only: never an inferred DTA recipient. */
  ik: string | null;
  cardIk: string | null;
  referenceIk: string | null;
  ikRole: "institution" | "billing-reference-other-procedure" | "synthetic";
  ikStatus: PayerIkStatus;
  address: string | null;
  addressKind: "headquarters" | "contact" | "billing" | "missing" | "synthetic";
  addressStatus: "source-verified" | "missing" | "synthetic";
  sourceUrl: string;
  sourceDate: string;
  observedAt?: string;
  addressSourceDate?: string;
  ikSourceUrl: string | null;
  ikSourceDate: string | null;
  addressSourceUrl: string | null;
  /** Only a fully synthetic example is currently ready for the demo invoice path. */
  invoiceReady: boolean;
  routingVerified: false;
  isSynthetic: boolean;
}
export interface PayerSearchResult {
  query: string;
  results: PayerRecord[];
  total: number;
  limit: number;
  officialCount: number;
  statutoryCount: number;
  privateCount: number;
  associatedCount: number;
  sourceDate: string;
  routingVerified: false;
}

const routes = routingSnapshot.routes as Record<string, PayerDtaRoute>;
const statutory: PayerRecord[] = snapshot.payers.map((payer) => ({
  ...payer,
  insurerType: "statutory",
  listingStatus: "current",
  membership: null,
  successorId: null,
  dtaWorkflow: "gkv-302-unverified",
  dta: routes[payer.id] ?? emptyRoute("missing"),
})) as PayerRecord[];
const privatePayers: PayerRecord[] = privateSnapshot.payers.map((payer) => ({
  ...payer,
  dtaWorkflow: "private-contract-required",
  dta: emptyRoute("private-contract-required"),
})) as PayerRecord[];
const official = [...statutory, ...privatePayers];
const privateCount = privatePayers.filter(
  (p) => p.insurerType === "private" && p.listingStatus === "current",
).length;
const associatedCount = privatePayers.filter(
  (p) => p.membership === "associated",
).length;
const synthetic: PayerRecord = {
  id: "demo-kasse",
  insurerType: "synthetic",
  listingStatus: "synthetic",
  membership: null,
  successorId: null,
  dtaWorkflow: "synthetic-only",
  dta: emptyRoute("synthetic-only"),
  name: "Demokasse · nur Testdaten",
  aliases: ["Fiktive Testkasse", "Demonstration", "Demo Kasse"],
  ik: "999999999",
  cardIk: null,
  referenceIk: null,
  ikRole: "synthetic",
  ikStatus: "synthetic",
  address: "Fantasiestraße 1\n12345 Beispielstadt",
  addressKind: "synthetic",
  addressStatus: "synthetic",
  sourceUrl: "urn:taxidta:synthetic-payer",
  sourceDate: "2026-10-22",
  ikSourceUrl: null,
  ikSourceDate: null,
  addressSourceUrl: null,
  invoiceReady: true,
  routingVerified: false,
  isSynthetic: true,
};
if (
  statutory.length !== snapshot.expectedOfficialCount ||
  privatePayers.length !== privateSnapshot.expectedOfficialCount ||
  privatePayers.filter((p) => p.membership === "regular").length !==
    privateSnapshot.expectedRegularMembers ||
  privatePayers.filter((p) => p.membership === "extraordinary").length !==
    privateSnapshot.expectedExtraordinaryMembers ||
  associatedCount !== privateSnapshot.expectedAssociatedMembers ||
  new Set(official.map((p) => p.id)).size !== official.length
) {
  throw new Error(
    "Das Kassenregister hat nicht die erwartete eindeutige Namensliste.",
  );
}
for (const payer of official) {
  if (
    payer.isSynthetic ||
    payer.routingVerified !== false ||
    payer.invoiceReady !== false ||
    (payer.ik !== null && !/^\d{9}$/.test(payer.ik)) ||
    (payer.ik === null && payer.ikStatus !== "missing") ||
    payer.dta.currentKeVerified !== false
  ) {
    throw new Error("Unzulässiger Freigabestatus oder IK im Kassenregister.");
  }
}
const copy = (payer: PayerRecord): PayerRecord => ({
  ...payer,
  aliases: [...payer.aliases],
  dta: {
    ...payer.dta,
    performanceCodes: [...payer.dta.performanceCodes],
    paperDestinations: payer.dta.paperDestinations.map((destination) => ({
      ...destination,
    })),
    sourcePages: [...payer.dta.sourcePages],
    notes: [...payer.dta.notes],
  },
});
export const normalizePayerSearch = (value: string) =>
  value
    .toLocaleLowerCase("de-DE")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ae/g, "a")
    .replace(/oe/g, "o")
    .replace(/ue/g, "u")
    .replace(/[^a-z0-9]/g, "");
const index = [synthetic, ...official].map((payer) => ({
  payer,
  name: normalizePayerSearch(payer.name),
  aliases: payer.aliases.map(normalizePayerSearch),
}));

export function getPayer(id: string): PayerRecord | null {
  if (typeof id !== "string" || id.length > 120) return null;
  const found = index.find((item) => item.payer.id === id);
  return found ? copy(found.payer) : null;
}
export function searchPayers(query = "", limit = 20): PayerSearchResult {
  const input = typeof query === "string" ? query.trim().slice(0, 120) : "";
  const boundedLimit = Number.isSafeInteger(limit)
    ? Math.max(1, Math.min(100, limit))
    : 20;
  const compact = normalizePayerSearch(input);
  const terms = input.split(/\s+/).map(normalizePayerSearch).filter(Boolean);
  const matches = index.filter(({ payer, name, aliases }) => {
    if (!compact) return true;
    if (
      payer.ik === compact ||
      payer.referenceIk === compact ||
      payer.cardIk === compact
    )
      return true;
    const values = [
      name,
      ...aliases,
      payer.ik ?? "",
      payer.referenceIk ?? "",
      payer.cardIk ?? "",
    ];
    return (
      terms.every((term) => values.some((value) => value.includes(term))) ||
      values.some((value) => value.includes(compact))
    );
  });
  const rank = (item: (typeof index)[number]) => {
    if (!compact) return item.payer.isSynthetic ? -1 : 3;
    if (
      [item.payer.ik, item.payer.referenceIk, item.payer.cardIk].includes(
        compact,
      )
    )
      return 0;
    if (item.name === compact || item.aliases.includes(compact)) return 1;
    return item.name.startsWith(compact) ||
      item.aliases.some((alias) => alias.startsWith(compact))
      ? 2
      : 3;
  };
  matches.sort(
    (a, b) =>
      rank(a) - rank(b) || a.payer.name.localeCompare(b.payer.name, "de-DE"),
  );
  return {
    query: input,
    results: matches.slice(0, boundedLimit).map((item) => copy(item.payer)),
    total: matches.length,
    limit: boundedLimit,
    officialCount: official.length,
    statutoryCount: statutory.length,
    privateCount,
    associatedCount,
    sourceDate: privateSnapshot.nameSourceDate,
    routingVerified: false,
  };
}
export function payerRegistrySummary() {
  return {
    officialCount: official.length,
    statutoryCount: statutory.length,
    privateCount,
    associatedCount,
    privateRegularCount: privateSnapshot.expectedRegularMembers,
    privateExtraordinaryCount: privateSnapshot.expectedExtraordinaryMembers,
    directoryOnlyCount: privatePayers.filter(
      (p) => p.listingStatus === "directory-only",
    ).length,
    historicalCount: privatePayers.filter(
      (p) => p.listingStatus === "historical",
    ).length,
    nameListComplete: false as const,
    statutoryNameListComplete: true as const,
    pkvMembershipListComplete: true as const,
    sourceDate: privateSnapshot.nameSourceDate,
    statutorySourceDate: snapshot.nameSourceDate,
    sourceUrl: snapshot.nameSource,
    privateSourceUrl: privateSnapshot.nameSource,
    directInstitutionIks: official.filter(
      (p) => p.ikStatus === "source-verified",
    ).length,
    referenceOnlyIks: official.filter((p) => p.ikStatus === "reference-only")
      .length,
    missingIks: official.filter((p) => p.ikStatus === "missing").length,
    contactAddresses: official.filter(
      (p) => p.addressKind === "headquarters" || p.addressKind === "contact",
    ).length,
    publishedTransportHints: official.filter(
      (p) => p.dta.transportAddress !== null,
    ).length,
    publishedPaperHints: official.filter(
      (p) => p.dta.paperDestinations.length > 0,
    ).length,
    invoiceReadyOfficialCount: official.filter((p) => p.invoiceReady).length,
    routingVerified: false as const,
    currentKeVerified: false as const,
    notice:
      "92 GKV-Kassen und alle veröffentlichten PKV-Verbandsmitglieder erfasst. Kein vollständiges Verzeichnis aller privaten Anbieter. Veröffentlichte TP5-Hinweise erfordern den Abgleich mit der gültigen Kostenträgerdatei; PKV-Direktabrechnung benötigt eine gesonderte Vereinbarung.",
  };
}
