/**
 * Journal d'audit APPEND-ONLY.
 *
 * Chaque action sensible (création de brouillon, approbation, envoi, mise à
 * jour de statut suite à classification...) y est consignée. On n'UPDATE ni ne
 * DELETE jamais ces lignes : c'est la preuve RGPD exportable.
 */
import { getDb } from "../db/client";
import { auditLog } from "../db/schema";
import { log } from "../config/logger";

export interface AuditEntry {
  action: string;
  brokerSlug?: string | null;
  requestId?: number | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  subject?: string | null;
  detail?: Record<string, unknown> | null;
}

/** Écrit une entrée append-only dans le journal d'audit. */
export function audit(entry: AuditEntry): void {
  const db = getDb();
  db.insert(auditLog)
    .values({
      ts: new Date(),
      action: entry.action,
      brokerSlug: entry.brokerSlug ?? null,
      requestId: entry.requestId ?? null,
      fromStatus: entry.fromStatus ?? null,
      toStatus: entry.toStatus ?? null,
      subject: entry.subject ?? null,
      detail: entry.detail ?? null,
    })
    .run();
  log.debug("audit", {
    action: entry.action,
    broker: entry.brokerSlug,
    requestId: entry.requestId,
    transition:
      entry.fromStatus || entry.toStatus
        ? `${entry.fromStatus ?? "?"} -> ${entry.toStatus ?? "?"}`
        : undefined,
  });
}
