import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Check, Search, X } from "lucide-react";
import {
  getPayer,
  searchPayers,
  payerRegistrySummary,
  type PayerRecord,
} from "./domain/payers";
const registry = payerRegistrySummary();
const kindLabel = (payer: PayerRecord) =>
  payer.isSynthetic
    ? "Testkasse"
    : payer.listingStatus === "historical"
      ? "Historischer Eintrag"
      : payer.listingStatus === "directory-only"
        ? "Zusätzlicher Verzeichniseintrag"
        : payer.insurerType === "statutory"
          ? "Gesetzlich"
          : payer.insurerType === "special"
            ? "Verbundene Versorgungseinrichtung"
            : "Privat";
const ikLabel = (payer: PayerRecord) =>
  payer.ikStatus === "missing"
    ? "IK noch nicht belegt"
    : payer.ikStatus === "reference-only"
      ? "IK-Referenz · anderes Verfahren"
      : "Institutions-IK belegt";
import "./payer-picker.css";

interface Props {
  value: string;
  onChange: (payer: PayerRecord | null) => void;
  id?: string;
  disabled?: boolean;
  required?: boolean;
}
const formatIk = (value: string | null) =>
  value ? value.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3") : "IK fehlt";
export default function PayerPicker({
  value,
  onChange,
  id,
  disabled = false,
  required = true,
}: Props) {
  const generated = useId();
  const inputId = id ?? generated + "-payer";
  const listId = inputId + "-options";
  const selected = getPayer(value);
  const [query, setQuery] = useState(selected?.name ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const result = useMemo(
    () => searchPayers(query === selected?.name ? "" : query, 15),
    [query, selected?.name],
  );
  useEffect(() => {
    if (document.activeElement !== input.current)
      setQuery(getPayer(value)?.name ?? "");
  }, [value]);
  useEffect(() => {
    setActive(0);
  }, [query]);
  useEffect(() => {
    if (open)
      document
        .getElementById(listId + "-" + active)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open, listId]);
  const choose = (payer: PayerRecord) => {
    setQuery(payer.name);
    setOpen(false);
    onChange(payer);
  };
  const keyboard = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      event.stopPropagation();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) =>
        !open
          ? 0
          : (current + delta + result.results.length) %
            Math.max(1, result.results.length),
      );
    } else if (event.key === "Enter" && open && result.results[active]) {
      event.preventDefault();
      choose(result.results[active]);
    }
  };
  return (
    <div className="payer-picker">
      <label htmlFor={inputId}>Krankenkasse suchen</label>
      <div className="payer-search-field">
        <Search size={17} aria-hidden="true" />
        <input
          ref={input}
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={
            open && result.results[active] ? listId + "-" + active : undefined
          }
          aria-describedby={inputId + "-help"}
          autoComplete="off"
          maxLength={120}
          placeholder="Name, Kürzel oder IK eingeben …"
          value={query}
          disabled={disabled}
          required={required}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={keyboard}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            if (selected) onChange(null);
          }}
        />
        {query && !disabled && (
          <button
            type="button"
            className="payer-clear"
            aria-label="Kassenauswahl leeren"
            onClick={() => {
              setQuery("");
              setOpen(true);
              onChange(null);
              input.current?.focus();
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>
      <div id={inputId + "-help"} className="payer-help">
        {registry.statutoryCount} gesetzliche · {registry.privateCount} private
        Verbandsmitglieder · {registry.associatedCount} Versorgungseinrichtungen
        · Suche nach Name oder IK
      </div>
      {open && !disabled && (
        <div className="payer-results">
          <div className="payer-result-count" role="status">
            {result.total} Treffer
            {result.total > result.results.length
              ? ` · die ersten ${result.results.length} angezeigt`
              : ""}
          </div>
          <div id={listId} role="listbox" aria-label="Krankenkassen">
            {result.results.map((payer, index) => (
              <button
                type="button"
                role="option"
                aria-selected={payer.id === value}
                aria-label={payer.name}
                id={listId + "-" + index}
                key={payer.id}
                className={
                  "payer-option " +
                  (active === index ? "is-active " : "") +
                  (payer.isSynthetic ? "is-synthetic" : "")
                }
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(payer)}
              >
                <span className="payer-option-main">
                  <strong>{payer.name}</strong>
                  <small>
                    {payer.isSynthetic
                      ? "Fiktive Kasse für den Testablauf"
                      : `${kindLabel(payer)} · ${ikLabel(payer)}`}
                  </small>
                </span>
                <span className="payer-option-ik">
                  {formatIk(payer.ik)}
                  {payer.id === value && <Check size={14} aria-hidden="true" />}
                </span>
              </button>
            ))}
          </div>
          {!result.results.length && (
            <p className="payer-empty">
              Keine passende Kasse gefunden. Name, Abkürzung oder neunstellige
              IK prüfen.
            </p>
          )}
        </div>
      )}
      {selected && !open && (
        <div
          className={
            "payer-selected " + (selected.isSynthetic ? "is-synthetic" : "")
          }
        >
          <Check size={16} aria-hidden="true" />
          <div>
            <strong>{selected.name}</strong>
            <span>
              {kindLabel(selected)} ·{" "}
              {selected.isSynthetic ? "Test-IK" : ikLabel(selected)}
              {selected.ik ? `: ${formatIk(selected.ik)}` : ""}
            </span>
            {!selected.isSynthetic && (
              <small>
                {selected.listingStatus === "historical"
                  ? "Übernommener Anbieter; aktuelle Zuständigkeit beim Nachfolger klären. "
                  : ""}
                {selected.insurerType === "statutory"
                  ? "Der Fall ist als Entwurf speicherbar. Die Versandroute benötigt den Abgleich mit der gültigen Kostenträgerdatei."
                  : "Der Fall ist als Entwurf speicherbar. Private Direktabrechnung erfordert die passende Vereinbarung und Annahmestelle."}
              </small>
            )}
            {!selected.isSynthetic && (
              <details className="payer-route-details">
                <summary>Quellen und Annahmestellen</summary>
                <p>
                  <a href={selected.sourceUrl} target="_blank" rel="noreferrer">
                    Registerquelle
                  </a>{" "}
                  · Stand {selected.sourceDate}
                </p>
                {selected.address && (
                  <p className="payer-postal">
                    <b>Kontaktanschrift · keine Versandfreigabe</b>
                    <br />
                    {selected.address}
                  </p>
                )}
                {selected.dta.status === "published-unverified" && (
                  <>
                    <p>
                      <b>Krankentransport · veröffentlichter TP5-Hinweis</b>
                      <br />
                      Aktuelle Kostenträgerdatei noch abzugleichen.
                    </p>
                    {selected.dta.providerName && (
                      <p>
                        Datenannahme: {selected.dta.providerName}
                        {selected.dta.providerIk
                          ? ` · Anbieter-IK ${formatIk(selected.dta.providerIk)}`
                          : ""}
                      </p>
                    )}
                    {selected.dta.transportAddress && (
                      <p>
                        Transport-E-Mail:{" "}
                        <code>{selected.dta.transportAddress}</code>
                      </p>
                    )}
                    {selected.dta.physicalRecipientIk && (
                      <p>
                        Physischer Empfänger:{" "}
                        {formatIk(selected.dta.physicalRecipientIk)}
                      </p>
                    )}
                    {selected.dta.logicalRecipientIk && (
                      <p>
                        Logischer Empfänger:{" "}
                        {formatIk(selected.dta.logicalRecipientIk)}
                      </p>
                    )}
                    {selected.dta.paperDestinations.map(
                      (destination, index) => (
                        <p className="payer-postal" key={index}>
                          <b>
                            {destination.shipment === "letter"
                              ? "Briefpost"
                              : destination.shipment === "parcel"
                                ? "Paket / privater Postdienst"
                                : "Papierbelege"}{" "}
                            · {destination.condition}
                          </b>
                          <br />
                          {destination.address}
                        </p>
                      ),
                    )}
                    {selected.dta.notes.map((note) => (
                      <p key={note}>{note}</p>
                    ))}
                    <p>
                      <a
                        href={selected.dta.sourceUrl!}
                        target="_blank"
                        rel="noreferrer"
                      >
                        TP5-Primärquelle
                      </a>{" "}
                      · Stand {selected.dta.sourceDate}, S.{" "}
                      {selected.dta.sourcePages.join(", ")}
                    </p>
                  </>
                )}
                {selected.dta.status === "missing" && (
                  <p>
                    Für diesen Eintrag liegt noch keine belegte
                    Krankentransport-Annahmeroute vor.
                  </p>
                )}
                {selected.dta.status === "private-contract-required" && (
                  <p>
                    PKV-Mitgliedschaft oder eine Institutions-IK belegt keinen
                    automatischen §302-GKV-Versandweg. Annahme und
                    Rechnungsempfänger ergeben sich aus der konkreten
                    Vereinbarung.
                  </p>
                )}
              </details>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
