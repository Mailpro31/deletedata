/**
 * Applique les migrations Drizzle À TRAVERS la connexion chiffrée.
 *
 * On ne peut PAS utiliser `drizzle-kit migrate` (il ouvre sa propre connexion
 * sans la clé SQLCipher). On passe donc par le migrator + notre client chiffré.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase, closeDatabase } from "./client";
import { log } from "../config/logger";

export function runMigrations(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = join(here, "migrations");
  const { db } = openDatabase();
  migrate(db, { migrationsFolder });
  log.info("Migrations appliquées.");
}

// Exécution directe : `npm run db:migrate`
// NB: on compare via pathToFileURL pour que ça marche aussi sous Windows
// (où process.argv[1] utilise des backslashes, pas le schéma file:///).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runMigrations();
  } finally {
    closeDatabase();
  }
}
