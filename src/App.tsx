import AcceptanceDirectory from "./AcceptanceDirectory";
import SetupPanel from "./SetupPanel";
import BillingCasePanel from "./BillingCasePanel";
import DtaStatusPanel from "./DtaStatusPanel";
import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  LayoutDashboard,
  Route,
  Users,
  ReceiptText,
  ShieldCheck,
  Files,
  ChartNoAxesCombined,
  Settings,
  Search,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Check,
  ChevronRight,
  ChevronDown,
  X,
  Menu,
  Sun,
  Moon,
  Command,
  Download,
  FileText,
  AlertTriangle,
  Clock3,
  LockKeyhole,
  Calculator,
  CheckCheck,
  Wallet,
  CalendarDays,
  ExternalLink,
  Info,
  Car,
  SlidersHorizontal,
  RefreshCw,
  ShieldAlert,
  ClipboardList,
  Copy,
  MapPin,
} from "lucide-react";
import type {
  AppState,
  Customer,
  Invoice,
  JourneyKind,
  CustomerKind,
  TariffInput,
  DtaCheck,
} from "./shared/types";
import { calculateTariff, parseMoney, addCalendarDays } from "./domain/index";
import {
  parseKeV09Subset,
  KeParseError,
  KE_V09_SOURCE,
  type KeV09Document,
} from "./domain/ik";
import { SYNTHETIC_KE_V09 } from "./domain/ik-demo";

type Page =
  | "overview"
  | "cases"
  | "customers"
  | "invoices"
  | "tariffs"
  | "dta"
  | "documents"
  | "reports"
  | "settings";
type Dialog = "customer" | "invoice" | "payment" | "cancel" | null;
const nav = [
  { id: "overview", label: "Übersicht", icon: LayoutDashboard },
  { id: "cases", label: "Abrechnungsfälle", icon: ClipboardList },
  { id: "customers", label: "Kunden & Kontakte", icon: Users },
  { id: "invoices", label: "Rechnungen & Zahlungen", icon: ReceiptText },
  { id: "tariffs", label: "Tariflabor", icon: Calculator },
  { id: "dta", label: "DTA-Zentrale", icon: ShieldCheck },
  { id: "documents", label: "Belege & Post", icon: Files },
  { id: "reports", label: "Berichte", icon: ChartNoAxesCombined },
  { id: "settings", label: "Einstellungen", icon: Settings },
] as const;
const kindLabels: Record<JourneyKind, string> = {
  taxi: "Taxifahrt",
  medical: "Krankenfahrt",
  courier: "Kurierfahrt",
  laboratory: "Laborfahrt",
};
const customerLabels: Record<CustomerKind, string> = {
  private: "Privatkunde",
  business: "Geschäftskunde",
  laboratory: "Labor / Praxis",
  payer: "Test-Kostenträger",
};
const money = (c: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    c / 100,
  );
const date = (d: string) =>
  new Intl.DateTimeFormat("de-DE", { timeZone: "UTC" }).format(
    new Date(d + "T12:00:00Z"),
  );
const timestamp = (d: string) =>
  new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(new Date(d));
const paid = (i: Invoice) => i.payments.reduce((a, p) => a + p.amountCents, 0);
const outstanding = (i: Invoice) =>
  i.status === "cancelled" || i.originalInvoiceId ? 0 : i.grossCents - paid(i);
const message = (e: unknown) =>
  e instanceof Error
    ? e.message
    : "Die Aktion konnte nicht abgeschlossen werden.";
function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Status({
  tone = "neutral",
  children,
}: {
  tone?: "green" | "amber" | "red" | "neutral" | "blue";
  children: React.ReactNode;
}) {
  return (
    <span className={"status " + tone}>
      <span />
      {children}
    </span>
  );
}
function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <Files size={30} />
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function Card({
  title,
  sub,
  children,
  action,
  className = "",
}: {
  title?: string;
  sub?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={"card " + className}>
      {title && (
        <div className="card-heading">
          <div>
            <h2>{title}</h2>
            {sub && <p>{sub}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
function Modal({
  title,
  sub,
  onClose,
  children,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    panel?.querySelector<HTMLElement>("input,select,button")?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab" && panel) {
        const els = [
          ...panel.querySelectorAll<HTMLElement>(
            "button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled)",
          ),
        ].filter((e) => e.offsetParent !== null);
        if (e.shiftKey && document.activeElement === els[0]) {
          e.preventDefault();
          els.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === els.at(-1)) {
          e.preventDefault();
          els[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
      prev?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <div className="modal-head">
          <div>
            <h2 id="dialog-title">{title}</h2>
            {sub && <p>{sub}</p>}
          </div>
          <button
            className="icon-button"
            aria-label="Schließen"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  const id = React.useId();
  return (
    <label className="field">
      <span id={id}>{label}</span>
      {React.isValidElement(children)
        ? React.cloneElement(
            children as React.ReactElement<{ "aria-labelledby"?: string }>,
            { "aria-labelledby": id },
          )
        : children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export default function App() {
  const [authBlocked, setAuthBlocked] = useState(false);
  const [data, setData] = useState<AppState | null>(null),
    [loadError, setLoadError] = useState(""),
    [page, setPage] = useState<Page>(
      () =>
        (new URLSearchParams(location.search).get("page") === "journeys"
          ? "cases"
          : (new URLSearchParams(location.search).get("page") as Page)) ||
        "overview",
    );
  const privateSite = data?.deployment?.kind === "site-private";
  const [caseCreateRequest, setCaseCreateRequest] = useState(0);
  const [dialog, setDialog] = useState<Dialog>(null),
    [palette, setPalette] = useState(false),
    [paletteQuery, setPaletteQuery] = useState(""),
    [mobile, setMobile] = useState(false),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selectedInvoice, setSelectedInvoice] = useState<string | null>(null);
  const [search, setSearch] = useState(""),
    [invoiceFilter, setInvoiceFilter] = useState("all"),
    [dark, setDark] = useState(
      () => localStorage.getItem("taxidta.theme") === "dark",
    );
  const commandKey = useRef<string>(crypto.randomUUID());
  const [customerForm, setCustomerForm] = useState({
    name: "",
    kind: "private" as CustomerKind,
    address: "",
    reference: "",
  });
  const [invoiceCustomer, setInvoiceCustomer] = useState(""),
    [journeyIds, setJourneyIds] = useState<string[]>([]),
    [issuedAt, setIssuedAt] = useState("2026-10-22"),
    [paymentForm, setPaymentForm] = useState({
      amount: "",
      date: "2026-10-22",
      note: "",
    }),
    [cancelReason, setCancelReason] = useState("");
  const [tariff, setTariff] = useState({
    article: "I" as "I" | "II",
    km: "20",
    date: "2026-10-22",
    persons: 1,
    contractConfirmed: true,
    approachKm: "0",
    approachEligible: false,
    tunnelCrossings: 0,
    tunnelConfirmed: false,
  });
  const [keText, setKeText] = useState(""),
    [keReport, setKeReport] = useState<KeV09Document | null>(null),
    [keError, setKeError] = useState("");
  const [ik, setIk] = useState(""),
    [ikChecked, setIkChecked] = useState(false),
    [dtaInvoice, setDtaInvoice] = useState("");
  const refresh = async () => {
    const r = await fetch("/api/state");
    if (!r.ok) {
      const problem = await r.json().catch(() => ({}));
      if (
        typeof problem.code === "string" &&
        problem.code.startsWith("SITE_")
      ) {
        setAuthBlocked(false);
        setData(null);
        throw new Error(
          problem.error ||
            "Der private Testzugang konnte nicht bestätigt werden. Bitte erneut über deinen persönlichen Zugang öffnen.",
        );
      }
      const authFailure =
        typeof problem.code === "string" &&
        (problem.code.startsWith("AUTH_") ||
          problem.code.startsWith("SUPABASE_"));
      if (r.status === 401 || r.status === 403 || authFailure) {
        setLoadError(
          problem.error ||
            "Bitte mit dem Inhaber-Konto und Authenticator anmelden.",
        );
        setAuthBlocked(true);
        setData(null);
        return null;
      }
      throw new Error(
        typeof problem.error === "string"
          ? problem.error
          : "Die Anwendung antwortet nicht. Bitte die Verbindung prüfen.",
      );
    }
    const d: AppState = await r.json();
    setAuthBlocked(false);
    setLoadError("");
    setData(d);
    return d;
  };
  useEffect(() => {
    refresh().catch((e) => setLoadError(message(e)));
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("taxidta.theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    if (page !== "cases") setCaseCreateRequest(0);
    const valid = nav.some((n) => n.id === page);
    if (!valid) {
      setPage("overview");
      return;
    }
    history.replaceState(null, "", "?page=" + page);
    setSearch("");
    setMobile(false);
  }, [page]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      }
      if (e.key === "Escape") {
        setPalette(false);
        setMobile(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(id);
  }, [toast]);
  const mutate = async (path: string, body: unknown, success: string) => {
    if (!data) return null;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api" + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": data.csrfToken,
          "Idempotency-Key": commandKey.current,
        },
        body: JSON.stringify(body),
      });
      const value = await r.json();
      if (
        !r.ok &&
        typeof value.code === "string" &&
        value.code.startsWith("SITE_")
      ) {
        setAuthBlocked(false);
        setData(null);
        setLoadError(
          value.error ||
            "Der private Testzugang konnte nicht bestätigt werden.",
        );
      }
      if (
        (r.status === 401 || r.status === 403) &&
        typeof value.code === "string" &&
        (value.code.startsWith("AUTH_") || value.code.startsWith("SUPABASE_"))
      ) {
        setLoadError(
          value.error || "Bitte erneut mit dem Inhaber-Konto anmelden.",
        );
        setAuthBlocked(true);
        setData(null);
      }
      if (!r.ok)
        throw new Error(
          typeof value.error === "string"
            ? value.error
            : value.message || "Bitte die Eingaben prüfen.",
        );
      try {
        await refresh();
        setToast(success);
      } catch {
        setToast(success + " Ansicht bitte neu laden.");
      }
      return value;
    } catch (e) {
      setError(message(e));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const newBillingCase = () => {
    setError("");
    commandKey.current = crypto.randomUUID();
    setPage("cases");
    setCaseCreateRequest((value) => value + 1);
  };
  const openDialog = (d: Dialog) => {
    setError("");
    commandKey.current = crypto.randomUUID();
    if (d === "invoice") {
      setInvoiceCustomer("");
      setJourneyIds([]);
      setIssuedAt(data?.businessDate || "2026-10-22");
    }
    if (d === "customer")
      setCustomerForm({
        name: "",
        kind: "private",
        address: "",
        reference: "",
      });
    setDialog(d);
  };
  const customer = (id: string) => data?.customers.find((c) => c.id === id);
  const billingCase = (id: string | undefined) =>
    id ? data?.billingCases?.find((item) => item.id === id) : undefined;
  const currentInvoice =
    data?.invoices.find((i) => i.id === selectedInvoice) || null;
  const activeInvoices =
    data?.invoices.filter(
      (i) => !i.originalInvoiceId && i.status !== "cancelled",
    ) || [];
  const unbilled = data?.journeys.filter((j) => !j.invoiceId) || [];
  const unbilledCases =
    data?.billingCases?.filter((item) => !item.invoiceId) || [];
  const totalOpen = activeInvoices.reduce((a, i) => a + outstanding(i), 0),
    totalPaid = activeInvoices.reduce((a, i) => a + paid(i), 0);
  const due = activeInvoices.filter(
    (i) =>
      outstanding(i) > 0 &&
      i.dueAtVerified !== false &&
      i.dueAt <= (data?.businessDate || ""),
  );
  const todayJourneys =
    data?.journeys.filter((j) => j.date === data.businessDate) || [];
  const medical = data?.journeys.filter((j) => j.kind === "medical") || [];
  const tariffResult = useMemo(() => {
    try {
      return { value: calculateTariff(tariff), error: "" };
    } catch (e) {
      return { value: null, error: message(e) };
    }
  }, [tariff]);
  const queryMatch = (...values: unknown[]) =>
    values
      .join(" ")
      .toLocaleLowerCase("de")
      .includes(search.toLocaleLowerCase("de"));
  const visibleInvoices =
    data?.invoices.filter(
      (i) =>
        queryMatch(i.number, i.customerSnapshot.name) &&
        (invoiceFilter === "all" ||
          (invoiceFilter === "open"
            ? outstanding(i) > 0
            : invoiceFilter === "paid"
              ? outstanding(i) === 0 &&
                i.status !== "cancelled" &&
                !i.originalInvoiceId
              : i.status === "cancelled" || !!i.originalInvoiceId)),
    ) || [];
  const available = unbilled.filter(
    (j) => j.customerId === invoiceCustomer && !j.billingCaseId,
  );
  const selectedJourneys = available.filter((j) => journeyIds.includes(j.id));
  const formError = error && (
    <div className="notice danger" role="alert">
      <AlertTriangle size={18} />
      <span>{error}</span>
    </div>
  );
  const closeDialog = () => {
    if (!busy) {
      setDialog(null);
      setError("");
    }
  };
  const searchBar = (placeholder: string) => (
    <div className="search-field">
      <Search size={17} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {search && (
        <button
          className="icon-button"
          aria-label="Suche leeren"
          onClick={() => setSearch("")}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
  const invoiceStatus = (i: Invoice) =>
    i.originalInvoiceId ? (
      <Status tone="neutral">Stornobeleg</Status>
    ) : i.status === "cancelled" ? (
      <Status tone="neutral">Storniert</Status>
    ) : outstanding(i) === 0 ? (
      <Status tone="green">Bezahlt</Status>
    ) : paid(i) > 0 ? (
      <Status tone="blue">Teilbezahlt</Status>
    ) : i.dueAtVerified !== false && i.dueAt < (data?.businessDate || "") ? (
      <Status tone="amber">Fällig</Status>
    ) : (
      <Status tone="amber">Offen</Status>
    );
  const invoiceTable = (items: Invoice[], compact = false) => (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Rechnung / Kunde</th>
            {!compact && <th>Rechnungsdatum</th>}
            <th>Fälligkeit</th>
            <th>Status</th>
            <th className="number">Betrag</th>
            <th aria-label="Öffnen" />
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr
              key={i.id}
              className="click-row"
              onClick={() => {
                setSelectedInvoice(i.id);
                setPage("invoices");
              }}
            >
              <td>
                <button
                  className="table-link"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedInvoice(i.id);
                    setPage("invoices");
                  }}
                >
                  {i.number}
                </button>
                <small>{i.customerSnapshot.name}</small>
              </td>
              {!compact && <td>{date(i.issuedAt)}</td>}
              <td>
                {date(i.dueAt)}
                {i.dueAtVerified === false && (
                  <small>Demo-Wiedervorlage · Frist offen</small>
                )}
              </td>
              <td>{invoiceStatus(i)}</td>
              <td className="number">
                <strong>{money(i.grossCents)}</strong>
                {paid(i) > 0 && !i.originalInvoiceId && (
                  <small>{money(outstanding(i))} offen</small>
                )}
              </td>
              <td>
                <ChevronRight size={17} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!items.length && (
        <Empty
          title="Hier ist alles erledigt"
          text="Rechnungen erscheinen, sobald Sie gespeicherte Fahrten abrechnen."
        />
      )}
    </div>
  );
  if (!data && authBlocked)
    return (
      <div className="auth-gate">
        <div className="auth-gate-brand">
          <div className="brand-mark">
            T<span>D</span>
          </div>
          <h1>TaxiDTA</h1>
          <p>Inhaber-Anmeldung · Nur synthetische Testdaten</p>
        </div>
        <SetupPanel
          gated
          onAuthenticated={() => {
            void refresh().catch((e) => setLoadError(message(e)));
          }}
        />
        {loadError && <p role="alert">{loadError}</p>}
      </div>
    );
  if (!data)
    return (
      <div className="boot">
        <div className="brand-mark">
          T<span>D</span>
        </div>
        <h1>TaxiDTA</h1>
        <p>{loadError || "Die Testumgebung wird geladen …"}</p>
        {loadError && (
          <button className="button primary" onClick={() => location.reload()}>
            Erneut versuchen
          </button>
        )}
      </div>
    );
  return (
    <div className="app-shell">
      <div className="demo-banner">
        <span>
          <ShieldCheck size={14} />
          <strong>
            {privateSite ? "Privater Testbetrieb" : "Lokale Demo"}
          </strong>
          <span className="banner-detail">
            Ausschließlich erfundene Daten · Kein Produktivversand
          </span>
        </span>
        <button onClick={() => setPage("settings")}>
          Betriebsstatus <ArrowUpRight size={13} />
        </button>
      </div>
      {mobile && <div className="nav-scrim" onClick={() => setMobile(false)} />}
      <aside className={"sidebar " + (mobile ? "is-open" : "")}>
        <a
          className="brand"
          href="?page=overview"
          onClick={(e) => {
            e.preventDefault();
            setPage("overview");
          }}
        >
          <div className="brand-mark">
            T<span>D</span>
          </div>
          <div>
            TaxiDTA<small>Einfach. Klar. Abgerechnet.</small>
          </div>
        </a>
        <div className="workspace-chip">
          <div className="avatar pale">IT</div>
          <div>
            <strong>Insel Taxi</strong>
            <span>Testbetrieb · Einzelkonto</span>
          </div>
          <LockKeyhole size={14} />
        </div>
        <div className="nav-section">ARBEITSPLATZ</div>
        <nav aria-label="Hauptnavigation">
          {nav.slice(0, 4).map((n) => (
            <button
              key={n.id}
              aria-label={n.label}
              aria-current={page === n.id ? "page" : undefined}
              className={"nav-item " + (page === n.id ? "active" : "")}
              onClick={() => setPage(n.id)}
            >
              <n.icon size={19} />
              <span>{n.label}</span>
            </button>
          ))}
          <div className="nav-section">PRÜFEN & ORGANISIEREN</div>
          {nav.slice(4, 8).map((n) => (
            <button
              key={n.id}
              aria-label={n.label}
              aria-current={page === n.id ? "page" : undefined}
              className={"nav-item " + (page === n.id ? "active" : "")}
              onClick={() => setPage(n.id)}
            >
              <n.icon size={19} />
              <span>{n.label}</span>
              {n.id === "dta" && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-status">
            <span />
            <div>
              <strong>
                {privateSite ? "Privat gespeichert" : "Lokal gespeichert"}
              </strong>
              <small>
                {privateSite
                  ? "Privater Cloudspeicher · Testdaten"
                  : "Auf diesem Rechner · Testdaten"}
              </small>
            </div>
            <ShieldCheck size={16} />
          </div>
          <button
            className={"nav-item " + (page === "settings" ? "active" : "")}
            onClick={() => setPage("settings")}
          >
            <Settings size={19} />
            Einstellungen
          </button>
          <div className="sidebar-user">
            <div className="avatar">M</div>
            <div>
              <strong>Demo-Inhaber</strong>
              <small>
                {privateSite ? "Privater Testzugang" : "Lokaler Testzugang"}
              </small>
            </div>
            <button
              aria-label={dark ? "Helles Design" : "Dunkles Design"}
              className="icon-button"
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Navigation öffnen"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <span>Arbeitsplatz</span>
            <ChevronRight size={14} />
            <strong>{nav.find((n) => n.id === page)?.label}</strong>
          </div>
          <div className="topbar-actions">
            <button
              className="command-trigger"
              onClick={() => {
                setPaletteQuery("");
                setPalette(true);
              }}
            >
              <Search size={17} />
              <span>Suchen oder wechseln</span>
              <kbd>⌘ K</kbd>
            </button>
            <span className="today">
              <CalendarDays size={16} />
              {date(data.businessDate)}
            </span>
            <div className="topbar-avatar">M</div>
          </div>
        </header>
        <main id="main-content" className="content">
          <a className="skip-link" href="#page-heading">
            Zum Inhalt
          </a>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {page === "overview"
                  ? "IHRE ABRECHNUNG. EIN GUTER ÜBERBLICK."
                  : page === "tariffs"
                    ? "NACHVOLLZIEHBAR BIS ZUR POSITION"
                    : page === "dta"
                      ? "PRÜFEN. NACHWEISEN. SICHER FREIGEBEN."
                      : "TAXIDTA · LOKALER ARBEITSPLATZ"}
              </div>
              <h1 id="page-heading">
                {page === "overview"
                  ? "Alles im Blick."
                  : nav.find((n) => n.id === page)?.label}
              </h1>
              <p>
                {page === "overview"
                  ? "Von der ersten Fahrt bis zum Zahlungseingang. Ihr Büro läuft zusammen."
                  : page === "cases"
                    ? "Eine Verordnung mit allen Fahrtdaten. Mehrere Fälle gemeinsam abrechnen."
                    : page === "invoices"
                      ? "Jede Rechnung nachvollziehbar. Jede Zahlung richtig zugeordnet."
                      : page === "tariffs"
                        ? "Belegte Tarife ausprobieren – ohne bestehende Rechnungen zu verändern."
                        : page === "customers"
                          ? "Privat, Firma, Labor und Kostenträger. Klar getrennt, schnell gefunden."
                          : page === "dta"
                            ? "Bereitschaft prüfen und offene Voraussetzungen verständlich klären."
                            : page === "documents"
                              ? "Rechnungsoriginale und Belegreferenzen an einem Ort."
                              : page === "reports"
                                ? "Kennzahlen aus Ihren gespeicherten Testdaten."
                                : "Ihr Betriebsmodus, Datensicherheit und nächste Einrichtungsschritte."}
              </p>
            </div>
            <div className="heading-actions">
              {page === "cases" ? (
                <button className="button primary" onClick={newBillingCase}>
                  <Plus size={17} />
                  Neue Abrechnung
                </button>
              ) : page === "customers" ? (
                <button
                  className="button primary"
                  onClick={() => openDialog("customer")}
                >
                  <Plus size={17} />
                  Neuer Kunde
                </button>
              ) : page === "overview" || page === "invoices" ? (
                <>
                  <button className="button primary" onClick={newBillingCase}>
                    <Plus size={17} />
                    Neue Abrechnung
                  </button>
                  <button
                    className="button primary"
                    onClick={() => openDialog("invoice")}
                  >
                    <ReceiptText size={17} />
                    Neue Rechnung
                  </button>
                </>
              ) : null}
            </div>
          </div>
          {error && !dialog && page !== "cases" && (
            <div className="notice danger" role="alert">
              <AlertTriangle size={18} />
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Fehlermeldung schließen"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {page === "cases" && (
            <BillingCasePanel
              cases={data.billingCases ?? []}
              businessDate={data.businessDate}
              requestNew={caseCreateRequest}
              busy={busy}
              error={error}
              onSave={async (input, caseId) => {
                const result = await mutate(
                  caseId
                    ? "/billing-cases/" + caseId + "/update"
                    : "/billing-cases",
                  input,
                  caseId
                    ? "Abrechnungsfall aktualisiert."
                    : "Abrechnungsfall mit allen Fahrten gespeichert.",
                );
                return !!result;
              }}
              onInvoice={async (caseIds, invoiceDate, caseCommandKey) => {
                commandKey.current = caseCommandKey;
                const result = await mutate(
                  "/invoices/from-cases",
                  { caseIds, issuedAt: invoiceDate },
                  "Fälle gebündelt und Rechnungsoriginal erstellt.",
                );
                if (result) {
                  setSelectedInvoice(result.id || result.invoice?.id);
                  setPage("invoices");
                }
                return !!result;
              }}
              onOpenInvoice={(invoiceId) => {
                setSelectedInvoice(invoiceId);
                setPage("invoices");
              }}
            />
          )}
          {page === "overview" && (
            <>
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-label">
                    Offene Forderungen{" "}
                    <div className="stat-icon mint">
                      <Wallet size={18} />
                    </div>
                  </div>
                  <strong>{money(totalOpen)}</strong>
                  <small>
                    <span className="tiny-dot amber-dot" />
                    {
                      activeInvoices.filter((i) => outstanding(i) > 0).length
                    }{" "}
                    Rechnungen offen
                  </small>
                </div>
                <div className="stat-card">
                  <div className="stat-label">
                    Noch abzurechnen{" "}
                    <div className="stat-icon lilac">
                      <Route size={18} />
                    </div>
                  </div>
                  <strong>
                    {unbilledCases.length}
                    <span>
                      {unbilledCases.length === 1 ? " Fall" : " Fälle"}
                    </span>
                  </strong>
                  <small>
                    {money(
                      unbilledCases.reduce(
                        (total, item) => total + item.grossCents,
                        0,
                      ),
                    )}{" "}
                    gespeicherter Fallwert
                  </small>
                </div>
                <div className="stat-card">
                  <div className="stat-label">
                    Zahlungseingänge{" "}
                    <div className="stat-icon blue-bg">
                      <CheckCheck size={18} />
                    </div>
                  </div>
                  <strong>{money(totalPaid)}</strong>
                  <small>
                    <span className="tiny-dot green-dot" />
                    Erfasste Zahlungen, ohne Storni
                  </small>
                </div>
                <div className="stat-card">
                  <div className="stat-label">
                    Fahrten heute{" "}
                    <div className="stat-icon sand">
                      <Car size={18} />
                    </div>
                  </div>
                  <strong>
                    {todayJourneys.length}
                    <span> Fahrten</span>
                  </strong>
                  <small>Leistungsdatum {date(data.businessDate)}</small>
                </div>
              </div>
              <div className="overview-grid">
                <div className="overview-main">
                  <div className="welcome-panel">
                    <div>
                      <span className="label-uppercase">
                        WENIGER BÜRO. MEHR ÜBERBLICK.
                      </span>
                      <h2>
                        Aus Fahrten werden
                        <br />
                        fertige Rechnungen.
                      </h2>
                      <p>
                        Einzeln oder gesammelt. Mit transparenter
                        <br className="desktop" /> Steuerprüfung und 28 Tagen
                        Zahlungsziel.
                      </p>
                      <div className="welcome-actions">
                        <button
                          className="button primary"
                          onClick={newBillingCase}
                        >
                          Neue Abrechnung starten <ArrowRight size={15} />
                        </button>
                        <button
                          className="text-button"
                          onClick={() => openDialog("invoice")}
                        >
                          Normale Rechnung erstellen <ReceiptText size={15} />
                        </button>
                      </div>
                    </div>
                    <div className="invoice-illustration" aria-hidden="true">
                      <div className="mini-receipt">
                        <div className="mini-logo">
                          <Route size={15} />
                          TaxiDTA <span>RECHNUNG</span>
                        </div>
                        <div className="mini-title">Alles stimmt.</div>
                        <div className="mini-lines">
                          <i />
                          <i />
                          <i />
                        </div>
                        <div className="mini-row">
                          <span>Leistungen</span>
                          <b>3 Fahrten</b>
                        </div>
                        <div className="mini-row total">
                          <span>Bereit zur Prüfung</span>
                          <ShieldCheck size={18} />
                        </div>
                      </div>
                      <div className="floating-check">
                        <Check size={22} />
                      </div>
                      <div className="illustration-orbit" />
                    </div>
                  </div>
                  <Card
                    title="Rechnungen im Blick"
                    sub="Offene Posten und zuletzt erstellte Rechnungen"
                    action={
                      <button
                        className="text-button"
                        onClick={() => setPage("invoices")}
                      >
                        Alle ansehen <ArrowUpRight size={16} />
                      </button>
                    }
                  >
                    {invoiceTable(
                      data.invoices
                        .filter((i) => !i.originalInvoiceId)
                        .slice(0, 5),
                      true,
                    )}
                  </Card>
                  <div className="two-col">
                    <Card
                      title="Fahrten nach Leistungsart"
                      sub="Alle gespeicherten Fahrten"
                    >
                      <div className="kind-bars">
                        {(Object.keys(kindLabels) as JourneyKind[]).map((k) => {
                          const count = data.journeys.filter(
                            (j) => j.kind === k,
                          ).length;
                          return (
                            <div key={k}>
                              <div>
                                <span>{kindLabels[k]}</span>
                                <b>{count}</b>
                              </div>
                              <div className="bar-track">
                                <span
                                  style={{
                                    width: `${Math.max(3, (count / Math.max(1, data.journeys.length)) * 100)}%`,
                                  }}
                                  className={k}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </Card>
                    <Card
                      title="Tarifwissen, direkt zur Hand"
                      sub="Originalquellen statt verdeckter Preislogik"
                    >
                      <div className="tariff-promo">
                        <div className="stat-icon mint">
                          <Calculator size={21} />
                        </div>
                        <strong>20 km. Zwei Vertragsarten.</strong>
                        <p>
                          Art. I: 52,59 € · Art. II: 51,74 €<br />
                          Jeweils mit bestätigter Berechtigung.
                        </p>
                        <button
                          className="text-button"
                          onClick={() => setPage("tariffs")}
                        >
                          Im Tariflabor nachvollziehen <ArrowRight size={16} />
                        </button>
                      </div>
                    </Card>
                  </div>
                </div>
                <div className="overview-side">
                  <Card
                    title="Als Nächstes"
                    sub="Die wichtigen Dinge zuerst"
                    action={<span className="count-badge">3</span>}
                  >
                    <div className="task-list">
                      <button
                        onClick={() => {
                          setPage("cases");
                        }}
                      >
                        <div className="task-icon mint">
                          <ReceiptText size={18} />
                        </div>
                        <div>
                          <strong>
                            {
                              (data.billingCases ?? []).filter(
                                (item) => !item.invoiceId,
                              ).length
                            }{" "}
                            Fälle abrechnen
                          </strong>
                          <p>
                            Vollständige Abrechnungsfälle zur
                            <br />
                            Rechnung zusammenfassen.
                          </p>
                          <span>
                            Abrechnung öffnen <ArrowRight size={13} />
                          </span>
                        </div>
                      </button>
                      <button
                        onClick={() => {
                          setInvoiceFilter("open");
                          setPage("invoices");
                        }}
                      >
                        <div className="task-icon sand">
                          <Clock3 size={18} />
                        </div>
                        <div>
                          <strong>
                            {due.length
                              ? due.length + " fällige Rechnungen"
                              : "Zahlungseingänge prüfen"}
                          </strong>
                          <p>
                            Zahlungen bewusst erfassen
                            <br />
                            und offene Beträge abgleichen.
                          </p>
                          <span>
                            Offene Posten <ArrowRight size={13} />
                          </span>
                        </div>
                      </button>
                      <button onClick={() => setPage("dta")}>
                        <div className="task-icon lilac">
                          <ShieldCheck size={18} />
                        </div>
                        <div>
                          <strong>DTA sicher einrichten</strong>
                          <p>
                            Empfänger, Zertifikate und
                            <br />
                            Teilnahme sind noch offen.
                          </p>
                          <span>
                            Voraussetzungen ansehen <ArrowRight size={13} />
                          </span>
                        </div>
                      </button>
                    </div>
                  </Card>
                  <div className="safety-card">
                    <div className="shield-circle">
                      <ShieldCheck size={24} />
                    </div>
                    <h3>Ein sicherer Anfang.</h3>
                    <p>
                      Diese Testumgebung arbeitet mit erfundenen Daten.
                      Produktiver DTA-Versand ist technisch gesperrt.
                    </p>
                    <button
                      className="text-button"
                      onClick={() => setPage("settings")}
                    >
                      Was bereits geschützt ist <ArrowUpRight size={15} />
                    </button>
                  </div>
                  <Card title="Zuletzt passiert" className="activity-card">
                    <div className="activity-list">
                      {data.audit.slice(0, 4).map((a) => (
                        <div key={a.id}>
                          <span className="activity-dot" />
                          <div>
                            <strong>{a.action.replaceAll("_", " ")}</strong>
                            <small>{timestamp(a.at)} · protokolliert</small>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>
              </div>
            </>
          )}
          {page === "customers" && (
            <>
              <div className="toolbar">
                {searchBar("Name, Anschrift oder Referenz suchen …")}
                <span className="muted">
                  {data.customers.length} gespeicherte Kontakte
                </span>
              </div>
              <div className="customer-grid">
                {data.customers
                  .filter((c) => queryMatch(c.name, c.address, c.reference))
                  .map((c) => (
                    <Card key={c.id} className="customer-card">
                      <div className="customer-card-top">
                        <div className={"contact-avatar " + c.kind}>
                          {c.name
                            .split(" ")
                            .slice(0, 2)
                            .map((s) => s[0])
                            .join("")}
                        </div>
                        <Status tone={c.kind === "payer" ? "amber" : "neutral"}>
                          {customerLabels[c.kind]}
                        </Status>
                      </div>
                      <h3>{c.name}</h3>
                      <p className="address">
                        <MapPin size={15} />
                        <span>{c.address}</span>
                      </p>
                      {c.reference && (
                        <p className="muted">Referenz: {c.reference}</p>
                      )}
                      <div className="contact-summary">
                        <span>
                          <b>
                            {
                              data.journeys.filter((j) => j.customerId === c.id)
                                .length
                            }
                          </b>{" "}
                          Fahrten
                        </span>
                        <span>
                          <b>
                            {money(
                              data.invoices
                                .filter((i) => i.customerId === c.id)
                                .reduce((a, i) => a + outstanding(i), 0),
                            )}
                          </b>{" "}
                          offen
                        </span>
                      </div>
                    </Card>
                  ))}
              </div>
              <div className="notice">
                <ShieldCheck size={18} />
                <span>
                  Nur erfundene Kontakte verwenden. Laborfahrten benötigen keine
                  Patientennamen, Diagnosen oder Versicherungsdaten.
                </span>
              </div>
            </>
          )}
          {page === "invoices" && (
            <>
              <div className="mini-stats">
                <span>
                  <i className="tiny-dot amber-dot" />
                  Offen <strong>{money(totalOpen)}</strong>
                </span>
                <span>
                  <i className="tiny-dot green-dot" />
                  Erfasst bezahlt <strong>{money(totalPaid)}</strong>
                </span>
                <span>
                  <FileText size={16} />
                  {
                    data.invoices.filter((i) => !i.originalInvoiceId).length
                  }{" "}
                  Rechnungen
                </span>
              </div>
              <div className="tabs-bar">
                <div className="tabs">
                  {[
                    ["all", "Alle Rechnungen"],
                    ["open", "Offene Posten"],
                    ["paid", "Bezahlt"],
                    ["cancelled", "Storniert"],
                  ].map(([k, l]) => (
                    <button
                      key={k}
                      className={invoiceFilter === k ? "selected" : ""}
                      onClick={() => setInvoiceFilter(k)}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                {searchBar("Rechnungsnummer oder Kunde …")}
              </div>
              <div
                className={
                  "invoices-layout " + (currentInvoice ? "has-detail" : "")
                }
              >
                <Card>
                  {invoiceTable(visibleInvoices)}
                  <div className="table-footer">
                    <span>
                      {visibleInvoices.length} Dokumente · 28 Tage
                      Standardzahlungsziel
                    </span>
                    <a className="text-button" href="/api/export.csv" download>
                      <Download size={15} />
                      CSV exportieren
                    </a>
                  </div>
                </Card>
                {currentInvoice && (
                  <Card className="invoice-detail">
                    <div className="detail-head">
                      <div>
                        <span className="eyebrow">
                          {currentInvoice.originalInvoiceId
                            ? "STORNOBELEG"
                            : "RECHNUNGSDETAILS"}
                        </span>
                        <h2>{currentInvoice.number}</h2>
                      </div>
                      <button
                        className="icon-button"
                        aria-label="Details schließen"
                        onClick={() => setSelectedInvoice(null)}
                      >
                        <X size={18} />
                      </button>
                    </div>
                    {invoiceStatus(currentInvoice)}
                    <h3>{currentInvoice.customerSnapshot.name}</h3>
                    <p className="address">
                      {currentInvoice.customerSnapshot.address}
                    </p>
                    <div className="detail-dates">
                      <span>
                        Ausgestellt
                        <strong>{date(currentInvoice.issuedAt)}</strong>
                      </span>
                      <span>
                        {currentInvoice.dueAtVerified === false
                          ? "Demo-Wiedervorlage"
                          : "Fällig am"}
                        <strong>{date(currentInvoice.dueAt)}</strong>
                      </span>
                    </div>
                    {currentInvoice.dueAtVerified === false && (
                      <div className="notice warning">
                        <Clock3 size={16} />
                        <span>
                          Die Kassenfrist ist nicht verifiziert. Das Datum ist
                          ausschließlich eine Demo-Wiedervorlage.
                        </span>
                      </div>
                    )}
                    <div className="detail-lines">
                      {currentInvoice.lines.map((l, i) => (
                        <div key={i}>
                          <div>
                            <strong>{l.description}</strong>
                            <small>
                              {date(l.serviceDate)} · {l.taxRate} % USt
                            </small>
                          </div>
                          <b>{money(l.grossCents)}</b>
                        </div>
                      ))}
                    </div>
                    <dl className="totals">
                      <div>
                        <dt>Netto</dt>
                        <dd>{money(currentInvoice.netCents)}</dd>
                      </div>
                      <div>
                        <dt>Umsatzsteuer</dt>
                        <dd>{money(currentInvoice.taxCents)}</dd>
                      </div>
                      <div className="grand-total">
                        <dt>Gesamt brutto</dt>
                        <dd>{money(currentInvoice.grossCents)}</dd>
                      </div>
                      <div>
                        <dt>Zahlungen</dt>
                        <dd>{money(paid(currentInvoice))}</dd>
                      </div>
                      <div>
                        <dt>Offene Forderung</dt>
                        <dd>{money(outstanding(currentInvoice))}</dd>
                      </div>
                    </dl>
                    {currentInvoice.customerSnapshot.kind === "payer" &&
                      !currentInvoice.originalInvoiceId && (
                        <DtaStatusPanel invoiceId={currentInvoice.id} />
                      )}
                    <a
                      className="button primary full"
                      href={"/api/invoices/" + currentInvoice.id + "/pdf"}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Download size={17} />
                      Original-PDF öffnen
                    </a>
                    {outstanding(currentInvoice) > 0 && (
                      <button
                        className="button secondary full"
                        onClick={() => {
                          setPaymentForm({
                            amount: (outstanding(currentInvoice) / 100)
                              .toFixed(2)
                              .replace(".", ","),
                            date: data.businessDate,
                            note: "",
                          });
                          openDialog("payment");
                        }}
                      >
                        <Plus size={17} />
                        Zahlung erfassen
                      </button>
                    )}
                    {currentInvoice.payments.length > 0 && (
                      <div className="payment-history">
                        <h4>Zahlungsverlauf</h4>
                        {currentInvoice.payments.map((p) => (
                          <div key={p.id}>
                            <CheckCheck size={15} />
                            <span>
                              {date(p.date)}
                              <small>{p.note || "Manuell bestätigt"}</small>
                            </span>
                            <strong>{money(p.amountCents)}</strong>
                          </div>
                        ))}
                      </div>
                    )}
                    <details className="hash-details">
                      <summary>Integrität & Nachweis</summary>
                      <p>Original-PDF dauerhaft eingefroren. SHA-256:</p>
                      <code>{currentInvoice.pdfHash}</code>
                      {currentInvoice.lines.map((l, i) => (
                        <div key={i}>
                          <p>
                            <strong>{l.description}</strong>
                            <br />
                            {l.taxRuleId}
                            <br />
                            {l.taxSource}
                          </p>
                          {l.tariffSource && (
                            <p>
                              Tarif: {l.tariffRevision}
                              <br />
                              {l.tariffSource}
                            </p>
                          )}
                        </div>
                      ))}
                    </details>
                    {currentInvoice.status === "issued" &&
                      !currentInvoice.originalInvoiceId && (
                        <button
                          className="text-button danger-text"
                          onClick={() => {
                            setCancelReason("");
                            openDialog("cancel");
                          }}
                        >
                          Rechnung mit Stornobeleg aufheben
                        </button>
                      )}
                  </Card>
                )}
              </div>
            </>
          )}
          {page === "tariffs" && (
            <>
              <div className="lab-grid">
                <Card
                  title="Ihre Testfahrt"
                  sub="Belegte Einzelbeförderung in Schleswig-Holstein"
                >
                  <div className="form-body">
                    <div className="segmented">
                      {(["I", "II"] as const).map((a) => (
                        <button
                          key={a}
                          className={tariff.article === a ? "selected" : ""}
                          onClick={() =>
                            setTariff((t) => ({ ...t, article: a }))
                          }
                        >
                          Art. {a}
                          <small>
                            {a === "I"
                              ? "Allgemeine Fahrt"
                              : "Serienbehandlung"}
                          </small>
                        </button>
                      ))}
                    </div>
                    <div className="form-grid">
                      <Field label="Leistungsdatum">
                        <input
                          type="date"
                          value={tariff.date}
                          onChange={(e) =>
                            setTariff((t) => ({ ...t, date: e.target.value }))
                          }
                        />
                      </Field>
                      <Field
                        label="Besetzte Kilometer"
                        hint="Gesamtstrecke, keine Zusatz-km"
                      >
                        <input
                          inputMode="decimal"
                          value={tariff.km}
                          onChange={(e) =>
                            setTariff((t) => ({ ...t, km: e.target.value }))
                          }
                        />
                      </Field>
                      <Field label="Beförderte Personen">
                        <select
                          value={tariff.persons}
                          onChange={(e) =>
                            setTariff((t) => ({
                              ...t,
                              persons: Number(e.target.value),
                            }))
                          }
                        >
                          <option value={1}>1 Person</option>
                          <option value={2}>
                            2 Personen · Regelprüfung offen
                          </option>
                          <option value={3}>
                            3 Personen · Regelprüfung offen
                          </option>
                        </select>
                      </Field>
                      <Field label="Anfahrtkilometer">
                        <input
                          inputMode="decimal"
                          value={tariff.approachKm}
                          onChange={(e) =>
                            setTariff((t) => ({
                              ...t,
                              approachKm: e.target.value,
                            }))
                          }
                        />
                      </Field>
                    </div>
                    <label className="check-field">
                      <input
                        type="checkbox"
                        checked={tariff.contractConfirmed}
                        onChange={(e) =>
                          setTariff((t) => ({
                            ...t,
                            contractConfirmed: e.target.checked,
                          }))
                        }
                      />
                      <span>
                        Vertragsberechtigung für diesen Testfall bestätigt
                        <small>
                          In der Demo eine Testannahme. Kein Nachweis für Ihren
                          echten Betrieb.
                        </small>
                      </span>
                    </label>
                    <label className="check-field">
                      <input
                        type="checkbox"
                        checked={tariff.approachEligible}
                        onChange={(e) =>
                          setTariff((t) => ({
                            ...t,
                            approachEligible: e.target.checked,
                          }))
                        }
                      />
                      <span>Anfahrt ist nach Vertrag abrechenbar</span>
                    </label>
                    <details className="form-details">
                      <summary>Herrentunnel & Zusatzannahmen</summary>
                      <div className="form-grid">
                        <Field label="Tatsächliche Durchfahrten">
                          <input
                            type="number"
                            min="0"
                            max="2"
                            value={tariff.tunnelCrossings}
                            onChange={(e) =>
                              setTariff((t) => ({
                                ...t,
                                tunnelCrossings: Number(e.target.value),
                              }))
                            }
                          />
                        </Field>
                      </div>
                      <label className="check-field">
                        <input
                          type="checkbox"
                          checked={tariff.tunnelConfirmed}
                          onChange={(e) =>
                            setTariff((t) => ({
                              ...t,
                              tunnelConfirmed: e.target.checked,
                            }))
                          }
                        />
                        <span>
                          Durchfahrt und tarifliche Zulässigkeit belegt
                        </span>
                      </label>
                    </details>
                    <div className="notice">
                      <Info size={17} />
                      <span>
                        Mehrpersonen-, Reha- und nicht belegte Rundungsregeln
                        werden in dieser Version gesperrt.
                      </span>
                    </div>
                  </div>
                </Card>
                <div>
                  {tariffResult.value ? (
                    <Card className="calculation-card">
                      <div className="calculation-top">
                        <span className="eyebrow">
                          NACHVOLLZIEHBARE TESTBERECHNUNG
                        </span>
                        <Status tone="green">Berechnet</Status>
                        <div className="calculation-total">
                          {money(tariffResult.value.grossCents)}
                        </div>
                        <p>
                          Art. {tariff.article} · {tariff.km.replace(".", ",")}{" "}
                          besetzte km · brutto
                        </p>
                      </div>
                      <div className="positions">
                        {tariffResult.value.positions.map((p, i) => (
                          <div key={i}>
                            <span className="position-index">{i + 1}</span>
                            <div>
                              <strong>{p.label}</strong>
                              <code>{p.code}</code>
                              <small>
                                {p.quantity} × {money(p.unitCents)}
                              </small>
                            </div>
                            <b>{money(p.totalCents)}</b>
                          </div>
                        ))}
                      </div>
                      <div className="calculation-explanation">
                        <h3>
                          <Calculator size={17} />
                          So entsteht der Preis
                        </h3>
                        {tariffResult.value.explanation.map((e, i) => (
                          <p key={i}>
                            <Check size={14} />
                            {e}
                          </p>
                        ))}
                      </div>
                      <div className="source-box">
                        <Files size={17} />
                        <div>
                          <strong>Quellenbeleg</strong>
                          <p>{tariffResult.value.source}</p>
                          <small>
                            Stand 01.01.2026 · Anwendung nur im belegten
                            Vertragsbereich
                          </small>
                        </div>
                      </div>
                      {tariffResult.value.warnings.map((w, i) => (
                        <div key={i} className="notice warning">
                          <AlertTriangle size={17} />
                          {w}
                        </div>
                      ))}
                    </Card>
                  ) : (
                    <Card>
                      <div className="blocked-state">
                        <ShieldAlert size={35} />
                        <h2>Berechnung gesperrt</h2>
                        <p>{tariffResult.error}</p>
                        <small>
                          Fehlende oder nicht belegte Regeln werden nicht
                          geschätzt.
                        </small>
                      </div>
                    </Card>
                  )}
                  <div className="notice">
                    <LockKeyhole size={17} />
                    <span>
                      Das Tariflabor verändert keine Fahrt, Rechnung oder
                      freigegebene Tarifversion.
                    </span>
                  </div>
                </div>
              </div>
              <Card
                title="Die häufigste Fehlerquelle? Die ersten drei Kilometer."
                sub="Sie sind bereits in der Grundpauschale enthalten."
              >
                <div className="boundary-grid">
                  {[3, 4, 20].map((k) => (
                    <div key={k}>
                      <span>{k} km Gesamtstrecke</span>
                      <strong>
                        14,00 €{" "}
                        {k > 3
                          ? `+ ${k - 3} × ${tariff.article === "I" ? "2,27" : "2,22"} €`
                          : ""}
                      </strong>
                      <small>
                        {k <= 3
                          ? "Nur die Grundpauschale"
                          : `${k - 3} abrechenbare Zusatz-km`}
                      </small>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}
          {page === "dta" && (
            <>
              <AcceptanceDirectory />
              <div className="notice warning">
                <LockKeyhole size={21} />
                <div>
                  <strong>Produktivversand gesperrt</strong>
                  <p>
                    Diese Version erzeugt einen internen Bereitschaftsbericht.
                    Eine §302-Nutzdatei, Verschlüsselung, Übertragung und
                    Kassenannahme sind noch nicht implementiert.
                  </p>
                </div>
              </div>
              <div className="two-col">
                <Card
                  title="DTA-Einrichtungsassistent"
                  sub="Echte Nachweise vor jedem produktiven Transport"
                >
                  <div className="setup-list">
                    {[
                      [
                        "Eigene Teilnahme & IK",
                        "Bestätigte Identität und Freischaltung des Leistungserbringers.",
                      ],
                      [
                        "Amtliches IK-Routing",
                        "Karten-IK, Kostenträger, physischer und entschlüsselnder Empfänger getrennt.",
                      ],
                      [
                        "Spezifikation & Testdateien",
                        "Offizielle Formatadapter mit validierten Golden Files.",
                      ],
                      [
                        "Zertifikate & Transportweg",
                        "Gültige Schlüssel, bestätigter Kanal und Rückkanal.",
                      ],
                      [
                        "Testannahme & Datenschutz",
                        "Originalquittung, Sicherheitsprüfung und dokumentierte Freigabe.",
                      ],
                    ].map(([a, b], i) => (
                      <div key={a}>
                        <span className="setup-number">{i + 1}</span>
                        <div>
                          <strong>{a}</strong>
                          <p>{b}</p>
                        </div>
                        <Status tone="amber">Offen</Status>
                      </div>
                    ))}
                  </div>
                </Card>
                <div>
                  <Card
                    title="Rechnung auf Bereitschaft prüfen"
                    sub="Kein Versand, keine künstliche Empfangsquittung"
                  >
                    <div className="form-body">
                      <Field label="Kassenrechnung">
                        <select
                          value={dtaInvoice}
                          onChange={(e) => setDtaInvoice(e.target.value)}
                        >
                          <option value="">Rechnung auswählen …</option>
                          {activeInvoices
                            .filter(
                              (i) =>
                                i.customerSnapshot.kind === "payer" ||
                                i.lines.some(
                                  (l) =>
                                    data.journeys.find(
                                      (j) => j.id === l.journeyId,
                                    )?.kind === "medical",
                                ),
                            )
                            .map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.number} · {i.customerSnapshot.name}
                              </option>
                            ))}
                        </select>
                      </Field>
                      <button
                        className="button primary full"
                        disabled={!dtaInvoice || busy}
                        onClick={async () => {
                          await mutate(
                            "/invoices/" + dtaInvoice + "/dta-check",
                            {},
                            "Bereitschaftsbericht erstellt. Versand bleibt gesperrt.",
                          );
                        }}
                      >
                        <ShieldCheck size={17} />
                        {privateSite
                          ? "Vorprüfung starten"
                          : "Lokale Vorprüfung starten"}
                      </button>
                    </div>
                  </Card>
                  {dtaInvoice && (
                    <Card>
                      <DtaStatusPanel invoiceId={dtaInvoice} />
                    </Card>
                  )}
                  <Card
                    title="IK-Inspektor"
                    sub="Keine Zuordnung aus Kassennamen ableiten"
                  >
                    <div className="form-body">
                      <Field label="Zu prüfendes IK">
                        <input
                          inputMode="numeric"
                          maxLength={9}
                          placeholder="9-stelliges IK"
                          value={ik}
                          onChange={(e) => {
                            setIk(e.target.value.replace(/\D/g, ""));
                            setIkChecked(false);
                          }}
                        />
                      </Field>
                      <button
                        className="button secondary full"
                        onClick={() => setIkChecked(true)}
                        disabled={ik.length !== 9}
                      >
                        <Search size={17} />
                        Datenbasis prüfen
                      </button>
                      {ikChecked && (
                        <div className="notice warning">
                          <AlertTriangle size={18} />
                          <span>
                            Keine geprüfte amtliche Kostenträgerdatei aktiviert.
                            Eine Zuordnung für {ik} ist nicht verifiziert.
                            Versand gesperrt.
                          </span>
                        </div>
                      )}
                    </div>
                  </Card>
                </div>
              </div>
              <Card
                title="Kostenträgerformat prüfen"
                sub="Labor für einen belegten Teil des KOTR-Formats · Anhang 3, Version 09"
              >
                <div className="form-body">
                  <div className="notice">
                    <Info size={18} />
                    <span>
                      Dieser Prüfer liest ausgewählte amtliche Segmenttypen. Er
                      aktiviert keine Daten, löst keinen vollständigen IK-Pfad
                      auf und erteilt keine Versandfreigabe. Noch nicht
                      unterstützte Gruppen werden abgewiesen.
                    </span>
                  </div>
                  <div className="ke-actions">
                    <button
                      className="button secondary"
                      onClick={() => {
                        setKeText(SYNTHETIC_KE_V09);
                        setKeReport(null);
                        setKeError("");
                      }}
                    >
                      <FileText size={16} />
                      Synthetisches Muster laden
                    </button>
                    <a
                      className="text-button"
                      href={KE_V09_SOURCE}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Amtliche Formatquelle <ExternalLink size={14} />
                    </a>
                  </div>
                  <Field
                    label="Kostenträgertext im KOTR-Teilprofil"
                    hint="Nur korrekt dekodierten Kostenträgertext einfügen, keine Patientenbelege. Maximal 200.000 Zeichen; keine Speicherung."
                  >
                    <textarea
                      className="ke-input"
                      rows={6}
                      spellCheck={false}
                      maxLength={200000}
                      value={keText}
                      onChange={(e) => {
                        setKeText(e.target.value);
                        setKeReport(null);
                        setKeError("");
                      }}
                      placeholder="UNA:+,? …"
                    />
                  </Field>
                  <div className="ke-actions">
                    <button
                      className="button primary"
                      disabled={!keText.trim()}
                      onClick={() => {
                        try {
                          setKeReport(parseKeV09Subset(keText));
                          setKeError("");
                        } catch (e) {
                          setKeReport(null);
                          setKeError(
                            e instanceof KeParseError
                              ? `${e.message} · Zeichen ${e.offset}, Segment ${e.segmentIndex + 1}${e.field ? ", Feld " + e.field : ""} (${e.code})`
                              : message(e),
                          );
                        }
                      }}
                    >
                      <ShieldCheck size={17} />
                      Struktur prüfen
                    </button>
                    {keText && (
                      <button
                        className="text-button"
                        onClick={() => {
                          setKeText("");
                          setKeReport(null);
                          setKeError("");
                        }}
                      >
                        Eingabe verwerfen
                      </button>
                    )}
                  </div>
                  {keError && (
                    <div className="notice warning" role="alert">
                      <AlertTriangle size={18} />
                      <span>{keError}</span>
                    </div>
                  )}
                  {keReport && (
                    <div className="ke-result">
                      <div className="ke-result-head">
                        <div>
                          <strong>
                            Im begrenzten Teilprofil strukturell lesbar
                          </strong>
                          <p>
                            {keReport.institutions.length} Institution(en) ·{" "}
                            {keReport.segments.length} Segmente · Herkunft nicht
                            verifiziert
                          </p>
                        </div>
                        <Status tone="amber">Keine Freigabe</Status>
                      </div>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Institution</th>
                              <th>Gültig ab</th>
                              <th>VKG-Verknüpfungen</th>
                            </tr>
                          </thead>
                          <tbody>
                            {keReport.institutions.slice(0, 10).map((r) => (
                              <tr key={r.ik}>
                                <td>
                                  <strong>{r.shortName}</strong>
                                  <small>{r.ik}</small>
                                </td>
                                <td>{date(r.validity.from)}</td>
                                <td>
                                  {r.links.map((l, i) => (
                                    <small key={i}>
                                      {l.kind}: {l.targetIk} ·{" "}
                                      {
                                        (
                                          {
                                            "01": "Kostenträger",
                                            "02": "Transport ohne Entschlüsselung",
                                            "03": "Entschlüsselung",
                                            "09": "Papier",
                                          } as Record<string, string>
                                        )[l.kind]
                                      }
                                    </small>
                                  ))}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {keReport.institutions.length > 10 && (
                        <p className="muted">
                          Die Vorschau zeigt die ersten zehn Institutionen.
                        </p>
                      )}
                      <div className="notice warning">
                        <LockKeyhole size={17} />
                        <span>
                          Ein lesbarer Text beweist weder aktuelle Gültigkeit
                          noch Vollständigkeit, Empfängerberechtigung oder ein
                          passendes Zertifikat. Eine amtliche Originaldatei
                          wurde damit nicht abgenommen.
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </Card>
              <Card
                title="Prüfverlauf"
                sub="Bereitschaftsberichte, getrennt von echten Übertragungen"
              >
                {data.dtaChecks.length ? (
                  <div className="check-history">
                    {data.dtaChecks.map((d) => (
                      <details key={d.id}>
                        <summary>
                          <div className="task-icon sand">
                            <ClipboardList size={18} />
                          </div>
                          <div>
                            <strong>
                              {data.invoices.find((i) => i.id === d.invoiceId)
                                ?.number || d.invoiceId}
                            </strong>
                            <small>
                              {timestamp(d.createdAt)} · interne Vorprüfung
                            </small>
                          </div>
                          <Status tone="red">Gesperrt</Status>
                          <ChevronDown size={17} />
                        </summary>
                        <div className="check-report">
                          {d.blockers.map((b) => (
                            <div key={b.code}>
                              <AlertTriangle size={15} />
                              <span>
                                <strong>{b.code}</strong>
                                {b.message}
                              </span>
                            </div>
                          ))}
                          <p className="muted">
                            Berichts-Hash: <code>{d.payloadHash}</code>
                          </p>
                          <button
                            className="button secondary"
                            onClick={() =>
                              downloadJson(
                                d,
                                "TaxiDTA-Bereitschaft-" + d.id + ".json",
                              )
                            }
                          >
                            <Download size={16} />
                            Prüfbericht herunterladen
                          </button>
                        </div>
                      </details>
                    ))}
                  </div>
                ) : (
                  <Empty
                    title="Noch keine Vorprüfung"
                    text="Wählen Sie eine Kassenrechnung aus. Der Bericht zeigt die konkreten Versandhindernisse."
                  />
                )}
              </Card>
            </>
          )}
          {page === "documents" && (
            <>
              <div className="two-col">
                <Card
                  title="Unveränderliche Rechnungsoriginale"
                  sub="Gespeichertes PDF mit SHA-256-Nachweis"
                >
                  <div className="document-list">
                    {data.invoices.map((i) => (
                      <a
                        key={i.id}
                        href={"/api/invoices/" + i.id + "/pdf"}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <div className="file-icon">
                          <FileText size={21} />
                        </div>
                        <div>
                          <strong>{i.number}.pdf</strong>
                          <small>
                            {i.customerSnapshot.name} · {date(i.issuedAt)}
                          </small>
                        </div>
                        <Download size={18} />
                      </a>
                    ))}
                  </div>
                </Card>
                <Card
                  title="Belegreferenzen der Krankenfahrten"
                  sub="Übersicht zur Vorbereitung einer späteren Packliste"
                >
                  <div className="document-list">
                    {medical.map((j) => (
                      <div key={j.id} className="receipt-entry">
                        <div className="file-icon">
                          <ClipboardList size={21} />
                        </div>
                        <div>
                          <strong>
                            {j.receiptNumber
                              ? "Beleg " + j.receiptNumber
                              : "Belegnummer fehlt"}
                          </strong>
                          <small>
                            {date(j.date)} · {customer(j.customerId)?.name}
                          </small>
                        </div>
                        <Status tone={j.receiptNumber ? "blue" : "amber"}>
                          {j.receiptNumber ? "Referenziert" : "Offen"}
                        </Status>
                      </div>
                    ))}
                  </div>
                  <div className="notice warning">
                    <Info size={18} />
                    <span>
                      Eine Belegreferenz bestätigt keinen Originaleingang oder
                      Postversand. Amtlicher Begleitzettel, Empfänger und
                      Packfreigabe sind noch offen.
                    </span>
                  </div>
                </Card>
              </div>
              <Card
                title="Dokumentenimport: bewusst noch geschlossen"
                sub="Private Originale bleiben außerhalb der Demo."
              >
                <div className="locked-feature">
                  <LockKeyhole size={26} />
                  <div>
                    <h3>PDF-Vorlagen, Muster 4 und Originalbelege</h3>
                    <p>
                      Ein sicherer Upload benötigt Malwareprüfung, privaten
                      Speicher, Zugriffsprüfung und Datenschutzfreigabe. Diese
                      Version bietet deshalb keinen Upload für echte Dokumente.
                    </p>
                  </div>
                  <Status tone="neutral">Nicht angebunden</Status>
                </div>
              </Card>
            </>
          )}
          {page === "reports" && (
            <>
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-label">Aktive Rechnungen</div>
                  <strong>{activeInvoices.length}</strong>
                  <small>Storni und Stornobelege ausgenommen</small>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Fakturiert brutto</div>
                  <strong>
                    {money(
                      activeInvoices.reduce((a, i) => a + i.grossCents, 0),
                    )}
                  </strong>
                  <small>Aus eingefrorenen Rechnungswerten</small>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Offene Forderung</div>
                  <strong>{money(totalOpen)}</strong>
                  <small>Rechnungssummen abzüglich Zahlungen</small>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Fahrtleistung gesamt</div>
                  <strong>
                    {data.journeys
                      .reduce((a, j) => a + Number(j.km.replace(",", ".")), 0)
                      .toLocaleString("de-DE")}
                    <span> km</span>
                  </strong>
                  <small>Bestätigte Eingabewerte · keine GPS-Messung</small>
                </div>
              </div>
              <div className="two-col">
                <Card
                  title="Umsatzsteuer nach Satz"
                  sub="Aktive Rechnungen · aus eingefrorenen Positionen"
                >
                  <div className="tax-report">
                    {[7, 19].map((r) => {
                      const lines = activeInvoices
                        .flatMap((i) => i.lines)
                        .filter((l) => l.taxRate === r);
                      return (
                        <div key={r}>
                          <strong>{r} %</strong>
                          <dl>
                            <div>
                              <dt>Netto</dt>
                              <dd>
                                {money(
                                  lines.reduce((a, l) => a + l.netCents, 0),
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt>Umsatzsteuer</dt>
                              <dd>
                                {money(
                                  lines.reduce((a, l) => a + l.taxCents, 0),
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt>Brutto</dt>
                              <dd>
                                {money(
                                  lines.reduce((a, l) => a + l.grossCents, 0),
                                )}
                              </dd>
                            </div>
                          </dl>
                        </div>
                      );
                    })}
                  </div>
                </Card>
                <Card
                  title="Forderungen nach Kunde"
                  sub="Nur tatsächlich erfasste Zahlungen berücksichtigt"
                >
                  <div className="kind-bars">
                    {data.customers.map((c) => {
                      const sum = activeInvoices
                        .filter((i) => i.customerId === c.id)
                        .reduce((a, i) => a + outstanding(i), 0);
                      return sum > 0 ? (
                        <div key={c.id}>
                          <div>
                            <span>{c.name}</span>
                            <b>{money(sum)}</b>
                          </div>
                          <div className="bar-track">
                            <span
                              style={{
                                width:
                                  (sum / Math.max(totalOpen, 1)) * 100 + "%",
                              }}
                            />
                          </div>
                        </div>
                      ) : null;
                    })}
                  </div>
                </Card>
              </div>
              <Card
                title="Portabler Export"
                sub="Für die Prüfung im Tabellenprogramm"
              >
                <div className="locked-feature">
                  <Download size={25} />
                  <div>
                    <h3>Rechnungsübersicht als CSV</h3>
                    <p>
                      UTF-8, deutsche Trennzeichen und Schutz vor
                      Tabellenformeln. Dieser Export ist kein validierter DATEV-
                      oder E-Rechnungsexport.
                    </p>
                  </div>
                  <a
                    className="button secondary"
                    href="/api/export.csv"
                    download
                  >
                    <Download size={16} />
                    CSV herunterladen
                  </a>
                </div>
              </Card>
            </>
          )}
          {page === "settings" && (
            <>
              {(!privateSite ||
                data.deployment?.financialStorage === "cloud-supabase") && (
                <SetupPanel
                  onAuthenticated={() => {
                    void refresh().catch((e) => setLoadError(message(e)));
                  }}
                  onSignedOut={() => {
                    void refresh().catch((e) => setLoadError(message(e)));
                  }}
                />
              )}
              <div className="notice">
                <ShieldCheck size={21} />
                <div>
                  <strong>
                    {privateSite
                      ? "Du arbeitest in einer privaten Testwebsite."
                      : "Sie arbeiten in einer lokalen Testumgebung."}
                  </strong>
                  <p>
                    {privateSite
                      ? "Der Zugang ist privat. Die Testdaten werden auf dem Server gespeichert und stehen nach einem erneuten Öffnen wieder bereit."
                      : "Lokale Testanwendung mit optionaler oder verpflichtender Inhaber-Anmeldung gemäß Einrichtung."}{" "}
                    Keine echten Gesundheits-, Bank- oder Zertifikatsdaten
                    eingeben. Diese Testversion ist nicht für echte Abrechnungen
                    freigegeben.
                  </p>
                </div>
              </div>
              <div className="two-col">
                <Card
                  title="Betriebs- und Sicherheitsstatus"
                  sub="Nur nachweisbare Eigenschaften werden als aktiv gezeigt"
                >
                  <div className="control-list">
                    {[
                      [
                        privateSite
                          ? "Private Cloudspeicherung"
                          : "Lokale Speicherung",
                        privateSite
                          ? "Synthetische Fälle und Rechnungen im privaten Testzugang gespeichert."
                          : "Testdaten bleiben auf diesem Rechner.",
                        "Aktiv",
                        true,
                      ],
                      [
                        "DTA-Produktivtransport",
                        "Keine Versandadapter und keine externen Empfänger.",
                        "Gesperrt",
                        true,
                      ],
                      [
                        "Rechnungsoriginale",
                        "Eingefrorene PDF-Bytes und SHA-256-Prüfsumme.",
                        "Aktiv",
                        true,
                      ],
                      [
                        "CSRF & Eingabeprüfung",
                        "Schreibzugriffe mit Token und serverseitigen Schemas.",
                        "Aktiv",
                        true,
                      ],
                      [
                        privateSite
                          ? "Privater Website-Zugang"
                          : "Authenticator",
                        privateSite
                          ? "Der private Zugang wird vor der Verwendung der Website geprüft. Eine Freigabe für Gesundheitsdaten folgt daraus nicht."
                          : "Supabase-TOTP im Einrichtungsbereich; persönlicher Abschlusstest erforderlich.",
                        privateSite ? "Privat" : "Einrichten",
                        privateSite,
                      ],
                      [
                        privateSite
                          ? "Datenschutz vor Echtdaten"
                          : "Supabase Frankfurt",
                        privateSite
                          ? "Standort, Wiederherstellung, Auftragsverarbeitung und alle Datenflüsse müssen vor Echtdaten freigegeben werden."
                          : "Einrichtung und Region im Bereich Supabase prüfen. Finanzdaten bleiben lokal.",
                        "Offen",
                        false,
                      ],
                      [
                        "Datenschutz & Sicherheitsreview",
                        "Vor echten Daten gesondert fachkundig prüfen.",
                        "Offen",
                        false,
                      ],
                    ].map(([a, b, c, good]) => (
                      <div key={String(a)}>
                        {good ? (
                          <ShieldCheck size={18} />
                        ) : (
                          <Clock3 size={18} />
                        )}
                        <div>
                          <strong>{a}</strong>
                          <small>{b}</small>
                        </div>
                        <Status tone={good ? "green" : "amber"}>{c}</Status>
                      </div>
                    ))}
                  </div>
                </Card>
                <div>
                  <Card
                    title="Sicherung & Wiederherstellung"
                    sub="Verschlüsseln und Restore wirklich prüfen"
                  >
                    <div className="form-body">
                      {privateSite ? (
                        <p>
                          Für diese private Testwebsite ist noch kein
                          vollständiger Wiederherstellungsnachweis abgenommen.
                          Der CSV-Export ist eine Rechnungsübersicht und ersetzt
                          keine vollständige Sicherung aller Fälle und
                          Originale.
                        </p>
                      ) : (
                        <>
                          <p>
                            Die lokale Datenbank bleibt in Ihrem Projektordner.
                            Für eine verschlüsselte Sicherung im Terminal:
                          </p>
                          <code className="command-line">npm run backup</code>
                          <p>
                            Die Sicherung auf Integrität und
                            Wiederherstellbarkeit prüfen:
                          </p>
                          <code className="command-line">
                            npm run restore:test -- work/backups/datei.tdbak
                          </code>
                        </>
                      )}
                      <div className="notice warning">
                        <Info size={16} />
                        <span>
                          Ein Backup gilt erst nach bestandenem Restore-Test als
                          geprüft. Die App bestätigt keinen automatischen
                          Sicherungslauf.
                        </span>
                      </div>
                    </div>
                  </Card>
                  <Card title="Darstellung">
                    <div className="setting-row">
                      <span>
                        {dark
                          ? "Dunkles Design ist aktiv"
                          : "Helles Design ist aktiv"}
                      </span>
                      <button
                        className="button secondary"
                        onClick={() => setDark(!dark)}
                      >
                        {dark ? <Sun size={17} /> : <Moon size={17} />}Wechseln
                      </button>
                    </div>
                    <div className="setting-row">
                      <span>Schnellnavigation</span>
                      <kbd>⌘ / Strg + K</kbd>
                    </div>
                  </Card>
                </div>
              </div>
              <Card
                title="Änderungsjournal"
                sub="Verkettete Hashes unterstützen die Integritätsprüfung; kein extern versiegeltes Archiv."
              >
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Ereignis</th>
                        <th>Zeit (Berlin)</th>
                        <th>Objekt</th>
                        <th>Hash</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.audit.slice(0, 30).map((a) => (
                        <tr key={a.id}>
                          <td>{a.action.replaceAll("_", " ")}</td>
                          <td>{timestamp(a.at)}</td>
                          <td>
                            <code>{a.entityId.slice(0, 12)}</code>
                          </td>
                          <td>
                            <code>{a.hash.slice(0, 20)}…</code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
          <footer className="footer">
            <span>
              <span className="tiny-dot green-dot" />
              TaxiDTA {data.version} ·{" "}
              {privateSite ? "Privat gespeichert" : "Lokal gespeichert"}
            </span>
            <span>Testbetrieb · Keine echten Daten · Keine DTA-Freigabe</span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCheck size={19} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Meldung schließen"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {palette && (
        <Modal
          title="Schnell zu …"
          sub="Bereiche finden und Aktionen direkt starten."
          onClose={() => setPalette(false)}
        >
          <div className="palette-content">
            <div className="search-field">
              <Search size={19} />
              <input
                autoFocus
                aria-label="Navigation durchsuchen"
                placeholder="z. B. Rechnung, Fahrt oder Tarif …"
                value={paletteQuery}
                onChange={(e) => setPaletteQuery(e.target.value)}
              />
              <kbd>ESC</kbd>
            </div>
            <div className="palette-results">
              {[
                {
                  id: "new-case",
                  label: "Neue Abrechnung starten",
                  icon: ClipboardList,
                },
                {
                  id: "new-invoice",
                  label: "Neue Rechnung erstellen",
                  icon: Plus,
                },
                ...nav,
              ]
                .filter((n) =>
                  n.label.toLowerCase().includes(paletteQuery.toLowerCase()),
                )
                .map((n) => (
                  <button
                    key={n.id}
                    onClick={() => {
                      setPalette(false);
                      if (n.id === "new-case") newBillingCase();
                      else if (n.id === "new-invoice") openDialog("invoice");
                      else setPage(n.id as Page);
                    }}
                  >
                    <n.icon size={19} />
                    {n.label}
                    <ArrowUpRight size={15} />
                  </button>
                ))}
            </div>
          </div>
        </Modal>
      )}
      {dialog === "customer" && (
        <Modal
          title="Neuer Testkunde"
          sub="Für den Anfang reichen Name und Rechnungsanschrift."
          onClose={closeDialog}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await mutate("/customers", customerForm, "Kunde gespeichert.")
              )
                closeDialog();
            }}
          >
            <div className="form-body">
              {formError}
              <Field label="Kundenart">
                <select
                  value={customerForm.kind}
                  onChange={(e) =>
                    setCustomerForm((f) => ({
                      ...f,
                      kind: e.target.value as CustomerKind,
                    }))
                  }
                >
                  {Object.entries(customerLabels).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Name / Firmenbezeichnung">
                <input
                  required
                  maxLength={160}
                  value={customerForm.name}
                  placeholder="z. B. Beispielkunde"
                  onChange={(e) =>
                    setCustomerForm((f) => ({ ...f, name: e.target.value }))
                  }
                />
              </Field>
              <Field label="Rechnungsanschrift">
                <textarea
                  required
                  rows={3}
                  maxLength={500}
                  value={customerForm.address}
                  placeholder={"Musterstraße 10\n12345 Beispielstadt"}
                  onChange={(e) =>
                    setCustomerForm((f) => ({ ...f, address: e.target.value }))
                  }
                />
              </Field>
              <Field label="Referenz / Kostenstelle (optional)">
                <input
                  value={customerForm.reference}
                  maxLength={100}
                  onChange={(e) =>
                    setCustomerForm((f) => ({
                      ...f,
                      reference: e.target.value,
                    }))
                  }
                />
              </Field>
              <div className="notice">
                <Info size={17} />
                Bitte ausschließlich erfundene Daten eingeben.
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="button secondary"
                onClick={closeDialog}
              >
                Abbrechen
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? "Speichert …" : "Kunde speichern"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {dialog === "invoice" && (
        <Modal
          title="Neue Rechnung vorbereiten"
          sub="Eine oder mehrere gespeicherte Fahrten desselben Kunden auswählen."
          onClose={closeDialog}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await mutate(
                "/invoices",
                { journeyIds, issuedAt },
                "Rechnung erstellt und Original-PDF archiviert.",
              );
              if (result) {
                setSelectedInvoice(result.id || result.invoice?.id);
                setPage("invoices");
                closeDialog();
              }
            }}
          >
            <div className="form-body">
              {formError}
              <div className="form-grid">
                <Field label="Kunde / Rechnungsempfänger">
                  <select
                    required
                    value={invoiceCustomer}
                    onChange={(e) => {
                      setInvoiceCustomer(e.target.value);
                      setJourneyIds([]);
                    }}
                  >
                    <option value="">Bitte wählen …</option>
                    {data.customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Rechnungsdatum">
                  <input
                    type="date"
                    required
                    value={issuedAt}
                    onChange={(e) => setIssuedAt(e.target.value)}
                  />
                </Field>
              </div>
              {invoiceCustomer && (
                <>
                  <div className="selection-heading">
                    <strong>Abrechenbare Fahrten ({available.length})</strong>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        setJourneyIds(
                          journeyIds.length === available.length
                            ? []
                            : available.map((j) => j.id),
                        )
                      }
                    >
                      {journeyIds.length === available.length
                        ? "Auswahl aufheben"
                        : "Alle auswählen"}
                    </button>
                  </div>
                  <div className="journey-selection">
                    {available.map((j) => (
                      <label key={j.id}>
                        <input
                          type="checkbox"
                          checked={journeyIds.includes(j.id)}
                          onChange={(e) =>
                            setJourneyIds((ids) =>
                              e.target.checked
                                ? [...ids, j.id]
                                : ids.filter((id) => id !== j.id),
                            )
                          }
                        />
                        <div>
                          <strong>{j.description}</strong>
                          <small>
                            {date(j.date)} · {j.from} → {j.to}
                          </small>
                        </div>
                        <b>{money(j.grossCents)}</b>
                      </label>
                    ))}
                    {!available.length && (
                      <Empty
                        title="Keine offenen Fahrten"
                        text="Für diesen Kontakt sind keine offenen Leistungen gespeichert. Krankenfahrten werden im Abrechnungsfall erfasst; bereits abgerechnete Leistungen bleiben gesperrt."
                      />
                    )}
                  </div>
                </>
              )}
              <div className="invoice-preview-summary">
                <div>
                  <span>
                    {selectedJourneys.length} Fahrt
                    {selectedJourneys.length === 1 ? "" : "en"} ausgewählt
                  </span>
                  <strong>
                    {money(
                      selectedJourneys.reduce((a, j) => a + j.grossCents, 0),
                    )}
                  </strong>
                </div>
                <small>
                  {selectedJourneys.some((j) => j.kind === "medical")
                    ? "Demo-Wiedervorlage, Kassenfrist ungeprüft:"
                    : "Fällig am"}{" "}
                  {(() => {
                    try {
                      return date(addCalendarDays(issuedAt, 28));
                    } catch {
                      return "—";
                    }
                  })()}{" "}
                  · 28 Kalendertage
                </small>
              </div>
              <div className="notice">
                <LockKeyhole size={17} />
                <span>
                  Mit der Erstellung werden Nummer, Positionen, Steuer und
                  Original-PDF eingefroren. Änderungen erfolgen anschließend
                  über einen Stornobeleg.
                </span>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="button secondary"
                onClick={closeDialog}
              >
                Abbrechen
              </button>
              <button
                className="button primary"
                disabled={!journeyIds.length || busy}
              >
                {busy ? "Erstellt …" : "Testrechnung verbindlich erstellen"}
                <ArrowRight size={16} />
              </button>
            </div>
          </form>
        </Modal>
      )}
      {dialog === "payment" && currentInvoice && (
        <Modal
          title="Zahlung erfassen"
          sub={
            currentInvoice.number +
            " · " +
            money(outstanding(currentInvoice)) +
            " offen"
          }
          onClose={closeDialog}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              let amountCents: number;
              try {
                amountCents = parseMoney(paymentForm.amount);
              } catch (e) {
                setError(message(e));
                return;
              }
              if (
                await mutate(
                  "/invoices/" + currentInvoice.id + "/payments",
                  {
                    amountCents,
                    date: paymentForm.date,
                    note: paymentForm.note,
                  },
                  "Zahlung erfasst und Forderung aktualisiert.",
                )
              )
                closeDialog();
            }}
          >
            <div className="form-body">
              {formError}
              <div className="form-grid">
                <Field label="Tatsächlich eingegangener Betrag (€)">
                  <input
                    required
                    inputMode="decimal"
                    value={paymentForm.amount}
                    onChange={(e) =>
                      setPaymentForm((f) => ({ ...f, amount: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Zahlungsdatum">
                  <input
                    required
                    type="date"
                    value={paymentForm.date}
                    onChange={(e) =>
                      setPaymentForm((f) => ({ ...f, date: e.target.value }))
                    }
                  />
                </Field>
              </div>
              <Field label="Nachweis / Notiz">
                <input
                  maxLength={240}
                  placeholder="z. B. Test-Kontoauszug vom …"
                  value={paymentForm.note}
                  onChange={(e) =>
                    setPaymentForm((f) => ({ ...f, note: e.target.value }))
                  }
                />
              </Field>
              <div className="notice">
                <Info size={18} />
                <span>
                  Nur einen tatsächlich bestätigten Zahlungseingang erfassen.
                  Teilzahlungen sind möglich; eine Bankanbindung besteht nicht.
                </span>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="button secondary"
                onClick={closeDialog}
              >
                Abbrechen
              </button>
              <button className="button primary" disabled={busy}>
                Zahlung bestätigen
              </button>
            </div>
          </form>
        </Modal>
      )}
      {dialog === "cancel" && currentInvoice && (
        <Modal
          title="Rechnung stornieren"
          sub={currentInvoice.number + " bleibt mit dem Original-PDF erhalten."}
          onClose={closeDialog}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await mutate(
                  "/invoices/" + currentInvoice.id + "/cancel",
                  { reason: cancelReason },
                  "Stornobeleg erstellt. Die Originalrechnung bleibt erhalten.",
                )
              )
                closeDialog();
            }}
          >
            <div className="form-body">
              {formError}
              <div className="notice warning">
                <AlertTriangle size={18} />
                <span>
                  Es wird ein neuer, verknüpfter Stornobeleg mit negativen
                  Beträgen erstellt. Die Nummer wird nicht wiederverwendet.
                  Fahrten bleiben gegen erneute Abrechnung gesperrt.
                </span>
              </div>
              <Field label="Nachvollziehbarer Stornogrund">
                <textarea
                  required
                  minLength={5}
                  maxLength={500}
                  rows={3}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                />
              </Field>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="button secondary"
                onClick={closeDialog}
              >
                Abbrechen
              </button>
              <button className="button danger-button" disabled={busy}>
                Storno bestätigen
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
