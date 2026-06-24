/**
 * Génération de brouillons de demandes d'effacement.
 *
 * Pour chaque broker ciblé (sous-ensemble `active` par défaut), on crée/raffraî-
 * chit une Request en statut `awaiting_approval`, rattachée à un LOT. Rien n'est
 * envoyé ici : l'approbation par lot puis l'envoi (avec garde-fous) viennent
 * après. On pose dès maintenant : alias plus-addressing + Message-ID (clé du
 * rattachement fiable des réponses).
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import {
  approvalBatches,
  requests,
  type BrokerRow,
  type IdentityRow,
} from "../db/schema";
import type { Channel } from "../domain/types";
import { listBrokers, getBrokerBySlug } from "../brokers/registry";
import { getIdentity, getPrimaryIdentity } from "../identity/service";
import { renderGdprErasure } from "./templates/gdpr-erasure.fr";
import { buildPlusAlias } from "../send/plusAddress";
import { shouldTarget } from "./antispam";
import { env } from "../config/env";
import { audit } from "../audit/log";
import { log } from "../config/logger";

export interface DraftOptions {
  identityId?: number;
  channel?: Channel;
  brokerSlugs?: string[];
  force?: boolean;
  label?: string;
}

export interface DraftResult {
  batchId: number;
  created: number;
  updated: number;
  skipped: number;
  skippedReasons: Record<string, number>;
}

function addOneMonth(d: Date): Date {
  const n = new Date(d);
  n.setMonth(n.getMonth() + 1);
  return n;
}

export function generateDrafts(opts: DraftOptions = {}): DraftResult {
  const db = getDb();
  const identity: IdentityRow | undefined = opts.identityId
    ? getIdentity(opts.identityId)
    : getPrimaryIdentity();
  if (!identity) {
    throw new Error(
      "Aucune identité enregistrée. Crée d'abord une identité (`cli identity add`).",
    );
  }
  const data = identity.data;

  // Adresse de base du plus-addressing. Sans SMTP configuré (dry-run), on
  // retombe sur le premier email de l'identité.
  const baseAddress = env.MAIL_BASE_ADDRESS || env.SMTP_USER || data.emails[0];
  const baseDomain = baseAddress
    ? baseAddress.slice(baseAddress.lastIndexOf("@") + 1)
    : "deletedata.local";

  // Sélection des brokers cibles.
  let targets: BrokerRow[];
  if (opts.brokerSlugs?.length) {
    targets = [];
    for (const slug of opts.brokerSlugs) {
      const b = getBrokerBySlug(slug);
      if (b) targets.push(b);
      else log.warn(`Broker inconnu, ignoré : ${slug}`);
    }
  } else {
    targets = listBrokers({ active: true, channel: opts.channel });
  }

  const now = new Date();
  let batchId = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const skippedReasons: Record<string, number> = {};

  db.transaction((tx) => {
    const batch = tx
      .insert(approvalBatches)
      .values({
        label: opts.label ?? `Lot du ${now.toLocaleString("fr-FR")}`,
        status: "pending",
        count: 0,
      })
      .returning()
      .get();
    batchId = batch.id;

    for (const broker of targets) {
      const existing = tx
        .select()
        .from(requests)
        .where(and(eq(requests.identityId, identity.id), eq(requests.brokerId, broker.id)))
        .get();

      const decision = shouldTarget(existing, {
        retargetDays: env.RETARGET_DAYS,
        force: opts.force,
      });
      if (!decision.target) {
        skipped++;
        skippedReasons[decision.reason] = (skippedReasons[decision.reason] ?? 0) + 1;
        continue;
      }

      const plusAlias = baseAddress ? buildPlusAlias(baseAddress, broker.slug) : null;
      const messageId = `<${randomUUID()}@${baseDomain}>`;
      const rendered = renderGdprErasure({
        brokerName: broker.name,
        identity: data,
        date: now,
        deadline: addOneMonth(now),
        replyTo: plusAlias ?? undefined,
      });

      if (existing) {
        tx
          .update(requests)
          .set({
            batchId: batch.id,
            status: "awaiting_approval",
            channel: broker.channel,
            plusAlias,
            messageId,
            subject: rendered.subject,
            body: rendered.body,
            deadlineAt: null,
            sentAt: null,
          })
          .where(eq(requests.id, existing.id))
          .run();
        updated++;
        audit({
          action: "draft_updated",
          brokerSlug: broker.slug,
          requestId: existing.id,
          fromStatus: existing.status,
          toStatus: "awaiting_approval",
          subject: rendered.subject,
        });
      } else {
        const row = tx
          .insert(requests)
          .values({
            identityId: identity.id,
            brokerId: broker.id,
            batchId: batch.id,
            status: "awaiting_approval",
            confidenceStatus: "pending",
            channel: broker.channel,
            plusAlias,
            messageId,
            subject: rendered.subject,
            body: rendered.body,
          })
          .returning()
          .get();
        created++;
        audit({
          action: "draft_created",
          brokerSlug: broker.slug,
          requestId: row.id,
          toStatus: "awaiting_approval",
          subject: rendered.subject,
        });
      }
    }

    tx
      .update(approvalBatches)
      .set({ count: created + updated })
      .where(eq(approvalBatches.id, batch.id))
      .run();
  });

  audit({ action: "batch_created", detail: { batchId, created, updated, skipped } });
  log.info(
    `Lot #${batchId} : ${created} créés, ${updated} mis à jour, ${skipped} ignorés (anti-spam).`,
  );
  return { batchId, created, updated, skipped, skippedReasons };
}
