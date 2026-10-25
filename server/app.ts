import {
  readConfiguration,
  createGuardedSupabaseFetch,
  type AppConfig,
} from "./config.js";
import {
  createSetupService,
  installSetupRoutes,
  authSessionId,
} from "./setup-routes.js";
import { AuthError, type SupabaseAuthService } from "./supabase-auth.js";
import { SupabaseDataError, SupabaseDataClient } from "./supabase-data.js";
import express, { type ErrorRequestHandler } from "express";
import { z } from "zod";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { Store, ApiError } from "./store.js";
import { calculateTariff } from "../src/domain/index.js";
import { csvCell } from "./export.js";
import {buildUnsentDtaStatus} from '../src/domain/dta/status.js';
import { billingCaseRequestSchema } from './billing-case.js';
import { searchPayers, resolvePayer, payerRegistrySummary, PayerRegistryError } from './payers.js';
const date = z
  .string()
  .regex(
    /^2026-\d{2}-\d{2}$/,
    "Diese geprüfte Demoversion unterstützt nur Leistungs-/Rechnungsdaten 2026.",
  )
  .refine((s) => {
    const d = new Date(`${s}T12:00:00Z`);
    return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === s;
  }, "Ungültiges Kalenderdatum.");
const text = (max: number) =>
  z.string().trim().min(1, "Dieses Feld darf nicht leer sein.").max(max);
const id = z.string().uuid();
const customerSchema = z
  .object({
    name: text(160),
    kind: z.enum(["private", "business", "laboratory", "payer"]),
    address: text(600),
    reference: z.string().trim().max(100).optional(),
  })
  .strict();
const journeySchema = z
  .object({
    customerId: id,
    kind: z.enum(["taxi", "medical", "courier", "laboratory"]),
    date,
    from: text(200),
    to: text(200),
    km: z
      .string()
      .regex(
        /^\d{1,4}(?:[.,]\d{1,2})?$/,
        "Kilometer bitte mit höchstens zwei Nachkommastellen eingeben.",
      )
      .refine(
        (v) =>
          Number(v.replace(",", ".")) > 0 &&
          Number(v.replace(",", ".")) <= 2000,
        "Kilometer müssen größer als 0 und höchstens 2.000 sein.",
      ),
    vehicle: z.enum(["taxi", "rental"]),
    sameMunicipality: z.boolean().nullable(),
    grossCents: z.number().int().min(1).max(100_000_000),
    description: text(500).refine(
      (value) => value.split(/\r\n|[\r\n\u2028\u2029]/u).length <= 20,
      "Leistungsbeschreibung darf höchstens 20 Zeilen enthalten. Bitte zusätzliche Details getrennt dokumentieren.",
    ),
    tariff: z.enum(["I", "II"]).nullable(),
    contractConfirmed: z.boolean(),
    prescriptionConfirmed: z.boolean(),
    receiptNumber: z.string().trim().min(1).max(50).nullable(),
  })
  .strict();
const invoiceSchema = z
  .object({ journeyIds: z.array(id).min(1).max(500), issuedAt: date })
  .strict();
const paymentSchema = z
  .object({
    amountCents: z.number().int().min(1).max(100_000_000),
    date,
    note: z.string().trim().max(200).default(""),
  })
  .strict();
const cancelSchema = z.object({ reason: text(500) }).strict();
const tariffSchema = z
  .object({
    article: z.enum(["I", "II"]),
    km: z.string().max(20),
    date,
    persons: z.number().int().min(1).max(8),
    contractConfirmed: z.boolean(),
    approachKm: z.string().max(20).optional(),
    approachEligible: z.boolean().optional(),
    tunnelCrossings: z.number().int().min(0).max(100).optional(),
    tunnelConfirmed: z.boolean().optional(),
  })
  .strict();
function parseCommandKey(value: string | undefined) {
  if (value && !/^[a-zA-Z0-9_-]{8,100}$/.test(value))
    throw new ApiError(422, "Ungültige Vorgangskennung.");
  return value;
}
export interface AppOptions {
  store?: Store;
  seed?: boolean;
  frontend?: boolean;
  production?: boolean;
  config?: AppConfig;
  authService?: SupabaseAuthService;
  setupData?: Pick<SupabaseDataClient, "inspect">;
}
export async function createApp(options: AppOptions = {}) {
  if (process.env.TAXIDTA_MODE && process.env.TAXIDTA_MODE !== "demo")
    throw new Error(
      "Diese Version ist ausschließlich für lokale synthetische Demo-Daten freigegeben.",
    );
  const store =
    options.store ??
    new Store(process.env.TAXIDTA_DB_PATH || "work/taxidta.sqlite");
  if (options.seed) await store.seed();
  const config = options.config ?? readConfiguration();
  const authService = options.authService ?? createSetupService(config);
  const setupData =
    options.setupData ??
    (config.supabase
      ? new SupabaseDataClient(
          config.supabase,
          createGuardedSupabaseFetch(config.supabase.url),
        )
      : null);
  const app = express();
  app.locals.authService = authService;
  app.disable("x-powered-by");
  app.set("case sensitive routing", true);
  app.locals.store = store;
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'",
    );
    res.setHeader("Cache-Control", "no-store");
    const raw = req.headers.host ?? "";
    let hostname = "";
    try {
      hostname = new URL(`http://${raw}`).hostname;
    } catch {
      /* rejected below */
    }
    if (!["127.0.0.1", "localhost", "[::1]"].includes(hostname))
      return res
        .status(403)
        .json({ error: "Zugriff nur über die lokale Demo-Adresse erlaubt." });
    const origin = req.get("origin");
    if (origin && origin !== `http://${raw}`)
      return res
        .status(403)
        .json({ error: "Fremde Web-Origin ist für die lokale Demo gesperrt." });
    if (req.get("sec-fetch-site") === "cross-site")
      return res
        .status(403)
        .json({ error: "Seitenübergreifender Zugriff gesperrt." });
    if (
      req.path.startsWith("/api/") &&
      !["GET", "HEAD", "OPTIONS"].includes(req.method)
    ) {
      const authRoute =
        req.path.startsWith("/api/auth/") || req.path.startsWith("/api/setup/");
      if (
        !authRoute &&
        !(config.authRequired
          ? authService.csrfMatches(
              authSessionId(req) ?? "",
              req.get("x-csrf-token") ?? "",
            )
          : store.csrfMatches(req.get("x-csrf-token") ?? ""))
      )
        return res
          .status(403)
          .json({
            error: "Sicherheitsprüfung fehlgeschlagen. Bitte Seite neu laden.",
            ...(config.authRequired ? { code: "AUTH_CSRF_INVALID" } : {}),
          });
      if (!req.is("application/json"))
        return res.status(415).json({ error: "JSON-Daten erforderlich." });
    }
    next();
  });
  app.use(express.json({ limit: "150kb", strict: true }));
  installSetupRoutes(app, config, authService);
  app.use("/api", async (req, res, next) => {
    try {
      if (
        !config.authRequired ||
        req.path === "/health" ||
        req.path.startsWith("/auth/") ||
        req.path.startsWith("/setup/")
      )
        return next();
      const sessionId = authSessionId(req) ?? "";
      const context = await authService.requireMfa(sessionId);
      if (!setupData)
        throw new AuthError(
          503,
          "AUTH_DATABASE_UNAVAILABLE",
          "Die Inhaberbindung konnte nicht in der Datenbank geprüft werden.",
        );
      await setupData.inspect(context.accessToken);
      authService.assertSessionActive(sessionId);
      res.locals.authCsrf = context.csrfToken;
      next();
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/health", (_req, res) => {
    const integrity = store.verifyAudit();
    res
      .status(integrity ? 200 : 503)
      .json({
        status: integrity ? "ok" : "degraded",
        mode: "demo",
        liveTransmission: false,
        auditIntegrity: integrity,
        version: "0.1.0",
      });
  });
  app.get("/api/state", (_req, res) =>
    res.json({
      ...store.state(),
      csrfToken: config.authRequired ? res.locals.authCsrf : store.csrfToken,
    }),
  );
  app.get('/api/payers', (req,res)=>{
    const query=z.object({q:z.string().max(200).optional(),limit:z.coerce.number().int().min(1).max(200).optional()}).strict().parse(req.query);
    res.json(searchPayers(query.q??'',query.limit??20));
  });
  app.get('/api/payers/summary', (_req,res)=>res.json(payerRegistrySummary()));
  app.get('/api/payers/:id', (req,res)=>res.json(resolvePayer(z.string().max(160).parse(req.params.id))));
  app.post('/api/billing-cases', (req,res)=>{
    const {payerId,...body}=billingCaseRequestSchema.parse(req.body);
    res.status(201).json(store.addBillingCase({...body,payer:resolvePayer(payerId)},parseCommandKey(req.get('idempotency-key'))));
  });
  app.post('/api/billing-cases/:id/update', (req,res)=>{
    const {payerId,...body}=billingCaseRequestSchema.parse(req.body);
    res.json(store.updateBillingCase(id.parse(req.params.id),{...body,payer:resolvePayer(payerId)}));
  });
  app.post('/api/invoices/from-cases',async(req,res)=>{
    const body=z.object({caseIds:z.array(id).min(1).max(500),issuedAt:date}).strict().parse(req.body);
    res.status(201).json(await store.issueCaseInvoice(body.caseIds,body.issuedAt,parseCommandKey(req.get('idempotency-key'))));
  });
  app.post("/api/customers", (req, res) =>
    res.status(201).json(store.addCustomer(customerSchema.parse(req.body))),
  );
  app.post("/api/journeys", (req, res) =>
    res.status(201).json(store.addJourney(journeySchema.parse(req.body))),
  );
  app.post("/api/journeys/:id/update", (req, res) =>
    res.json(
      store.updateJourney(
        id.parse(req.params.id),
        journeySchema.parse(req.body),
      ),
    ),
  );
  app.post("/api/tariff", (req, res) =>
    res.json(calculateTariff(tariffSchema.parse(req.body))),
  );
  app.post("/api/invoices", async (req, res) => {
    const body = invoiceSchema.parse(req.body);
    const commandKey = parseCommandKey(req.get("idempotency-key"));
    res
      .status(201)
      .json(
        await store.issueInvoice(body.journeyIds, body.issuedAt, commandKey),
      );
  });
  app.post("/api/invoices/:id/payments", (req, res) =>
    res
      .status(201)
      .json(
        store.addPayment(
          id.parse(req.params.id),
          paymentSchema.parse(req.body),
          parseCommandKey(req.get("idempotency-key")),
        ),
      ),
  );
  app.post("/api/invoices/:id/cancel", async (req, res) =>
    res
      .status(201)
      .json(
        await store.cancelInvoice(
          id.parse(req.params.id),
          cancelSchema.parse(req.body).reason,
        ),
      ),
  );
  app.get("/api/invoices/:id/pdf", (req, res) => {
    const invoice = store.invoice(id.parse(req.params.id));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${invoice.number}.pdf"`,
    );
    res.setHeader("ETag", `"${invoice.pdfHash}"`);
    res.send(store.pdf(invoice.id));
  });
  app.post("/api/invoices/:id/dta-check", (req, res) =>
    res.status(201).json(store.dtaCheck(id.parse(req.params.id))),
  );
  app.get('/api/invoices/:id/dta-status',(req,res)=>{
    const invoice=store.invoice(id.parse(req.params.id));
    const readiness=store.state().dtaChecks.find(check=>check.invoiceId===invoice.id)??null;
    res.json(buildUnsentDtaStatus(invoice,readiness));
  });
  app.get("/api/invoices/:id/dta-check/report", (req, res) => {
    const invoiceId = id.parse(req.params.id);
    store.invoice(invoiceId);
    const check = store
      .state()
      .dtaChecks.find((c) => c.invoiceId === invoiceId);
    if (!check)
      throw new ApiError(
        404,
        "Bitte zuerst eine DTA-Bereitschaftsprüfung ausführen.",
      );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="taxidta-bereitschaft-${invoiceId}.json"`,
    );
    res.json({
      notice:
        "Dies ist ausschließlich ein Bereitschaftsbericht und keine §302-Nutzdatei oder Empfangsquittung.",
      ...check,
    });
  });
  app.get("/api/export.csv", (_req, res) => {
    const rows = [
      [
        "Test-Rechnungsnummer",
        "Datum",
        "Faellig",
        "Brutto_Cent",
        "Netto_Cent",
        "USt_Cent",
        "Bezahlt_Cent",
        "Status",
        "PDF_SHA256",
        "Frist_geprueft",
        "Frist_Hinweis",
      ],
      ...store
        .invoices()
        .map((i) => [
          i.number,
          i.issuedAt,
          i.dueAt,
          i.grossCents,
          i.netCents,
          i.taxCents,
          i.payments.reduce((s, p) => s + p.amountCents, 0),
          i.status,
          i.pdfHash,
          i.dueAtVerified === false ? "nein" : "ja",
          i.dueAtBasis ?? "Historische Demo-Frist; Vertragsgrundlage prüfen",
        ]),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="taxidta-demo-rechnungen.csv"',
    );
    res.send("\uFEFF" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n"));
  });
  app.all("/api/{*path}", (_req, res) =>
    res
      .status(404)
      .json({
        error:
          "API-Funktion nicht vorhanden. Produktivversand ist nicht implementiert.",
      }),
  );
  if (options.frontend) {
    if (options.production) {
      const dir = resolve("dist");
      if (!existsSync(resolve(dir, "index.html")))
        throw new Error(
          "Frontend fehlt. Bitte zuerst npm run build ausführen.",
        );
      app.use(express.static(dir, { index: false, etag: false }));
      app.get("/{*path}", (_req, res) =>
        res.sendFile(resolve(dir, "index.html")),
      );
    } else {
      const { createServer } = await import("vite");
      const vite = await createServer({
        server: {
          middlewareMode: true,
          hmr: { host: "127.0.0.1" },
          fs: {
            strict: true,
            allow: [resolve(".")],
            deny: [
              "**/.git/**",
              "**/.env*",
              "**/*.{crt,pem,key,p12,pfx}",
              "**/work/**",
              "**/private-source-docs/**",
              "**/*.{sqlite,sqlite-shm,sqlite-wal,db,db-shm,db-wal}",
            ],
          },
        },
        appType: "spa",
      });
      app.locals.vite = vite;
      app.use(vite.middlewares);
    }
  }
  const errors: ErrorRequestHandler = (err, _req, res, _next) => {
    if(err instanceof PayerRegistryError){res.status(err.status).json({error:err.message,code:err.code});return;}
    if (err instanceof z.ZodError) {
      res
        .status(422)
        .json({
          error: err.issues
            .map((i) => `${i.path.join(".") || "Eingabe"}: ${i.message}`)
            .join(" "),
        });
      return;
    }
    if (err instanceof AuthError || err instanceof SupabaseDataError) {
      const cleanupWarning =
        err instanceof SupabaseDataError &&
        err.cleanupAttempted &&
        !err.cleanupVerified
          ? " Die Entfernung des synthetischen Prüfeintrags ist nicht bestätigt."
          : "";
      res
        .status(err.status)
        .json({ error: err.message + cleanupWarning, code: err.code });
      return;
    }
    if (err instanceof ApiError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof Error && err.name === "DomainError") {
      res.status(422).json({ error: err.message });
      return;
    }
    if (err instanceof SyntaxError && "body" in err) {
      res
        .status(400)
        .json({ error: "Die übermittelten JSON-Daten sind ungültig." });
      return;
    }
    if (
      err &&
      typeof err === "object" &&
      "type" in err &&
      err.type === "entity.too.large"
    ) {
      res.status(413).json({ error: "Die Eingabe ist zu groß." });
      return;
    }
    // Do not emit patient/customer payloads, SQL values or unfiltered exception details.
    res
      .status(500)
      .json({
        error:
          "Der Vorgang konnte nicht gespeichert werden. Bitte Eingaben prüfen und erneut versuchen.",
      });
  };
  app.use(errors);
  return app;
}
