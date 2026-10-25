import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative, join } from "node:path";

const root = process.cwd();
const excluded = new Set([
  "node_modules",
  ".sites-runtime",
  ".wrangler",
  "outputs",
  ".git",
  "dist",
  "work",
  "private-source-docs",
  "playwright-report",
  "test-results",
]);
const extensions = /\.(?:ts|tsx|js|jsx|mjs|cjs|md|json|sql|yml|yaml|html|css)$/;
const checks = [
  {
    label: "Privater Schlüssel",
    expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    label: "Wahrscheinliche vollständige deutsche IBAN",
    expression: /\bDE\d{2}(?:[ -]?\d){18}\b/,
  },
  {
    label: "Wahrscheinlicher Supabase Secret-Key",
    expression: /\bsb_secret_[A-Za-z0-9_-]{20,}/,
  },
  {
    label: "Wahrscheinlicher GitHub Access-Token",
    expression: /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{30,}/,
  },
];
const findings: string[] = [];
let scanned = 0;
function scan(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name) || entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) scan(path);
    else if (
      entry.isFile() &&
      extensions.test(entry.name) &&
      entry.name !== "package-lock.json"
    ) {
      scanned++;
      const content = readFileSync(path, "utf8");
      for (const check of checks)
        if (check.expression.test(content))
          findings.push(
            `${check.label}: ${relative(root, path)} (Wert absichtlich nicht ausgegeben)`,
          );
    }
  }
}
scan(root);
const ignore = readFileSync(join(root, ".gitignore"), "utf8");
for (const item of ["private-source-docs/", "work/", ".env", "node_modules/"]) {
  if (!ignore.split(/\r?\n/).includes(item))
    findings.push(`Git-Ausschluss fehlt: ${item}`);
}
for (const item of [
  "server/index.ts",
  "server/store.ts",
  "docs/THREAT_MODEL.md",
  "docs/SECURITY_CONTROLS.md",
  "package-lock.json",
]) {
  if (!existsSync(join(root, item)))
    findings.push(`Erwartete Datei fehlt: ${item}`);
}
const sqlPath = join(
  root,
  "supabase/migrations/20261022121929_owner_mfa_setup_probe.sql",
);
if (existsSync(sqlPath)) {
  const sql = readFileSync(sqlPath, "utf8");
  if (!sql.includes("ENABLE ROW LEVEL SECURITY") || !sql.includes("aal2"))
    findings.push("Supabase-Entwurf verliert RLS-/AAL2-Schutz.");
}
if (findings.length) {
  console.error(
    `Quellprüfung fehlgeschlagen (${findings.length} Befunde):\n${findings.join("\n")}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `Quellprüfung: ${scanned} Dateien geprüft; keine Treffer der eingebauten Schlüssel-/IBAN-Muster.\nPrivate Quellen und Laufzeitdaten sind per .gitignore ausgeschlossen.\nGrenze: kein Penetrationstest, keine vollständige PII-Erkennung, kein Abhängigkeitsaudit. Dafür npm audit --omit=dev gesondert ausführen.`,
  );
}
