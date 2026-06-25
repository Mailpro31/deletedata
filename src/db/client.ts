/**
 * Ouverture de la base SQLite CHIFFRÉE (SQLCipher via
 * better-sqlite3-multiple-ciphers) et instanciation de Drizzle.
 *
 * La clé est une clé brute 32 octets dérivée (scrypt) de la passphrase, passée
 * en hex au PRAGMA (`key="x'...'"`) pour éviter tout souci d'échappement.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
// `better-sqlite3` est un alias npm vers `better-sqlite3-multiple-ciphers`
// (cf. package.json) : un seul build natif, et le driver Drizzle résout le
// même module en interne.
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { requireDb } from "../config/env";
import { deriveDbKeyHex } from "../config/crypto";
import { log } from "../config/logger";
import * as schema from "./schema";

export type DB = BetterSQLite3Database<typeof schema>;

let singleton: { db: DB; sqlite: Database.Database } | null = null;

export function openDatabase(): { db: DB; sqlite: Database.Database } {
  if (singleton) return singleton;
  const { path, passphrase } = requireDb();
  mkdirSync(dirname(path), { recursive: true });

  const sqlite = new Database(path);

  // L'ordre compte : choisir le cipher AVANT de fournir la clé.
  const keyHex = deriveDbKeyHex(passphrase);
  sqlite.pragma("cipher='sqlcipher'");
  sqlite.pragma(`key="x'${keyHex}'"`);

  // Valider la clé en touchant le catalogue : si la passphrase est mauvaise
  // (base existante), SQLite lève "file is not a database".
  try {
    sqlite.prepare("SELECT count(*) FROM sqlite_master").get();
  } catch {
    sqlite.close();
    throw new Error(
      "Impossible d'ouvrir la base chiffrée : passphrase incorrecte ou fichier corrompu.",
    );
  }

  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });
  singleton = { db, sqlite };
  log.debug("Base chiffrée ouverte", { path });
  return singleton;
}

/** Raccourci : instance Drizzle (ouvre la base au besoin). */
export function getDb(): DB {
  return openDatabase().db;
}

export function closeDatabase(): void {
  if (singleton) {
    singleton.sqlite.close();
    singleton = null;
  }
}

export { schema };
