/**
 * Logger minimal avec REDACTION systématique des secrets.
 *
 * Toute valeur secrète connue (passphrase, app passwords...) est remplacée par
 * `***REDACTED***` avant impression, quelle que soit la profondeur de l'objet.
 * On ne loggue jamais d'objet brut sans passer par cette redaction.
 */
import { env, knownSecrets } from "./env";

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// Capture des secrets au démarrage (et rafraîchissable si besoin).
let SECRETS = knownSecrets();
export function refreshSecrets(): void {
  SECRETS = knownSecrets();
}

/** Remplace toute occurrence d'un secret connu par un masque. */
function redactString(s: string): string {
  let out = s;
  for (const secret of SECRETS) {
    if (secret && out.includes(secret)) {
      out = out.split(secret).join("***REDACTED***");
    }
  }
  return out;
}

/** Redaction récursive sur n'importe quelle valeur loggable. */
export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    // Masque aussi par nom de clé sensible, même si la valeur n'est pas connue.
    if (/pass|passphrase|secret|token|credential|key/i.test(k)) {
      out[k] = typeof v === "string" && v.length > 0 ? "***REDACTED***" : v;
    } else {
      out[k] = redact(v, seen);
    }
  }
  return out;
}

function emit(level: Level, msg: string, meta?: unknown): void {
  if (ORDER[level] < ORDER[env.LOG_LEVEL]) return;
  const ts = new Date().toISOString();
  const line = `${ts} ${level.toUpperCase().padEnd(5)} ${redactString(msg)}`;
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (meta === undefined) sink(line);
  else sink(line, redact(meta));
}

export const log = {
  debug: (msg: string, meta?: unknown) => emit("debug", msg, meta),
  info: (msg: string, meta?: unknown) => emit("info", msg, meta),
  warn: (msg: string, meta?: unknown) => emit("warn", msg, meta),
  error: (msg: string, meta?: unknown) => emit("error", msg, meta),
};
