import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarPlus,
  Check,
  CheckCheck,
  ChevronDown,
  ClipboardList,
  FileText,
  Plus,
  ReceiptText,
  Search,
  Stethoscope,
  Trash2,
} from "lucide-react";
import PayerPicker from "./PayerPicker";
import type {
  BillingCase,
  BillingCaseInput,
  BillingCaseJourneyInput,
} from "./shared/types";
import {
  assertDate,
  calculateTariff,
  calculateTaxPreview,
  formatMoney,
  splitGross,
} from "./domain/index";
import "./billing-cases.css";

export type BillingCaseRequest = Omit<BillingCaseInput, "payer"> & {
  payerId: string;
};
interface Props {
  cases: BillingCase[];
  businessDate: string;
  requestNew: number;
  busy: boolean;
  error: string;
  onSave: (input: BillingCaseRequest, caseId?: string) => Promise<boolean>;
  onInvoice: (
    caseIds: string[],
    issuedAt: string,
    commandKey: string,
  ) => Promise<boolean>;
  onOpenInvoice: (invoiceId: string) => void;
}
interface Row extends BillingCaseJourneyInput {
  key: string;
}
interface Form {
  payerId: string;
  insured: BillingCaseInput["insured"];
  prescription: BillingCaseInput["prescription"];
  tariff: "I" | "II";
  contractConfirmed: boolean;
  vehicle: "taxi" | "rental";
  journeys: Row[];
}
const dateLabel = (value: string) =>
  value
    ? new Intl.DateTimeFormat("de-DE", { timeZone: "UTC" }).format(
        new Date(value + "T12:00:00Z"),
      )
    : "—";
const errorMessage = (value: unknown) =>
  value instanceof Error ? value.message : "Bitte die Eingaben prüfen.";
const emptyRow = (
  from = "",
  to = "",
  km = "20",
  date = "",
  direction: "outbound" | "return" = "outbound",
): Row => ({ key: crypto.randomUUID(), date, from, to, km, direction });
const emptyForm = (businessDate: string): Form => ({
  payerId: "",
  insured: { name: "", address: "", insuranceNumber: "", dateOfBirth: "" },
  prescription: {
    number: "",
    issuedAt: businessDate,
    validFrom: "",
    validTo: "",
    confirmed: false,
  },
  tariff: "I",
  contractConfirmed: false,
  vehicle: "taxi",
  journeys: [emptyRow()],
});
function parseDateList(value: string) {
  const entries = value.split(/[\s,;]+/).filter(Boolean);
  if (!entries.length)
    throw new Error("Bitte mindestens ein Fahrtdatum eingeben.");
  return entries.map((entry) => {
    const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(entry);
    const normalized = german
      ? `${german[3]}-${german[2].padStart(2, "0")}-${german[1].padStart(2, "0")}`
      : entry;
    try {
      assertDate(normalized);
    } catch {
      throw new Error(
        `Das Fahrtdatum „${entry}“ ist nicht gültig. Bitte z. B. 20.10.2026 eingeben.`,
      );
    }
    if (!normalized.startsWith("2026-"))
      throw new Error(
        "Für die hinterlegten Tarifregeln bitte Fahrtdaten aus 2026 verwenden.",
      );
    return normalized;
  });
}

export default function BillingCasePanel({
  cases,
  businessDate,
  requestNew,
  busy,
  error,
  onSave,
  onInvoice,
  onOpenInvoice,
}: Props) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<Form>(() => emptyForm(businessDate));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("open");
  const [selection, setSelection] = useState<string[]>([]);
  const [issuedAt, setIssuedAt] = useState(businessDate);
  const [localError, setLocalError] = useState("");
  const [bulkDates, setBulkDates] = useState("");
  const [bulkDirection, setBulkDirection] = useState<
    "both" | "outbound" | "return"
  >("both");
  const [template, setTemplate] = useState({ from: "", to: "", km: "20" });
  const [confirmedBundle, setConfirmedBundle] = useState(false);
  const initialRequest = useRef(0);
  const bundleCommand = useRef({ signature: "", key: crypto.randomUUID() });
  const formHeading = useRef<HTMLHeadingElement>(null);

  function startNew() {
    setForm(emptyForm(businessDate));
    setEditing("new");
    setTemplate({ from: "", to: "", km: "20" });
    setLocalError("");
    setBulkDates("");
    setBulkDirection("both");
    setConfirmedBundle(false);
  }
  useEffect(() => {
    if (requestNew > 0 && requestNew !== initialRequest.current) {
      initialRequest.current = requestNew;
      startNew();
    }
  }, [requestNew]);
  useEffect(() => {
    if (editing) formHeading.current?.focus();
  }, [editing]);
  useEffect(() => {
    setSelection((ids) =>
      ids.filter((id) =>
        cases.some((item) => item.id === id && !item.invoiceId),
      ),
    );
  }, [cases]);

  const selectedCases = cases.filter((item) => selection.includes(item.id));
  const bundlePayer = selectedCases[0]?.payer.id;
  const bundleMixed = selectedCases.some(
    (item) => item.payer.id !== bundlePayer,
  );
  const bundleReady =
    selectedCases.length > 0 &&
    !bundleMixed &&
    selectedCases.every((item) => item.status === "ready" && !item.invoiceId);
  const bundleTotal = selectedCases.reduce(
    (total, item) => total + item.grossCents,
    0,
  );
  const normalizedQuery = query.trim().toLocaleLowerCase("de");
  const visible = cases.filter(
    (item) =>
      (filter === "all" ||
        (filter === "open"
          ? !item.invoiceId
          : filter === "ready"
            ? item.status === "ready"
            : !!item.invoiceId)) &&
      [
        item.number,
        item.insured.name,
        item.insured.insuranceNumber,
        item.payer.name,
        item.payer.ik,
        item.prescription.number,
        ...item.journeys.map((row) => row.date),
      ]
        .join(" ")
        .toLocaleLowerCase("de")
        .includes(normalizedQuery),
  );
  const preview = useMemo(
    () =>
      form.journeys.map((row) => {
        try {
          const tariff = calculateTariff({
            article: form.tariff,
            km: row.km,
            date: row.date,
            persons: 1,
            contractConfirmed: form.contractConfirmed,
          });
          const tax = calculateTaxPreview({
            kind: "medical",
            vehicle: form.vehicle,
            date: row.date,
            km: row.km,
            sameMunicipality: null,
          });
          return {
            key: row.key,
            tariff,
            rate: tax.rate,
            pending: tax.pending,
            ...splitGross(tariff.grossCents, tax.rate),
            error: "",
          };
        } catch (e) {
          return {
            key: row.key,
            tariff: null,
            rate: null,
            pending: false,
            netCents: 0,
            taxCents: 0,
            error: errorMessage(e),
          };
        }
      }),
    [form],
  );
  const previewComplete =
    preview.length > 0 && preview.every((row) => !!row.tariff);
  const previewPending = preview.some((row) => row.pending);
  const previewGross = preview.reduce(
    (total, row) => total + (row.tariff?.grossCents ?? 0),
    0,
  );

  function editCase(item: BillingCase) {
    setEditing(item.id);
    setLocalError("");
    setBulkDates("");

    setForm({
      payerId: item.payer.id,
      insured: { ...item.insured },
      prescription: { ...item.prescription },
      tariff: item.tariff,
      contractConfirmed: item.contractConfirmed,
      vehicle: item.vehicle,
      journeys: item.journeys.map((row) => ({
        key: crypto.randomUUID(),
        date: row.date,
        from: row.from,
        to: row.to,
        km: row.km,
        direction: row.direction,
        ...(row.receiptNumber ? { receiptNumber: row.receiptNumber } : {}),
      })),
    });
    const first = item.journeys[0];
    setTemplate({
      from: first?.direction === "return" ? first.to : (first?.from ?? ""),
      to: first?.direction === "return" ? first.from : (first?.to ?? ""),
      km: first?.km ?? "20",
    });
  }
  function updateTemplate(field: "from" | "to" | "km", value: string) {
    const next = { ...template, [field]: value };
    setForm((current) => ({
      ...current,
      journeys: current.journeys.map((row) => {
        if (field === "km")
          return row.km === template.km || !row.km
            ? { ...row, km: value }
            : row;
        const rowField =
          field === "from"
            ? row.direction === "return"
              ? "to"
              : "from"
            : row.direction === "return"
              ? "from"
              : "to";
        return row[rowField] === template[field] || !row[rowField]
          ? { ...row, [rowField]: value }
          : row;
      }),
    }));
    setTemplate(next);
  }
  function updateRow(key: string, patch: Partial<Row>) {
    setForm((current) => ({
      ...current,
      journeys: current.journeys.map((row) =>
        row.key === key ? { ...row, ...patch } : row,
      ),
    }));
  }
  function addDates() {
    setLocalError("");
    try {
      const dates = parseDateList(bulkDates);
      const added = dates.flatMap((date) => [
        ...(bulkDirection !== "return"
          ? [emptyRow(template.from, template.to, template.km, date)]
          : []),
        ...(bulkDirection !== "outbound"
          ? [emptyRow(template.to, template.from, template.km, date, "return")]
          : []),
      ]);
      const existing = form.journeys.filter((row) => !!row.date);
      if (existing.length + added.length > 20)
        throw new Error(
          "Ein Abrechnungsfall kann höchstens 20 Einzelfahrten enthalten, zum Beispiel 10 Hin- und 10 Rückfahrten. Es wurden keine Daten übernommen.",
        );
      const signatures = new Set(
        existing.map(
          (row) =>
            `${row.date}|${row.direction}|${row.from.trim()}|${row.to.trim()}`,
        ),
      );
      for (const row of added) {
        const signature = `${row.date}|${row.direction}|${row.from.trim()}|${row.to.trim()}`;
        if (signatures.has(signature))
          throw new Error(
            `Die ${row.direction === "return" ? "Rückfahrt" : "Hinfahrt"} am ${dateLabel(row.date)} steht bereits in diesem Fall. Es wurden keine Daten übernommen.`,
          );
        signatures.add(signature);
      }
      setForm((current) => ({ ...current, journeys: [...existing, ...added] }));
      setBulkDates("");
    } catch (e) {
      setLocalError(errorMessage(e));
    }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setLocalError("");
    if (!form.payerId) {
      setLocalError("Bitte eine Krankenkasse aus dem Register auswählen.");
      return;
    }
    if (form.journeys.length > 20) {
      setLocalError(
        "Ein Abrechnungsfall darf höchstens 20 Einzelfahrten enthalten.",
      );
      return;
    }
    if (!form.journeys.length) {
      setLocalError("Bitte mindestens ein Fahrtdatum hinzufügen.");
      return;
    }
    const input: BillingCaseRequest = {
      payerId: form.payerId,
      insured: {
        name: form.insured.name.trim(),
        address: form.insured.address.trim(),
        ...(form.insured.insuranceNumber?.trim()
          ? { insuranceNumber: form.insured.insuranceNumber.trim() }
          : {}),
        ...(form.insured.dateOfBirth
          ? { dateOfBirth: form.insured.dateOfBirth }
          : {}),
      },
      prescription: {
        number: form.prescription.number?.trim() ?? "",
        issuedAt: form.prescription.issuedAt,
        confirmed: form.prescription.confirmed,
        ...(form.prescription.validFrom
          ? { validFrom: form.prescription.validFrom }
          : {}),
        ...(form.prescription.validTo
          ? { validTo: form.prescription.validTo }
          : {}),
      },
      tariff: form.tariff,
      contractConfirmed: form.contractConfirmed,
      vehicle: form.vehicle,
      sameMunicipality: null,
      journeys: form.journeys.map(({ key, receiptNumber, ...row }) => ({
        ...row,
        ...(receiptNumber?.trim()
          ? { receiptNumber: receiptNumber.trim() }
          : {}),
      })),
    };
    if (
      await onSave(
        input,
        editing === "new" ? undefined : (editing ?? undefined),
      )
    ) {
      setEditing(null);
      setLocalError("");
    }
  }

  if (editing)
    return (
      <section className="case-workspace" aria-label="Abrechnungsfall erfassen">
        <div className="case-form-heading">
          <button
            className="text-button"
            type="button"
            disabled={busy}
            onClick={() => {
              setEditing(null);
              setLocalError("");
            }}
          >
            <ArrowLeft size={16} /> Zur Fallübersicht
          </button>
          <h2 ref={formHeading} tabIndex={-1}>
            {editing === "new"
              ? "Neue Abrechnung"
              : "Abrechnungsfall bearbeiten"}
          </h2>
          <p>
            Eine Verordnung. Alle zugehörigen Fahrten. Direkt in einem Fall.
          </p>
        </div>
        <form onSubmit={save}>
          {(localError || error) && (
            <div className="notice danger" role="alert">
              {localError || error}
            </div>
          )}
          <fieldset className="case-section card" disabled={busy}>
            <legend>
              <span>1</span>Krankenkasse & versicherte Person
            </legend>
            <PayerPicker
              value={form.payerId}
              onChange={(payer) => {
                setForm((current) => ({
                  ...current,
                  payerId: payer?.id ?? "",
                }));
              }}
              disabled={busy}
            />
            <div className="case-form-grid">
              <label>
                Name der versicherten Person
                <input
                  autoComplete="off"
                  required
                  maxLength={160}
                  value={form.insured.name}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      insured: { ...current.insured, name: e.target.value },
                    }))
                  }
                />
              </label>
              <label>
                Versichertennummer (optional)
                <input
                  autoComplete="off"
                  maxLength={40}
                  value={form.insured.insuranceNumber ?? ""}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      insured: {
                        ...current.insured,
                        insuranceNumber: e.target.value,
                      },
                    }))
                  }
                />
              </label>
              <label className="case-span-two">
                Anschrift der versicherten Person
                <textarea
                  aria-label="Anschrift der versicherten Person"
                  autoComplete="off"
                  required
                  maxLength={600}
                  rows={2}
                  value={form.insured.address}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      insured: { ...current.insured, address: e.target.value },
                    }))
                  }
                />
              </label>
              <label>
                Geburtsdatum (optional)
                <input
                  type="date"
                  value={form.insured.dateOfBirth ?? ""}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      insured: {
                        ...current.insured,
                        dateOfBirth: e.target.value,
                      },
                    }))
                  }
                />
              </label>
            </div>
            <p className="case-help">
              Die Person wird direkt im Fall erfasst. Eine gesonderte
              Kundenanlage ist nicht nötig.
            </p>
          </fieldset>
          <fieldset className="case-section card" disabled={busy}>
            <legend>
              <span>2</span>Eine Verordnung für diesen Fall
            </legend>
            <div className="case-form-grid">
              <label>
                Verordnungsreferenz (optional)
                <input
                  autoComplete="off"
                  maxLength={80}
                  value={form.prescription.number ?? ""}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      prescription: {
                        ...current.prescription,
                        number: e.target.value,
                      },
                    }))
                  }
                />
              </label>
              <label>
                Ausstellungsdatum der Verordnung
                <input
                  type="date"
                  required
                  value={form.prescription.issuedAt}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      prescription: {
                        ...current.prescription,
                        issuedAt: e.target.value,
                      },
                    }))
                  }
                />
              </label>
              <label>
                Verordnung gültig ab (optional)
                <input
                  type="date"
                  value={form.prescription.validFrom ?? ""}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      prescription: {
                        ...current.prescription,
                        validFrom: e.target.value,
                      },
                    }))
                  }
                />
              </label>
              <label>
                Verordnung gültig bis (optional)
                <input
                  type="date"
                  value={form.prescription.validTo ?? ""}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      prescription: {
                        ...current.prescription,
                        validTo: e.target.value,
                      },
                    }))
                  }
                />
              </label>
            </div>
            <label className="case-checkbox">
              <input
                type="checkbox"
                checked={form.prescription.confirmed}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    prescription: {
                      ...current.prescription,
                      confirmed: e.target.checked,
                    },
                  }))
                }
              />
              <span>
                Verordnung und erforderliche Genehmigung für diese Fahrten
                geprüft
              </span>
            </label>
          </fieldset>
          <fieldset className="case-section card" disabled={busy}>
            <legend>
              <span>3</span>Strecke & Tarif
            </legend>
            <div className="case-form-grid">
              <label>
                Abholort der Hinfahrt
                <input
                  required
                  maxLength={200}
                  value={template.from}
                  onChange={(e) => updateTemplate("from", e.target.value)}
                />
              </label>
              <label>
                Zielort der Hinfahrt
                <input
                  required
                  maxLength={200}
                  value={template.to}
                  onChange={(e) => updateTemplate("to", e.target.value)}
                />
              </label>
              <label>
                Besetzte Kilometer je einfacher Fahrt
                <input
                  required
                  inputMode="decimal"
                  maxLength={10}
                  value={template.km}
                  onChange={(e) => updateTemplate("km", e.target.value)}
                />
              </label>
              <label>
                Vertragstarif
                <select
                  aria-label="Vertragstarif"
                  value={form.tariff}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      tariff: e.target.value as "I" | "II",
                    }))
                  }
                >
                  <option value="I">Art. I · ohne besondere Ausprägung</option>
                  <option value="II">Art. II · Serienbehandlung</option>
                </select>
              </label>
              <label>
                Fahrzeugart
                <select
                  aria-label="Fahrzeugart"
                  value={form.vehicle}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      vehicle: e.target.value as "taxi" | "rental",
                    }))
                  }
                >
                  <option value="taxi">Taxi</option>
                  <option value="rental">
                    Mietwagen · gesonderte Prüfung nötig
                  </option>
                </select>
              </label>
            </div>
            <label className="case-checkbox">
              <input
                type="checkbox"
                checked={form.contractConfirmed}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    contractConfirmed: e.target.checked,
                  }))
                }
              />
              <span>
                Meine Vertragsberechtigung für den gewählten Tarif ist geprüft
              </span>
            </label>
          </fieldset>
          <fieldset className="case-section card" disabled={busy}>
            <legend>
              <span>4</span>Alle Fahrtdaten dieser Verordnung
            </legend>
            <div className="case-bulk-entry">
              <div>
                <label>
                  Mehrere Fahrtdaten auf einmal
                  <textarea
                    aria-label="Mehrere Fahrtdaten auf einmal"
                    rows={3}
                    value={bulkDates}
                    onChange={(e) => setBulkDates(e.target.value)}
                    placeholder={"z. B. 19.10.2026\n20.10.2026\n21.10.2026"}
                  />
                </label>
                <p className="case-help">
                  Pro Zeile ein Datum. Auch durch Komma oder Semikolon getrennt
                  möglich.
                </p>
              </div>
              <div className="case-bulk-actions">
                <label>
                  Fahrtrichtungen der Datumsliste
                  <select
                    aria-label="Fahrtrichtungen der Datumsliste"
                    value={bulkDirection}
                    onChange={(event) =>
                      setBulkDirection(
                        event.target.value as "both" | "outbound" | "return",
                      )
                    }
                  >
                    <option value="both">Hin- und Rückfahrt</option>
                    <option value="outbound">Nur Hinfahrt</option>
                    <option value="return">Nur Rückfahrt</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="button secondary"
                  disabled={!bulkDates.trim()}
                  onClick={addDates}
                >
                  <CalendarPlus size={17} /> Fahrtdaten übernehmen
                </button>
              </div>
            </div>
            <div className="case-row-count">
              <strong>
                {form.journeys.length}{" "}
                {form.journeys.length === 1 ? "Fahrt" : "Fahrten"}
              </strong>
              <span>
                Höchstens 20 Einzelfahrten pro Fall. Jede Richtung wird einzeln
                berechnet.
              </span>
            </div>
            <div className="case-trip-list">
              {form.journeys.map((row, index) => (
                <div className="case-trip-row" key={row.key}>
                  <span className="case-trip-index">{index + 1}</span>
                  <label>
                    Fahrtdatum {index + 1}
                    <input
                      aria-label={`Fahrtdatum ${index + 1}`}
                      type="date"
                      required
                      value={row.date}
                      onChange={(e) =>
                        updateRow(row.key, { date: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Richtung {index + 1}
                    <select
                      aria-label={`Richtung ${index + 1}`}
                      value={row.direction}
                      onChange={(e) =>
                        updateRow(row.key, {
                          direction: e.target.value as "outbound" | "return",
                          from: row.to,
                          to: row.from,
                        })
                      }
                    >
                      <option value="outbound">Hinfahrt</option>
                      <option value="return">Rückfahrt</option>
                    </select>
                  </label>
                  <label>
                    Kilometer {index + 1}
                    <input
                      aria-label={`Kilometer ${index + 1}`}
                      inputMode="decimal"
                      required
                      maxLength={10}
                      value={row.km}
                      onChange={(e) =>
                        updateRow(row.key, { km: e.target.value })
                      }
                    />
                  </label>
                  <strong className="case-trip-amount">
                    {preview[index]?.tariff
                      ? formatMoney(preview[index].tariff.grossCents)
                      : "—"}
                  </strong>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Fahrt ${index + 1} entfernen`}
                    disabled={form.journeys.length === 1}
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        journeys: current.journeys.filter(
                          (item) => item.key !== row.key,
                        ),
                      }))
                    }
                  >
                    <Trash2 size={17} />
                  </button>
                  <details className="case-trip-detail">
                    <summary>
                      Strecke und Belegreferenz <ChevronDown size={13} />
                    </summary>
                    <div className="case-form-grid">
                      <label>
                        Abholort Fahrt {index + 1}
                        <input
                          required
                          maxLength={200}
                          value={row.from}
                          onChange={(e) =>
                            updateRow(row.key, { from: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Zielort Fahrt {index + 1}
                        <input
                          required
                          maxLength={200}
                          value={row.to}
                          onChange={(e) =>
                            updateRow(row.key, { to: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Belegreferenz Fahrt {index + 1} (optional)
                        <input
                          maxLength={50}
                          value={row.receiptNumber ?? ""}
                          onChange={(e) =>
                            updateRow(row.key, {
                              receiptNumber: e.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                  </details>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="text-button case-add-trip"
              disabled={form.journeys.length >= 20}
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  journeys: [
                    ...current.journeys,
                    emptyRow(template.from, template.to, template.km),
                  ],
                }))
              }
            >
              <Plus size={17} /> Einzelnes Fahrtdatum hinzufügen
            </button>
          </fieldset>
          <section
            className="case-section card case-calculation"
            aria-label="Unterberechnung des Abrechnungsfalls"
          >
            <div className="case-section-heading">
              <ReceiptText size={21} />
              <div>
                <h3>Unterberechnung</h3>
                <p>
                  Tarifpositionen und Steuer werden je einfacher Fahrt
                  berechnet.
                </p>
              </div>
            </div>
            {previewComplete ? (
              <>
                <div className="case-calculation-totals">
                  <div>
                    <span>Netto{previewPending ? " (vorläufig)" : ""}</span>
                    <strong>
                      {formatMoney(
                        preview.reduce((total, row) => total + row.netCents, 0),
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>
                      Umsatzsteuer{previewPending ? " (vorläufig)" : ""}
                    </span>
                    <strong>
                      {formatMoney(
                        preview.reduce((total, row) => total + row.taxCents, 0),
                      )}
                    </strong>
                  </div>
                  <div className="case-gross-total">
                    <span>Fallbetrag brutto</span>
                    <strong>{formatMoney(previewGross)}</strong>
                  </div>
                </div>
                {previewPending && (
                  <p className="notice warning" role="status">
                    Bei mehr als 50 km muss die Gemeindezuordnung feststehen.
                    Bis dahin sind Nettobetrag und Steuer vorläufig; der Fall
                    kann als Entwurf gespeichert werden.
                  </p>
                )}
                <details className="case-position-details">
                  <summary>
                    Alle Tarifpositionen anzeigen <ChevronDown size={15} />
                  </summary>
                  {preview.map((row, index) => (
                    <div className="case-position-group" key={row.key}>
                      <h4>
                        {dateLabel(form.journeys[index].date)} ·{" "}
                        {form.journeys[index].direction === "return"
                          ? "Rückfahrt"
                          : "Hinfahrt"}{" "}
                        · {row.rate} % USt.{row.pending ? " (vorläufig)" : ""}
                      </h4>
                      {row.tariff?.positions.map((position) => (
                        <div key={position.code}>
                          <span>
                            <code>{position.code}</code> {position.label}
                          </span>
                          <span>
                            {position.quantity} ×{" "}
                            {formatMoney(position.unitCents)}
                          </span>
                          <strong>{formatMoney(position.totalCents)}</strong>
                        </div>
                      ))}
                    </div>
                  ))}
                </details>
              </>
            ) : (
              <p className="case-inline-note">
                {preview.find((row) => row.error)?.error ||
                  "Fahrtdaten und Vertragsberechtigung ergänzen, um die Unterberechnung zu sehen."}
              </p>
            )}
            <p className="case-help">
              Der gespeicherte Fall wird zusätzlich auf dem Server geprüft.
              Fehlende Voraussetzungen bleiben als offene Punkte sichtbar.
            </p>
          </section>
          <div className="case-form-footer">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => {
                setEditing(null);
                setLocalError("");
              }}
            >
              Abbrechen
            </button>
            <button className="button primary" disabled={busy}>
              {busy ? "Speichert …" : "Abrechnungsfall speichern"}
              <Check size={17} />
            </button>
          </div>
        </form>
      </section>
    );

  return (
    <section className="case-workspace" aria-label="Abrechnungsfälle verwalten">
      <div className="case-intro card">
        <div className="case-intro-symbol">
          <Stethoscope size={24} />
        </div>
        <div>
          <h2>Vom Fall zur Sammelrechnung</h2>
          <p>
            Eine Verordnung mit allen Fahrtterminen erfassen. Anschließend
            mehrere fertige Fälle derselben Kasse zu einer Rechnung bündeln.
          </p>
        </div>
        <button className="button primary" type="button" onClick={startNew}>
          <Plus size={17} /> Abrechnungsfall anlegen
        </button>
      </div>
      <div className="case-kpis">
        <div className="card">
          <span>Offene Fälle</span>
          <strong>{cases.filter((item) => !item.invoiceId).length}</strong>
        </div>
        <div className="card">
          <span>Bereit zur Rechnung</span>
          <strong>
            {cases.filter((item) => item.status === "ready").length}
          </strong>
        </div>
        <div className="card">
          <span>Offener Fallbetrag</span>
          <strong>
            {formatMoney(
              cases
                .filter((item) => !item.invoiceId)
                .reduce((sum, item) => sum + item.grossCents, 0),
            )}
          </strong>
        </div>
      </div>
      {(error || localError) && (
        <div className="notice danger" role="alert">
          {localError || error}
        </div>
      )}
      <div className="case-list-card card">
        <div className="case-list-toolbar">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Abrechnungsfälle suchen"
              placeholder="Name, Kasse, IK, Verordnung oder Datum …"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <label className="case-filter-label">
            Fallstatus
            <select
              aria-label="Abrechnungsfälle nach Status filtern"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="open">Offene Fälle</option>
              <option value="ready">Bereit zur Rechnung</option>
              <option value="invoiced">Abgerechnet</option>
              <option value="all">Alle Fälle</option>
            </select>
          </label>
        </div>
        {!visible.length ? (
          <div className="case-empty">
            <ClipboardList size={34} />
            <h3>
              {cases.length
                ? "Keine passenden Fälle"
                : "Dein erster Abrechnungsfall"}
            </h3>
            <p>
              {cases.length
                ? "Suche oder Filter anpassen, um weitere Fälle zu sehen."
                : "Kasse auswählen, versicherte Person und Verordnung eintragen, alle Fahrttermine hinzufügen. Du brauchst vorher keinen Kunden anzulegen."}
            </p>
            {!cases.length && (
              <button
                type="button"
                className="button primary"
                onClick={startNew}
              >
                Neue Abrechnung starten <ArrowRight size={17} />
              </button>
            )}
          </div>
        ) : (
          <div className="case-list">
            {visible.map((item) => (
              <article
                className={
                  "case-list-item " +
                  (selection.includes(item.id) ? "is-selected" : "")
                }
                key={item.id}
              >
                <div className="case-item-top">
                  <label className="case-select">
                    <input
                      type="checkbox"
                      aria-label={`Abrechnungsfall ${item.number} auswählen`}
                      checked={selection.includes(item.id)}
                      disabled={
                        !!item.invoiceId ||
                        item.status !== "ready" ||
                        (!!bundlePayer &&
                          item.payer.id !== bundlePayer &&
                          !selection.includes(item.id))
                      }
                      onChange={(event) => {
                        setSelection((current) =>
                          event.target.checked
                            ? [...current, item.id]
                            : current.filter((id) => id !== item.id),
                        );
                        setConfirmedBundle(false);
                      }}
                    />
                    <span className="case-number">{item.number}</span>
                  </label>
                  <span
                    className={
                      "case-status " +
                      (item.invoiceId
                        ? "invoiced"
                        : item.status === "ready"
                          ? "ready"
                          : "draft")
                    }
                  >
                    {item.invoiceId
                      ? "Abgerechnet"
                      : item.status === "ready"
                        ? "Bereit zur Rechnung"
                        : "Offene Angaben"}
                  </span>
                </div>
                <div className="case-item-main">
                  <div>
                    <h3>{item.insured.name}</h3>
                    <p>
                      {item.payer.name}
                      {item.payer.ik
                        ? ` · IK ${item.payer.ik}`
                        : " · IK noch offen"}
                    </p>
                    <small>
                      {item.journeys.length} Fahrten · Verordnung vom{" "}
                      {dateLabel(item.prescription.issuedAt)}
                      {item.prescription.number
                        ? ` · ${item.prescription.number}`
                        : ""}
                    </small>
                  </div>
                  <strong>{formatMoney(item.grossCents)}</strong>
                </div>
                {item.blockers.length > 0 && (
                  <div className="case-blockers">
                    <span>
                      {item.blockers.length}{" "}
                      {item.blockers.length === 1
                        ? "Punkt offen"
                        : "Punkte offen"}
                    </span>
                    <ul>
                      {item.blockers.map((blocker, index) => (
                        <li key={index}>{blocker}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="case-item-footer">
                  <details>
                    <summary>
                      Fahrtdaten & Unterberechnung <ChevronDown size={14} />
                    </summary>
                    <div className="case-saved-trip-list">
                      {item.journeys.map((row, index) => (
                        <div key={row.id ?? index}>
                          <span>
                            {dateLabel(row.date)} ·{" "}
                            {row.direction === "return"
                              ? "Rückfahrt"
                              : "Hinfahrt"}
                            <small>
                              {row.from} → {row.to} · {row.km} km
                              {row.taxPending ? " · Steuer vorläufig" : ""}
                            </small>
                          </span>
                          <strong>{formatMoney(row.grossCents)}</strong>
                        </div>
                      ))}
                      <div className="case-saved-totals">
                        <span>
                          Netto {formatMoney(item.netCents)} · USt.{" "}
                          {formatMoney(item.taxCents)}
                        </span>
                        <strong>Brutto {formatMoney(item.grossCents)}</strong>
                      </div>
                    </div>
                  </details>
                  {item.invoiceId ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => onOpenInvoice(item.invoiceId!)}
                    >
                      <FileText size={15} /> Rechnung öffnen
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => editCase(item)}
                    >
                      Fall bearbeiten <ArrowRight size={15} />
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
      {selectedCases.length > 0 && (
        <section
          className="case-bundle card"
          aria-label="Ausgewählte Abrechnungsfälle abrechnen"
        >
          <div className="case-section-heading">
            <ReceiptText size={22} />
            <div>
              <h2>
                Eine Rechnung aus {selectedCases.length}{" "}
                {selectedCases.length === 1 ? "Fall" : "Fällen"}
              </h2>
              <p>
                {selectedCases[0].payer.name} ·{" "}
                {selectedCases.reduce(
                  (sum, item) => sum + item.journeys.length,
                  0,
                )}{" "}
                Fahrten
              </p>
            </div>
            <strong>{formatMoney(bundleTotal)}</strong>
          </div>
          {bundleMixed && (
            <div role="alert" className="notice danger">
              Für eine Sammelrechnung nur Fälle derselben Krankenkasse
              auswählen.
            </div>
          )}
          <div className="case-bundle-controls">
            <label>
              Rechnungsdatum
              <input
                type="date"
                required
                value={issuedAt}
                max={businessDate}
                onChange={(event) => {
                  setIssuedAt(event.target.value);
                  setConfirmedBundle(false);
                }}
              />
            </label>
            <label className="case-checkbox">
              <input
                type="checkbox"
                checked={confirmedBundle}
                onChange={(event) => setConfirmedBundle(event.target.checked)}
              />
              <span>Ausgewählte Fälle und Rechnungsbetrag geprüft</span>
            </label>
          </div>
          <div className="case-bundle-footer">
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                setSelection([]);
                setConfirmedBundle(false);
              }}
            >
              Auswahl aufheben
            </button>
            <button
              type="button"
              className="button primary"
              disabled={busy || !bundleReady || !issuedAt || !confirmedBundle}
              onClick={async () => {
                setLocalError("");
                const signature = JSON.stringify({
                  caseIds: [...selection].sort(),
                  issuedAt,
                });
                if (bundleCommand.current.signature !== signature)
                  bundleCommand.current = {
                    signature,
                    key: crypto.randomUUID(),
                  };
                if (
                  await onInvoice(
                    selection,
                    issuedAt,
                    bundleCommand.current.key,
                  )
                ) {
                  setSelection([]);
                  setConfirmedBundle(false);
                }
              }}
            >
              {busy ? "Erstellt …" : "Fälle zu einer Testrechnung bündeln"}
              <CheckCheck size={17} />
            </button>
          </div>
          <p className="case-help">
            Nach dem Erstellen bleiben Fälle, Fahrten und das Rechnungsoriginal
            unverändert. Ein Rechnungspaket ist noch kein DTA-Versand.
          </p>
        </section>
      )}
    </section>
  );
}
