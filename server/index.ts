import { loadLocalConfiguration } from "./config.js";
import { createApp } from "./app.js";
loadLocalConfiguration();
const host = process.env.HOST ?? "127.0.0.1";
if (host !== "127.0.0.1")
  throw new Error(
    "Die Demo darf ausschließlich an 127.0.0.1 gebunden werden. Externes Hosting ist gesperrt.",
  );
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("PORT muss eine ganze Zahl zwischen 1024 und 65535 sein.");
const app = await createApp({
  seed: true,
  frontend: true,
  production: process.env.NODE_ENV === "production",
});
const server = app.listen(port, host, () => {
  console.log(
    `TaxiDTA · lokale Demo mit erfundenen Daten\nhttp://${host}:${port}\nEchte Patientendaten und produktiver DTA-Versand sind gesperrt.`,
  );
});
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await app.locals.vite?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await app.locals.authService?.close?.();
  app.locals.store.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
