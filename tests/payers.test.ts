import test from "node:test";
import assert from "node:assert/strict";
import {
  getPayer,
  searchPayers,
  payerRegistrySummary,
} from "../src/domain/payers.ts";
import { PayerRegistryError, resolvePayer } from "../server/payers.ts";
import statutorySnapshot from "../data/payers-2026-10-22.json";
import privateSnapshot from "../data/payers-private-2026-10-23.json";
const official = [...statutorySnapshot.payers, ...privateSnapshot.payers].map(
  (row) => resolvePayer(row.id),
);

test("register separates complete GKV and PKV membership lists from historical or unknown data", () => {
  const summary = payerRegistrySummary();
  assert.equal(summary.officialCount, 146);
  assert.equal(summary.statutoryCount, 92);
  assert.equal(summary.privateCount, 49);
  assert.equal(summary.associatedCount, 2);
  assert.equal(summary.privateRegularCount, 39);
  assert.equal(summary.privateExtraordinaryCount, 10);
  assert.equal(summary.directoryOnlyCount, 2);
  assert.equal(summary.historicalCount, 1);
  assert.equal(summary.nameListComplete, false);
  assert.equal(summary.statutoryNameListComplete, true);
  assert.equal(summary.pkvMembershipListComplete, true);
  assert.equal(summary.missingIks, 16);
  assert.equal(summary.invoiceReadyOfficialCount, 0);
  assert.equal(summary.routingVerified, false);
  assert.equal(summary.currentKeVerified, false);
  assert.equal(new Set(official.map((p) => p.id)).size, 146);
  assert.ok(
    official.every(
      (p) => !p.isSynthetic && !p.invoiceReady && !p.routingVerified,
    ),
  );
  assert.ok(
    official.every((p) =>
      p.ik === null ? p.ikStatus === "missing" : /^\d{9}$/.test(p.ik),
    ),
  );
  const all = searchPayers("", 100);
  assert.equal(all.total, 147);
  assert.equal(all.results.length, 100);
  assert.equal(all.results[0].id, "demo-kasse");
  assert.equal(all.results.filter((p) => p.invoiceReady).length, 1);
});
test("payer search accepts umlauts, historical aliases, token order and spaced IKs", () => {
  assert.equal(searchPayers("BKK Würth").results[0].id, "bkk-wuerth");
  assert.equal(searchPayers("wuerth").results[0].id, "bkk-wuerth");
  assert.equal(searchPayers("BKK VBU").results[0].id, "mkk-meine-krankenkasse");
  assert.equal(searchPayers("TK").results[0].id, "techniker-krankenkasse");
  assert.equal(searchPayers("104 940 005").results[0].id, "barmer");
  assert.equal(
    searchPayers("108018121").results[0].id,
    "aok-baden-wuerttemberg",
  );
  assert.equal(
    searchPayers("108018007").results[0].id,
    "aok-baden-wuerttemberg",
  );
  assert.equal(
    searchPayers("Schleswig Holstein AOK").results[0].id,
    "aok-nordwest",
  );
  assert.equal(
    searchPayers("Vollkommen unbekannte Fantasieversicherung").total,
    0,
  );
});
test("cross-procedure IK references and headquarters never imply billing or transport readiness", () => {
  const bkk = resolvePayer("audi-bkk");
  assert.equal(bkk.ikStatus, "reference-only");
  assert.equal(bkk.ikRole, "billing-reference-other-procedure");
  assert.equal(bkk.address, null);
  assert.equal(bkk.invoiceReady, false);
  assert.equal(bkk.cardIk, null);
  const tk = resolvePayer("techniker-krankenkasse");
  assert.equal(tk.ik, "101575519");
  assert.equal(tk.ikStatus, "source-verified");
  assert.equal(tk.addressKind, "headquarters");
  assert.equal(tk.invoiceReady, false);
  assert.equal(tk.routingVerified, false);
  assert.equal(tk.cardIk, null);
  assert.match(tk.ikSourceUrl!, /^https:\/\/www\.tk\.de\//);
  const bw = resolvePayer("aok-baden-wuerttemberg");
  assert.notEqual(bw.ik, bw.referenceIk);
  assert.equal(bw.referenceIk, "108018121");
  assert.equal(bw.ik, "108018007");
});
test("search is bounded and callers cannot mutate the trusted registry via returned snapshots", () => {
  assert.equal(searchPayers("", 999).results.length, 100);
  assert.equal(searchPayers("", 0).results.length, 1);
  assert.equal(searchPayers("a".repeat(1000)).query.length, 120);
  assert.equal(getPayer("../.env.local"), null);
  assert.throws(() => resolvePayer("not-a-payer"), PayerRegistryError);
  const payer = resolvePayer("techniker-krankenkasse");
  payer.aliases.push("Injected wrong alias");
  payer.ik = "000000000";
  assert.equal(resolvePayer("techniker-krankenkasse").ik, "101575519");
  assert.equal(searchPayers("Injected wrong alias").total, 0);
});

test("private IK lookup is sourced and distinct legal entities are not assigned each other's IK", () => {
  const allianz = searchPayers("168 140 346").results[0];
  assert.equal(allianz.name, "Allianz Private Krankenversicherungs-AG");
  assert.equal(allianz.insurerType, "private");
  assert.equal(allianz.dtaWorkflow, "private-contract-required");
  assert.equal(allianz.dta.transportAddress, null);
  assert.equal(allianz.ikSourceDate, "2022-01-01");
  assert.match(allianz.ikSourceUrl!, /PKV-Verband\/PKV-IK-Liste/);
  assert.equal(searchPayers("DFV").results[0].ik, null);
  const oldenburg = searchPayers("ALTE OLDENBURGER").results;
  assert.equal(oldenburg.length, 2);
  assert.equal(
    oldenburg.find((p) => p.id === "pkv-alte-oldenburger-1927")?.ik,
    null,
  );
  assert.equal(
    oldenburg.find((p) => p.id === "pkv-168141427")?.ik,
    "168141427",
  );
  assert.equal(searchPayers("950585030").results[0].insurerType, "special");
  const famk = searchPayers("FAMK").results[0];
  assert.equal(famk.listingStatus, "historical");
  assert.equal(famk.successorId, "pkv-168141450");
});
test("published TP5 route hints preserve performance-code exceptions and do not enable dispatch", () => {
  const dak = resolvePayer("dak-gesundheit").dta;
  assert.equal(dak.transportAddress, "inbox@tp5.arz-emmendingen.de");
  assert.equal(dak.physicalRecipientIk, "107436557");
  assert.equal(dak.logicalRecipientIk, "107436557");
  assert.equal(dak.payerIk, "105830016");
  assert.notEqual(dak.transportAddress, "dale@arz-emmendingen.de");
  const tk = resolvePayer("techniker-krankenkasse").dta;
  assert.equal(tk.transportAddress, "edi302@inter-forum.de");
  assert.notEqual(tk.transportAddress, "dav001@vdek-dav.de");
  assert.equal(tk.providerIk, "661430035");
  assert.equal(tk.decryptRecipientIk, null);
  const hkk = resolvePayer("hkk").dta;
  assert.equal(hkk.providerIk, "107436557");
  assert.equal(hkk.transportAddress, null);
  assert.equal(resolvePayer("knappschaft").dta.transportAddress, null);
  const barmer = resolvePayer("barmer").dta;
  assert.equal(barmer.paperDestinations.length, 2);
  assert.match(barmer.paperDestinations[0].condition, /Nordrhein-Westfalen/);
  assert.match(barmer.paperDestinations[1].condition, /übrige Bundesländer/);
  assert.equal(
    resolvePayer("kkh").dta.transportAddress,
    "le-ek@bitmarck-daten.de",
  );
  assert.match(
    resolvePayer("aok-hessen").dta.paperDestinations[1].address,
    /Am Börsing 5/,
  );
  for (const payer of official) {
    assert.equal(payer.dta.currentKeVerified, false);
    if (payer.dta.transportAddress) {
      assert.equal(payer.insurerType, "statutory");
      assert.equal(payer.dta.procedure, "TP5-302");
      assert.ok(payer.dta.performanceCodes.includes("40"));
      assert.equal(payer.dta.sourceDate, "2026-09-15");
    }
  }
});
test("nested route hints cannot be modified by the caller", () => {
  const payer = resolvePayer("barmer");
  payer.dta.paperDestinations[0].address = "Injected wrong delivery address";
  payer.dta.notes.push("Injected wrong route");
  payer.dta.performanceCodes.push("BAD");
  assert.doesNotMatch(
    resolvePayer("barmer").dta.paperDestinations[0].address,
    /Injected/,
  );
  assert.ok(!resolvePayer("barmer").dta.notes.includes("Injected wrong route"));
  assert.ok(!resolvePayer("barmer").dta.performanceCodes.includes("BAD"));
});
