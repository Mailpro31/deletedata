/**
 * Approbation par lot — LE garde-fou : je vois exactement ce qui partira sous
 * mon nom, et je l'approuve, avant tout envoi.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import {
  approvalBatches,
  requests,
  brokers,
  type ApprovalBatchRow,
  type RequestRow,
} from "../db/schema";
import { audit } from "../audit/log";
import { log } from "../config/logger";

export interface BatchSummary extends ApprovalBatchRow {
  pending: number;
}

export function listBatches(onlyPending = false): BatchSummary[] {
  const db = getDb();
  const rows = db.select().from(approvalBatches).orderBy(approvalBatches.id).all();
  const out: BatchSummary[] = [];
  for (const b of rows) {
    if (onlyPending && b.status !== "pending") continue;
    const pending = db
      .select()
      .from(requests)
      .where(and(eq(requests.batchId, b.id), eq(requests.status, "awaiting_approval")))
      .all().length;
    out.push({ ...b, pending });
  }
  return out;
}

export interface RequestWithBroker {
  request: RequestRow;
  brokerSlug: string;
  brokerName: string;
}

export function getBatchRequests(batchId: number): RequestWithBroker[] {
  const db = getDb();
  const rows = db
    .select({ request: requests, slug: brokers.slug, name: brokers.name })
    .from(requests)
    .innerJoin(brokers, eq(requests.brokerId, brokers.id))
    .where(eq(requests.batchId, batchId))
    .all();
  return rows.map((r) => ({
    request: r.request,
    brokerSlug: r.slug,
    brokerName: r.name,
  }));
}

export function approveBatch(batchId: number): { approved: number } {
  const db = getDb();
  let approved = 0;
  db.transaction((tx) => {
    const batch = tx
      .select()
      .from(approvalBatches)
      .where(eq(approvalBatches.id, batchId))
      .get();
    if (!batch) throw new Error(`Lot #${batchId} introuvable.`);
    const rows = tx
      .select()
      .from(requests)
      .where(and(eq(requests.batchId, batchId), eq(requests.status, "awaiting_approval")))
      .all();
    for (const r of rows) {
      tx.update(requests).set({ status: "approved" }).where(eq(requests.id, r.id)).run();
      audit({
        action: "request_approved",
        requestId: r.id,
        fromStatus: r.status,
        toStatus: "approved",
      });
      approved++;
    }
    tx
      .update(approvalBatches)
      .set({ status: "approved", approvedAt: new Date() })
      .where(eq(approvalBatches.id, batchId))
      .run();
  });
  audit({ action: "batch_approved", detail: { batchId, approved } });
  log.info(`Lot #${batchId} approuvé : ${approved} demande(s) prêtes à l'envoi.`);
  return { approved };
}

export function rejectBatch(batchId: number): { rejected: number } {
  const db = getDb();
  let rejected = 0;
  db.transaction((tx) => {
    const rows = tx
      .select()
      .from(requests)
      .where(and(eq(requests.batchId, batchId), eq(requests.status, "awaiting_approval")))
      .all();
    for (const r of rows) {
      // Le brouillon revient à l'état 'draft' (non envoyable tant que non réapprouvé).
      tx.update(requests).set({ status: "draft" }).where(eq(requests.id, r.id)).run();
      rejected++;
    }
    tx
      .update(approvalBatches)
      .set({ status: "rejected" })
      .where(eq(approvalBatches.id, batchId))
      .run();
  });
  audit({ action: "batch_rejected", detail: { batchId, rejected } });
  log.info(`Lot #${batchId} rejeté : ${rejected} demande(s) remises en brouillon.`);
  return { rejected };
}
