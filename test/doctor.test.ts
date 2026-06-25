import { describe, it, expect } from "vitest";
import { checkConfig, nextSteps } from "../src/diagnostics/doctor";
import type { Env } from "../src/config/env";

function baseEnv(over: Partial<Env> = {}): Env {
  return {
    DRY_RUN: true,
    LIVE_CONFIRM: undefined,
    DB_PATH: "./data/x.db",
    DB_PASSPHRASE: undefined,
    SMTP_HOST: undefined,
    SMTP_PORT: 465,
    SMTP_SECURE: true,
    SMTP_USER: undefined,
    SMTP_PASS: undefined,
    MAIL_FROM_NAME: undefined,
    MAIL_BASE_ADDRESS: undefined,
    IMAP_HOST: undefined,
    IMAP_PORT: 993,
    IMAP_SECURE: true,
    IMAP_USER: undefined,
    IMAP_PASS: undefined,
    IMAP_MAILBOX: "INBOX",
    GOOGLE_CLOUD_PROJECT: undefined,
    GOOGLE_CLOUD_LOCATION: "europe-west1",
    VERTEX_MODEL: "gemini-2.5-flash",
    GOOGLE_APPLICATION_CREDENTIALS: undefined,
    LOG_LEVEL: "info",
    RETARGET_DAYS: 90,
    ...over,
  };
}

const fullyConfigured: Partial<Env> = {
  DB_PASSPHRASE: "x",
  SMTP_HOST: "smtp.gmail.com",
  SMTP_USER: "u@gmail.com",
  SMTP_PASS: "p",
  IMAP_HOST: "imap.gmail.com",
  IMAP_USER: "u@gmail.com",
  IMAP_PASS: "p",
  GOOGLE_CLOUD_PROJECT: "proj",
};

describe("doctor — checkConfig", () => {
  it("signale les groupes manquants sur un env vide, sans révéler de valeur", () => {
    const r = checkConfig(baseEnv());
    expect(r.live).toBe(false);
    const db = r.groups.find((g) => g.name.startsWith("Base"));
    expect(db?.ok).toBe(false);
    expect(db?.missing).toContain("DB_PASSPHRASE");
    // ne contient que des NOMS de variables, jamais de valeurs secrètes
    expect(db?.present).not.toContain("x");
  });

  it("tous les groupes OK quand la config est complète", () => {
    const r = checkConfig(baseEnv(fullyConfigured));
    expect(r.groups.every((g) => g.ok)).toBe(true);
    expect(r.modeWarnings).toHaveLength(0);
  });

  it("live=true UNIQUEMENT avec le double verrou", () => {
    expect(checkConfig(baseEnv({ DRY_RUN: false, LIVE_CONFIRM: "I_UNDERSTAND" })).live).toBe(true);
    expect(checkConfig(baseEnv({ DRY_RUN: false })).live).toBe(false);
    expect(checkConfig(baseEnv({ LIVE_CONFIRM: "I_UNDERSTAND" })).live).toBe(false);
  });

  it("avertit si DRY_RUN=false sans LIVE_CONFIRM (envoi bloqué, pas live)", () => {
    const r = checkConfig(baseEnv({ DRY_RUN: false }));
    expect(r.live).toBe(false);
    expect(r.modeWarnings.length).toBeGreaterThan(0);
  });
});

describe("doctor — nextSteps", () => {
  it("priorise la passphrase quand la base n'est pas configurée", () => {
    const steps = nextSteps(checkConfig(baseEnv()), false);
    expect(steps[0]).toMatch(/DB_PASSPHRASE/);
  });

  it("propose db:migrate si la base est configurée mais inaccessible", () => {
    const steps = nextSteps(checkConfig(baseEnv({ DB_PASSPHRASE: "x" })), false);
    expect(steps.some((s) => s.includes("db:migrate"))).toBe(true);
  });

  it("guide vers la répétition dry-run quand tout est prêt", () => {
    const steps = nextSteps(checkConfig(baseEnv(fullyConfigured)), true);
    expect(steps.some((s) => s.includes("dry-run"))).toBe(true);
  });
});
