/**
 * Pipeline de re-scan : pour chaque broker à recherche publique disposant d'une
 * config de re-scan et d'une demande envoyée :
 *   - profil ABSENT  -> confidence `confirmed_rescan` (suppression confirmée)
 *   - profil PRÉSENT -> "encore là" ; si on l'avait confirmé avant => RÉACQUISITION
 *   - indéterminé    -> aucune modification (jamais de fausse confirmation)
 *
 * Le re-scan est une LECTURE : il tourne même en dry-run (comme la vérif IMAP).
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { getDb } from "../../db/client";
import { brokers, requests, type BrokerRow } from "../../db/schema";
import { getIdentity, getPrimaryIdentity } from "../../identity/service";
import { rescanBroker } from "./scan";
import { audit } from "../../audit/log";
import { log } from "../../config/logger";

export interface RescanRunResult {
  scanned: number;
  confirmed: number;
  reacquired: number;
  stillPresent: number;
  inconclusive: number;
  errors: number;
  skipped: number;
}

export async function runRescan(opts: { brokerSlug?: string } = {}): Promise<RescanRunResult> {
  const db = getDb();
  let candidates: BrokerRow[] = db
    .select()
    .from(brokers)
    .where(and(eq(brokers.hasPublicSearch, true), isNotNull(brokers.rescanConfig)))
    .all();
  if (opts.brokerSlug) candidates = candidates.filter((b) => b.slug === opts.brokerSlug);

  const res: RescanRunResult = {
    scanned: 0,
    confirmed: 0,
    reacquired: 0,
    stillPresent: 0,
    inconclusive: 0,
    errors: 0,
    skipped: 0,
  };

  for (const broker of candidates) {
    const reqRow = db.select().from(requests).where(eq(requests.brokerId, broker.id)).get();
    if (!reqRow) {
      res.skipped++;
      continue;
    }
    const identity = getIdentity(reqRow.identityId) ?? getPrimaryIdentity();
    if (!identity) {
      res.skipped++;
      continue;
    }

    try {
      const r = await rescanBroker(broker, identity.data, reqRow.plusAlias);
      res.scanned++;

      if (r.outcome === "not_found") {
        db.update(requests)
          .set({
            status: "confirmed",
            confidenceStatus: "confirmed_rescan",
            proof: {
              type: "rescan",
              screenshotPath: r.screenshotPath,
              classifiedAt: new Date().toISOString(),
            },
          })
          .where(eq(requests.id, reqRow.id))
          .run();
        audit({
          action: "rescan_confirmed",
          brokerSlug: broker.slug,
          requestId: reqRow.id,
          fromStatus: reqRow.status,
          toStatus: "confirmed",
          detail: { screenshotPath: r.screenshotPath },
        });
        res.confirmed++;
      } else if (r.outcome === "found") {
        if (reqRow.confidenceStatus === "confirmed_rescan") {
          // Profil ré-apparu après confirmation -> réacquisition : repasse en attente.
          db.update(requests)
            .set({ status: "sent", confidenceStatus: "pending" })
            .where(eq(requests.id, reqRow.id))
            .run();
          audit({
            action: "reacquisition_detected",
            brokerSlug: broker.slug,
            requestId: reqRow.id,
            fromStatus: reqRow.status,
            toStatus: "sent",
            detail: { screenshotPath: r.screenshotPath },
          });
          res.reacquired++;
        } else {
          audit({ action: "rescan_still_present", brokerSlug: broker.slug, requestId: reqRow.id });
          res.stillPresent++;
        }
      } else {
        audit({
          action: "rescan_inconclusive",
          brokerSlug: broker.slug,
          requestId: reqRow.id,
          detail: { error: r.error },
        });
        res.inconclusive++;
        if (r.error) res.errors++;
      }
    } catch (e) {
      log.error(`Re-scan échoué (${broker.slug})`, { error: (e as Error).message });
      res.errors++;
    }
  }

  audit({ action: "rescan_run", detail: { ...res } });
  log.info(
    `Re-scan : ${res.scanned} scanné(s), ${res.confirmed} confirmé(s) supprimé(s), ` +
      `${res.reacquired} réacquisition(s), ${res.stillPresent} encore présent(s), ${res.inconclusive} indéterminé(s).`,
  );
  return res;
}
