/**
 * Scheduler local (node-cron) : relance le cycle complet tous les 2-3 mois.
 * Processus long ; garde-le ouvert (ex: via `cli schedule`).
 */
import cron from "node-cron";
import { runCycle } from "./cycle";
import { log } from "../config/logger";

// Par défaut : 09:00 le 1er de chaque 2e mois.
export const DEFAULT_CRON = "0 9 1 */2 *";

export function startScheduler(
  cronExpr: string = process.env.SCHEDULE_CRON || DEFAULT_CRON,
  opts: { runNow?: boolean } = {},
): void {
  if (!cron.validate(cronExpr)) {
    throw new Error(`Expression cron invalide : ${cronExpr}`);
  }
  log.info(`Scheduler démarré (cron: "${cronExpr}"). Processus maintenu ouvert — Ctrl+C pour arrêter.`);
  cron.schedule(cronExpr, () => {
    runCycle().catch((e) => log.error(`Cycle planifié échoué : ${(e as Error).message}`));
  });
  if (opts.runNow) {
    runCycle().catch((e) => log.error(`Cycle initial échoué : ${(e as Error).message}`));
  }
}
