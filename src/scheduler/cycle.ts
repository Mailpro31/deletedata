/**
 * Cycle complet (à lancer tous les 2-3 mois) :
 *   1. re-scan (vérif des suppressions sur les sites à recherche publique)
 *   2. vérif IMAP (réponses email)
 *   3. relances (demandes en attente dépassant la deadline)
 *   4. nouveaux brouillons (anti-spam : ne recible pas les confirmés/récents)
 *
 * GARDE-FOU MAINTENU : le cycle ne s'auto-approuve PAS et n'envoie PAS de
 * nouveau lot sans approbation — il NOTIFIE quand un lot attend mon aval.
 */
import { runRescan } from "../verify/rescan/pipeline";
import { runImapVerification } from "../verify/imap/pipeline";
import { sendReminders } from "../requests/reminder";
import { generateDrafts } from "../requests/draft";
import { listBatches } from "../requests/approve";
import { audit } from "../audit/log";
import { isLive } from "../config/env";
import { log } from "../config/logger";

export interface CycleOptions {
  rescan?: boolean;
  verify?: boolean;
  remind?: boolean;
  draft?: boolean;
}

export interface CycleResult {
  pendingApproval: number;
  draftBatchId?: number;
}

async function step(name: string, fn: () => Promise<unknown> | unknown): Promise<void> {
  try {
    await fn();
  } catch (e) {
    log.error(`Cycle — étape "${name}" échouée : ${(e as Error).message}`);
  }
}

export async function runCycle(opts: CycleOptions = {}): Promise<CycleResult> {
  log.info(`=== Cycle deletedata (mode ${isLive() ? "LIVE" : "DRY-RUN"}) ===`);
  const result: CycleResult = { pendingApproval: 0 };

  if (opts.rescan !== false) await step("re-scan", () => runRescan());
  if (opts.verify !== false) await step("vérif IMAP", () => runImapVerification());
  if (opts.remind !== false) await step("relances", () => sendReminders());
  if (opts.draft !== false) {
    await step("brouillons", () => {
      const d = generateDrafts({ label: `Cycle auto ${new Date().toLocaleDateString("fr-FR")}` });
      result.draftBatchId = d.batchId;
    });
  }

  // Notification d'approbation (on n'envoie JAMAIS sans aval).
  const totalPending = listBatches(true).reduce((s, b) => s + b.pending, 0);
  result.pendingApproval = totalPending;
  if (totalPending > 0) {
    log.warn(
      `⚠️  ${totalPending} demande(s) attendent ton APPROBATION avant tout envoi. ` +
        `Lance : \`cli review\` puis \`cli approve <batchId>\`, puis \`cli send\`.`,
    );
  }

  audit({ action: "cycle_run", detail: { ...result } });
  log.info("=== Cycle terminé ===");
  return result;
}
