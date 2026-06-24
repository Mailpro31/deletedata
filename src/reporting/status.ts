/**
 * Reporting : vue d'ensemble HONNÊTE + requêtes filtrées + export RGPD.
 *
 * L'indicateur global "% confirmées supprimées" n'est JAMAIS gonflé : seules
 * les confiances `confirmed_email`/`confirmed_rescan` comptent au numérateur ;
 * le dénominateur inclut TOUTES les demandes actionnées (y compris manuelles et
 * invérifiables), ce qui tire honnêtement le pourcentage vers le bas.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { auditLog, brokers, requests, reviewQueue } from "../db/schema";
import { isConfirmedDeleted } from "../domain/status";
import type {
  Channel,
  ConfidenceStatus,
  RequestStatus,
} from "../domain/types";

const ACTIONED: RequestStatus[] = [
  "sent",
  "acknowledged",
  "reminded",
  "confirmed",
  "refused",
  "needs_info",
  "manual_required",
];

export interface StatusReport {
  dryRun: boolean;
  live: boolean;
  brokers: { total: number; active: number };
  requestsTotal: number;
  byStatus: Record<string, number>;
  byConfidence: Record<string, number>;
  actioned: number;
  confirmedDeleted: number;
  confirmedDeletedPct: number;
  overdueAwaiting: number;
  reviewQueue: number;
  failures: { requestId: number; broker: string; message: string }[];
}

export function buildStatusReport(flags: { dryRun: boolean; live: boolean }): StatusReport {
  const db = getDb();
  const allBrokers = db.select().from(brokers).all();
  const allReqs = db
    .select({ request: requests, slug: brokers.slug })
    .from(requests)
    .innerJoin(brokers, eq(requests.brokerId, brokers.id))
    .all();

  const byStatus: Record<string, number> = {};
  const byConfidence: Record<string, number> = {};
  let actioned = 0;
  let confirmedDeleted = 0;
  let overdueAwaiting = 0;
  const failures: StatusReport["failures"] = [];
  const now = Date.now();

  for (const { request: r, slug } of allReqs) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    byConfidence[r.confidenceStatus] = (byConfidence[r.confidenceStatus] ?? 0) + 1;
    if (ACTIONED.includes(r.status)) actioned++;
    if (isConfirmedDeleted(r.confidenceStatus)) confirmedDeleted++;
    if (
      (r.status === "sent" || r.status === "acknowledged" || r.status === "reminded") &&
      r.deadlineAt &&
      r.deadlineAt.getTime() < now
    ) {
      overdueAwaiting++;
    }
    if (r.status === "failed") {
      const msg = r.errorLog?.at(-1)?.message ?? "(raison inconnue)";
      failures.push({ requestId: r.id, broker: slug, message: msg });
    }
  }

  const reviewCount = db
    .select()
    .from(reviewQueue)
    .where(isNull(reviewQueue.resolvedAt))
    .all().length;

  return {
    dryRun: flags.dryRun,
    live: flags.live,
    brokers: {
      total: allBrokers.length,
      active: allBrokers.filter((b) => b.active).length,
    },
    requestsTotal: allReqs.length,
    byStatus,
    byConfidence,
    actioned,
    confirmedDeleted,
    confirmedDeletedPct: actioned > 0 ? Math.round((confirmedDeleted / actioned) * 1000) / 10 : 0,
    overdueAwaiting,
    reviewQueue: reviewCount,
    failures,
  };
}

export interface RequestView {
  id: number;
  broker: string;
  channel: Channel;
  status: RequestStatus;
  confidence: ConfidenceStatus;
  sentAt: Date | null;
  deadlineAt: Date | null;
  reminderCount: number;
  hasProof: boolean;
}

export interface RequestFilter {
  status?: RequestStatus;
  confidence?: ConfidenceStatus;
  channel?: Channel;
  notSent?: boolean;
  brokerSlug?: string;
}

const NOT_SENT: RequestStatus[] = ["draft", "awaiting_approval", "approved"];

export function queryRequests(filter: RequestFilter = {}): RequestView[] {
  const db = getDb();
  const conds = [];
  if (filter.status) conds.push(eq(requests.status, filter.status));
  if (filter.confidence) conds.push(eq(requests.confidenceStatus, filter.confidence));
  if (filter.channel) conds.push(eq(requests.channel, filter.channel));
  if (filter.notSent) conds.push(inArray(requests.status, NOT_SENT));
  if (filter.brokerSlug) conds.push(eq(brokers.slug, filter.brokerSlug));

  const rows = db
    .select({ request: requests, slug: brokers.slug })
    .from(requests)
    .innerJoin(brokers, eq(requests.brokerId, brokers.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(requests.updatedAt))
    .all();

  return rows.map(({ request: r, slug }) => ({
    id: r.id,
    broker: slug,
    channel: r.channel,
    status: r.status,
    confidence: r.confidenceStatus,
    sentAt: r.sentAt,
    deadlineAt: r.deadlineAt,
    reminderCount: r.reminderCount,
    hasProof: Boolean(r.proof),
  }));
}

// --------------------------------------------------------------------------
//  Export RGPD (historique)
// --------------------------------------------------------------------------

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportHistory(format: "json" | "csv"): string {
  const db = getDb();
  const rows = db
    .select({ request: requests, slug: brokers.slug, name: brokers.name })
    .from(requests)
    .innerJoin(brokers, eq(requests.brokerId, brokers.id))
    .orderBy(requests.id)
    .all();

  if (format === "json") {
    const audit = db.select().from(auditLog).orderBy(auditLog.id).all();
    return JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        requests: rows.map(({ request: r, slug, name }) => ({
          id: r.id,
          broker: slug,
          brokerName: name,
          channel: r.channel,
          status: r.status,
          confidenceStatus: r.confidenceStatus,
          plusAlias: r.plusAlias,
          messageId: r.messageId,
          sentAt: r.sentAt,
          deadlineAt: r.deadlineAt,
          reminderCount: r.reminderCount,
          proof: r.proof,
        })),
        auditLog: audit,
      },
      null,
      2,
    );
  }

  // CSV
  const header = [
    "id",
    "broker",
    "name",
    "channel",
    "status",
    "confidence",
    "sentAt",
    "deadlineAt",
    "reminders",
    "proofType",
  ];
  const lines = [header.join(",")];
  for (const { request: r, slug, name } of rows) {
    lines.push(
      [
        r.id,
        slug,
        name,
        r.channel,
        r.status,
        r.confidenceStatus,
        r.sentAt?.toISOString() ?? "",
        r.deadlineAt?.toISOString() ?? "",
        r.reminderCount,
        r.proof?.type ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}
