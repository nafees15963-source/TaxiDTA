import type { Express, Request, Response } from "express";
import { z } from "zod";
import QRCode from "qrcode";
import {
  AppConfig,
  createGuardedSupabaseFetch,
  publicConfiguration,
} from "./config.js";
import {
  SupabaseAuthService,
  AuthError,
  type AuthEnvelope,
} from "./supabase-auth.js";
import { createSupabaseProviderFactory } from "./supabase-provider.js";
import { SupabaseDataClient } from "./supabase-data.js";
const cookieName = "taxidta_session";
export function authSessionId(req: Request) {
  const raw = req.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(cookieName + "="))
    ?.slice(cookieName.length + 1);
  return raw && /^[A-Za-z0-9_-]{32,128}$/.test(raw) ? raw : undefined;
}
function sendCookie(res: Response, id: string) {
  res.cookie(cookieName, id, {
    httpOnly: true,
    sameSite: "strict",
    secure: false,
    path: "/",
    maxAge: 30 * 60 * 1000,
  });
}
function publicAuth(res: Response, envelope: AuthEnvelope) {
  sendCookie(res, envelope.sessionId);
  return { auth: envelope.state };
}
export function createSetupService(config: AppConfig) {
  return new SupabaseAuthService({
    ownerId: config.supabase?.ownerId ?? null,
    createProvider: config.supabase
      ? createSupabaseProviderFactory(
          config.supabase,
          createGuardedSupabaseFetch(config.supabase.url),
        )
      : () => {
          throw new AuthError(
            503,
            "SUPABASE_NOT_CONFIGURED",
            "Supabase ist noch nicht eingerichtet.",
          );
        },
  });
}
export function installSetupRoutes(
  app: Express,
  config: AppConfig,
  service: SupabaseAuthService,
) {
  const data = config.supabase
    ? new SupabaseDataClient(
        config.supabase,
        createGuardedSupabaseFetch(config.supabase.url),
      )
    : null;
  const requireCsrf = (req: Request) => {
    const id = authSessionId(req);
    if (!id || !service.csrfMatches(id, req.get("x-csrf-token") || ""))
      throw new AuthError(
        403,
        "AUTH_CSRF_INVALID",
        "Sicherheitsprüfung fehlgeschlagen. Bitte die Einrichtung neu laden.",
      );
    return id;
  };
  app.get("/api/setup/status", (req, res) => {
    const envelope = service.bootstrap(authSessionId(req));
    sendCookie(res, envelope.sessionId);
    res.json({ ...publicConfiguration(config), auth: envelope.state });
  });
  app.post("/api/auth/login", async (req, res) => {
    const id = requireCsrf(req);
    const body = z
      .object({
        email: z.string().email().max(254),
        password: z.string().min(1).max(1024),
      })
      .strict()
      .parse(req.body);
    res.json(
      publicAuth(res, await service.login(id, body.email, body.password)),
    );
  });
  app.post("/api/auth/enroll", async (req, res) => {
    const id = requireCsrf(req);
    z.object({}).strict().parse(req.body);
    const envelope = await service.enroll(id);
    const qrDataUrl = await QRCode.toDataURL(envelope.uri, {
      width: 240,
      margin: 2,
      errorCorrectionLevel: "M",
    });
    service.assertSessionActive(envelope.sessionId);
    res.json({
      ...publicAuth(res, envelope),
      enrollment: {
        factorId: envelope.factorId,
        qrDataUrl,
        secret: envelope.secret,
      },
    });
  });
  app.post("/api/auth/verify", async (req, res) => {
    const id = requireCsrf(req);
    const body = z
      .object({
        factorId: z.string().uuid(),
        code: z
          .string()
          .regex(
            /^\d{6}$/,
            "Bitte einen sechsstelligen Authenticator-Code eingeben.",
          ),
      })
      .strict()
      .parse(req.body);
    res.json(
      publicAuth(res, await service.verify(id, body.factorId, body.code)),
    );
  });
  app.post("/api/auth/cancel-enrollment", async (req, res) => {
    const id = requireCsrf(req);
    const body = z
      .object({ factorId: z.string().uuid() })
      .strict()
      .parse(req.body);
    res.json(
      publicAuth(res, await service.cancelEnrollment(id, body.factorId)),
    );
  });
  app.post("/api/auth/logout", async (req, res) => {
    const id = requireCsrf(req);
    z.object({}).strict().parse(req.body);
    res.json(publicAuth(res, await service.logout(id)));
  });
  app.post("/api/setup/supabase/probe", async (req, res) => {
    const id = requireCsrf(req);
    z.object({}).strict().parse(req.body);
    const context = await service.requireMfa(id);
    if (!data)
      throw new AuthError(
        503,
        "SUPABASE_NOT_CONFIGURED",
        "Supabase ist noch nicht eingerichtet.",
      );
    const verification = await data.verifySyntheticDatabase(
      context.accessToken,
    );
    service.assertSessionActive(id);
    res.json({ verification });
  });
}
