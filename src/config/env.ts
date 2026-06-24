/**
 * Chargement + validation de la configuration depuis `.env`.
 *
 * On lit toutes les variables comme chaînes optionnelles (zod), puis on coerce
 * en types + défauts dans le code (robuste, indépendant des versions de zod).
 * La présence des groupes (DB / SMTP / IMAP / Vertex) est validée au point
 * d'utilisation via les helpers `requireXxx()`.
 *
 * GARDE-FOU CENTRAL : l'envoi réel exige DEUX conditions explicites
 * (DRY_RUN=false ET LIVE_CONFIRM=I_UNDERSTAND). Voir `isLive()`.
 */
import "dotenv/config";
import { z } from "zod";

const RawSchema = z
  .object({
    DRY_RUN: z.string().optional(),
    LIVE_CONFIRM: z.string().optional(),
    DB_PATH: z.string().optional(),
    DB_PASSPHRASE: z.string().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.string().optional(),
    SMTP_SECURE: z.string().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    MAIL_FROM_NAME: z.string().optional(),
    MAIL_BASE_ADDRESS: z.string().optional(),
    IMAP_HOST: z.string().optional(),
    IMAP_PORT: z.string().optional(),
    IMAP_SECURE: z.string().optional(),
    IMAP_USER: z.string().optional(),
    IMAP_PASS: z.string().optional(),
    IMAP_MAILBOX: z.string().optional(),
    GOOGLE_CLOUD_PROJECT: z.string().optional(),
    GOOGLE_CLOUD_LOCATION: z.string().optional(),
    VERTEX_MODEL: z.string().optional(),
    GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
    LOG_LEVEL: z.string().optional(),
    RETARGET_DAYS: z.string().optional(),
  })
  .passthrough();

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Env {
  DRY_RUN: boolean;
  LIVE_CONFIRM?: string;
  DB_PATH: string;
  DB_PASSPHRASE?: string;
  SMTP_HOST?: string;
  SMTP_PORT: number;
  SMTP_SECURE: boolean;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  MAIL_FROM_NAME?: string;
  MAIL_BASE_ADDRESS?: string;
  IMAP_HOST?: string;
  IMAP_PORT: number;
  IMAP_SECURE: boolean;
  IMAP_USER?: string;
  IMAP_PASS?: string;
  IMAP_MAILBOX: string;
  GOOGLE_CLOUD_PROJECT?: string;
  GOOGLE_CLOUD_LOCATION: string;
  VERTEX_MODEL: string;
  GOOGLE_APPLICATION_CREDENTIALS?: string;
  LOG_LEVEL: LogLevel;
  RETARGET_DAYS: number;
}

const toBool = (v: string | undefined, def: boolean): boolean => {
  if (v === undefined || v === "") return def;
  return ["true", "1", "yes", "on"].includes(v.toLowerCase());
};
const toInt = (v: string | undefined, def: number): number => {
  if (v === undefined || v === "") return def;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
};
const toLevel = (v: string | undefined): LogLevel =>
  v === "debug" || v === "info" || v === "warn" || v === "error" ? v : "info";

function loadEnv(): Env {
  const parsed = RawSchema.safeParse(process.env);
  // RawSchema n'a que des optionnels -> ne devrait jamais échouer ; on garde
  // un garde de sûreté.
  const r = parsed.success ? parsed.data : {};
  return {
    DRY_RUN: toBool(r.DRY_RUN, true),
    LIVE_CONFIRM: r.LIVE_CONFIRM || undefined,
    DB_PATH: r.DB_PATH || "./data/deletedata.db",
    DB_PASSPHRASE: r.DB_PASSPHRASE || undefined,
    SMTP_HOST: r.SMTP_HOST || undefined,
    SMTP_PORT: toInt(r.SMTP_PORT, 465),
    SMTP_SECURE: toBool(r.SMTP_SECURE, true),
    SMTP_USER: r.SMTP_USER || undefined,
    SMTP_PASS: r.SMTP_PASS || undefined,
    MAIL_FROM_NAME: r.MAIL_FROM_NAME || undefined,
    MAIL_BASE_ADDRESS: r.MAIL_BASE_ADDRESS || undefined,
    IMAP_HOST: r.IMAP_HOST || undefined,
    IMAP_PORT: toInt(r.IMAP_PORT, 993),
    IMAP_SECURE: toBool(r.IMAP_SECURE, true),
    IMAP_USER: r.IMAP_USER || undefined,
    IMAP_PASS: r.IMAP_PASS || undefined,
    IMAP_MAILBOX: r.IMAP_MAILBOX || "INBOX",
    GOOGLE_CLOUD_PROJECT: r.GOOGLE_CLOUD_PROJECT || undefined,
    GOOGLE_CLOUD_LOCATION: r.GOOGLE_CLOUD_LOCATION || "europe-west1",
    VERTEX_MODEL: r.VERTEX_MODEL || "gemini-2.5-flash",
    GOOGLE_APPLICATION_CREDENTIALS: r.GOOGLE_APPLICATION_CREDENTIALS || undefined,
    LOG_LEVEL: toLevel(r.LOG_LEVEL),
    RETARGET_DAYS: toInt(r.RETARGET_DAYS, 90),
  };
}

export const env: Env = loadEnv();

// ---------------------------------------------------------------------------
//  Garde-fous d'envoi
// ---------------------------------------------------------------------------

/** L'envoi réel n'est autorisé que si les DEUX conditions sont réunies. */
export function isLive(): boolean {
  return env.DRY_RUN === false && env.LIVE_CONFIRM === "I_UNDERSTAND";
}

/** Lance une erreur explicite si on tente d'envoyer hors mode live confirmé. */
export function assertLive(): void {
  if (isLive()) return;
  const reasons: string[] = [];
  if (env.DRY_RUN !== false) reasons.push("DRY_RUN n'est pas à false");
  if (env.LIVE_CONFIRM !== "I_UNDERSTAND")
    reasons.push("LIVE_CONFIRM n'est pas égal à I_UNDERSTAND");
  throw new Error(
    `Envoi réel bloqué par les garde-fous (${reasons.join(
      " ; ",
    )}). C'est volontaire : aucun email ne peut partir par accident.`,
  );
}

// ---------------------------------------------------------------------------
//  Validation par groupe (au point d'utilisation)
// ---------------------------------------------------------------------------

function assertPresent(pairs: Record<string, unknown>, group: string): void {
  const missing = Object.entries(pairs)
    .filter(([, v]) => v === undefined || v === "")
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(
      `Config ${group} incomplète — variables manquantes dans .env : ${missing.join(
        ", ",
      )}`,
    );
  }
}

export function requireDb(): { path: string; passphrase: string } {
  assertPresent({ DB_PASSPHRASE: env.DB_PASSPHRASE }, "BASE DE DONNÉES");
  return { path: env.DB_PATH, passphrase: env.DB_PASSPHRASE! };
}

export function requireSmtp() {
  assertPresent(
    { SMTP_HOST: env.SMTP_HOST, SMTP_USER: env.SMTP_USER, SMTP_PASS: env.SMTP_PASS },
    "SMTP",
  );
  return {
    host: env.SMTP_HOST!,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER!,
    pass: env.SMTP_PASS!,
    fromName: env.MAIL_FROM_NAME,
    baseAddress: env.MAIL_BASE_ADDRESS || env.SMTP_USER!,
  };
}

export function requireImap() {
  assertPresent(
    { IMAP_HOST: env.IMAP_HOST, IMAP_USER: env.IMAP_USER, IMAP_PASS: env.IMAP_PASS },
    "IMAP",
  );
  return {
    host: env.IMAP_HOST!,
    port: env.IMAP_PORT,
    secure: env.IMAP_SECURE,
    user: env.IMAP_USER!,
    pass: env.IMAP_PASS!,
    mailbox: env.IMAP_MAILBOX,
  };
}

export function requireVertex() {
  assertPresent({ GOOGLE_CLOUD_PROJECT: env.GOOGLE_CLOUD_PROJECT }, "VERTEX AI");
  return {
    project: env.GOOGLE_CLOUD_PROJECT!,
    location: env.GOOGLE_CLOUD_LOCATION,
    model: env.VERTEX_MODEL,
  };
}

/** Liste des valeurs secrètes connues, pour la redaction des logs. */
export function knownSecrets(): string[] {
  return [env.DB_PASSPHRASE, env.SMTP_PASS, env.IMAP_PASS, env.LIVE_CONFIRM].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
}
