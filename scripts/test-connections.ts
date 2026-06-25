/**
 * Teste les connexions externes : SMTP, IMAP, Vertex AI.
 * Usage : `npm run test-connections`
 *
 * Vertex envoie un court texte de TEST (sans aucune donnée personnelle) pour
 * valider l'authentification + le modèle.
 */
import { env, isLive } from "../src/config/env";
import { log } from "../src/config/logger";
import { verifySmtp } from "../src/send/email";
import { verifyImap } from "../src/verify/imap/client";
import { verifyVertex } from "../src/verify/classify/vertex";

async function check(name: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    const r = await fn();
    console.log(`  ✓ ${name} — OK${r ? ` (${r})` : ""}`);
    return true;
  } catch (e) {
    console.log(`  ✗ ${name} — ÉCHEC : ${(e as Error).message}`);
    return false;
  }
}

async function main(): Promise<void> {
  console.log("\n=== Test de connexion deletedata ===");
  console.log(`Mode : ${isLive() ? "LIVE (envois réels)" : "DRY-RUN (aucun envoi)"}  (DRY_RUN=${env.DRY_RUN})\n`);

  const smtp = await check("SMTP", async () => {
    await verifySmtp();
    return "authentification OK";
  });
  const imap = await check("IMAP", async () => {
    const r = await verifyImap();
    return `boîte ${r.mailbox} (${r.exists} message(s))`;
  });
  const vertex = await check("Vertex AI (classification)", async () => {
    const status = await verifyVertex();
    return `réponse classée -> ${status}`;
  });

  console.log("");
  if (smtp && imap && vertex) {
    log.info("Toutes les connexions sont opérationnelles.");
  } else {
    log.warn("Au moins une connexion a échoué — vérifie le .env (voir README).");
    process.exitCode = 1;
  }
}

main();
