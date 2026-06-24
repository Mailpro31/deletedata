import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` diffe le schéma -> SQL (sans connexion à la base).
// L'APPLICATION des migrations passe par src/db/migrate.ts (connexion chiffrée).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
});
