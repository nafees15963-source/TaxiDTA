import { spawn } from "node:child_process";
import type { Writable } from "node:stream";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class DtaCryptoError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DtaCryptoError";
  }
}

/**
 * Node's extra stdio pipes are sockets on Linux; OpenSSL BIO cannot reopen /dev/fd/N.
 * BIO inputs therefore use private temporary files. Unencrypted private keys are refused.
 * Payload stdin and password fd:N remain pipes, and are never persisted by this runner.
 */
export async function runOpenSsl(
  args: readonly string[],
  input: Uint8Array = new Uint8Array(),
  extraInputs: readonly Uint8Array[] = [],
): Promise<Buffer> {
  let directory: string | undefined;
  const effectiveArgs = [...args];
  // Checks and writes must use the same bytes even if a caller mutates its buffers.
  const payload = Buffer.from(input);
  const sources = extraInputs.map((bytes) => Buffer.from(bytes));
  try {
    for (let index = 0; index < effectiveArgs.length; index++) {
      const match = /^\/dev\/fd\/(\d+)$/.exec(effectiveArgs[index]);
      if (!match) continue;
      const source = sources[Number(match[1]) - 3];
      if (!source || source.byteLength > 2 * 1024 * 1024)
        throw new DtaCryptoError(
          "CRYPTO_FILE_INPUT",
          "Ungültige lokale Krypto-Eingabe.",
        );
      const pem = Buffer.from(source).toString("ascii");
      const keyArgument = ["-key", "-inkey", "-keyfile", "-CAkey"].includes(
        effectiveArgs[index - 1],
      );
      if (
        (keyArgument &&
          !/^-----BEGIN ENCRYPTED PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END ENCRYPTED PRIVATE KEY-----\s*$/.test(
            pem,
          )) ||
        /-----BEGIN (?:RSA |EC |DSA |)PRIVATE KEY-----/.test(pem)
      ) {
        throw new DtaCryptoError(
          "UNENCRYPTED_KEY_REFUSED",
          "Temporäre Klartext-Schlüsseldateien sind nicht erlaubt.",
        );
      }
      directory ??= await mkdtemp(join(tmpdir(), "taxidta-crypto-"));
      const filename = join(directory, `input-${index}`);
      await writeFile(filename, source, { mode: 0o600, flag: "wx" });
      effectiveArgs[index] = filename;
    }
    return await new Promise((resolve, reject) => {
      const directInputs = sources.map((_, index) =>
        effectiveArgs.includes(`fd:${index + 3}`),
      );
      const child = spawn("openssl", effectiveArgs, {
        shell: false,
        env: { PATH: process.env.PATH, LANG: "C", LC_ALL: "C" },
        stdio: [
          "pipe",
          "pipe",
          "pipe",
          ...directInputs.map((direct) =>
            direct ? ("pipe" as const) : ("ignore" as const),
          ),
        ],
      });
      const output: Buffer[] = [];
      let size = 0;
      let failure: DtaCryptoError | undefined;
      const fail = (code: string, message: string) => {
        failure ??= new DtaCryptoError(code, message);
        child.kill("SIGKILL");
      };
      const timer = setTimeout(
        () =>
          fail(
            "CRYPTO_TIMEOUT",
            "Die lokale Kryptoprüfung hat das Zeitlimit überschritten.",
          ),
        15_000,
      );
      child.stdout!.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 18 * 1024 * 1024)
          fail(
            "CRYPTO_OUTPUT_LIMIT",
            "Die lokale Kryptoprüfung überschreitet die Ausgabegrenze.",
          );
        else output.push(chunk);
      });
      // Drain diagnostics; OpenSSL may include DNs, filenames and other sensitive metadata.
      child.stderr!.on("data", () => {});
      child.on("error", () => {
        failure ??= new DtaCryptoError(
          "OPENSSL_UNAVAILABLE",
          "OpenSSL konnte nicht gestartet werden.",
        );
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        const result =
          failure || code !== 0 ? undefined : Buffer.concat(output);
        output.forEach((chunk) => chunk.fill(0));
        if (failure) reject(failure);
        else if (code !== 0)
          reject(
            new DtaCryptoError(
              "OPENSSL_REJECTED",
              "OpenSSL hat die Zertifikats- oder Kryptoprüfung abgewiesen.",
            ),
          );
        else resolve(result!);
      });
      child.stdin!.on("error", () => {});
      child.stdin!.end(payload);
      sources.forEach((bytes, index) => {
        if (!directInputs[index]) return;
        const channel = child.stdio[index + 3] as Writable;
        channel.on("error", () => {});
        channel.end(bytes);
      });
    });
  } finally {
    payload.fill(0);
    sources.forEach((bytes) => bytes.fill(0));
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

export const fdPath = (descriptor: number) => `/dev/fd/${descriptor}`;
