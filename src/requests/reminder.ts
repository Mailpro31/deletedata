/**
 * Relances automatiques : pour les demandes EMAIL en attente dont la deadline
 * d'un mois est dépassée, on envoie une relance (mêmes garde-fous dry-run/live).
 * Plafonné (MAX_REMINDERS) avec un intervalle minimal entre deux relances.
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client";
import { requests } from "../db/schema";
import { getBrokerById } from "../brokers/registry";
import { getIdentity } from "../identity/service";
import { env, isLive, assertLive } from "../config/env";
import { getTransporter, withRetry } from "../send/email";
import { renderReminder } from "./templates/gdpr-reminder.fr";
import { audit } from "../audit/log";
import { log } from "../config/logger";

const MAX_REMINDERS = 2;
const MIN_GAP_DAYS = 14;

function addOneMonth(d: Date): Date {
  const n = new Date(d);
  n.setMonth(n.getMonth() + 1);
  return n;
}
const daysSince = (d: Date) => (Date.now() - d.getTime()) / 86_400_000;

export interface ReminderSummary {
  candidates: number;
  sent: number;
  simulated: number;
  skipped: number;
  failed: number;
}

export async function sendReminders(opts: { max?: number } = {}): Promise<ReminderSummary> {
  const db = getDb();
  const now = Date.now();

  const pending = db
    .select()
    .from(requests)
    .where(
      and(inArray(requests.status, ["sent", "acknowledged"]), eq(requests.confidenceStatus, "pending")),
    )
    .all();

  let candidates = pending.filter(
    (r) =>
      r.channel === "email" &&
      r.deadlineAt &&
      r.deadlineAt.getTime() < now &&
      r.reminderCount < MAX_REMINDERS &&
      (!r.lastReminderAt || daysSince(r.lastReminderAt) >= MIN_GAP_DAYS),
  );
  if (opts.max) candidates = candidates.slice(0, opts.max);

  const live = isLive();
  if (live) assertLive();
  else log.info("Relances en DRY-RUN : rien n'est envoyé, seulement simulé.");

  const summary: ReminderSummary = {
    candidates: candidates.length,
    sent: 0,
    simulated: 0,
    skipped: 0,
    failed: 0,
  };

  for (const r of candidates) {
    const broker = getBrokerById(r.brokerId);
    const identity = getIdentity(r.identityId);
    if (!broker || !broker.email || !identity) {
      summary.skipped++;
      continue;
    }

    const newDeadline = addOneMonth(new Date());
    const rendered = renderReminder({
      brokerName: broker.name,
      identity: identity.data,
      originalDate: r.sentAt ?? undefined,
      newDeadline,
      reminderCount: r.reminderCount + 1,
    });
    const from = r.plusAlias ?? env.MAIL_BASE_ADDRESS ?? env.SMTP_USER ?? "";
    const fromHeader = env.MAIL_FROM_NAME ? `${env.MAIL_FROM_NAME} <${from}>` : from;

    if (!live) {
      log.info(`[DRY-RUN] relancerait -> ${broker.name} <${broker.email}>`);
      audit({ action: "reminder_simulated", brokerSlug: broker.slug, requestId: r.id });
      summary.simulated++;
      continue;
    }

    try {
      await withRetry(
        () =>
          getTransporter().sendMail({
            from: fromHeader,
            to: broker.email!,
            replyTo: r.plusAlias ?? undefined,
            subject: rendered.subject,
            text: rendered.body,
            inReplyTo: r.messageId ?? undefined,
            references: r.messageId ?? undefined,
          }),
        `reminder ${broker.slug}`,
      );
      db.update(requests)
        .set({
          status: "reminded",
          confidenceStatus: "reminded",
          reminderCount: r.reminderCount + 1,
          lastReminderAt: new Date(),
          deadlineAt: newDeadline,
        })
        .where(eq(requests.id, r.id))
        .run();
      audit({
        action: "reminder_sent",
        brokerSlug: broker.slug,
        requestId: r.id,
        fromStatus: r.status,
        toStatus: "reminded",
        detail: { reminderCount: r.reminderCount + 1 },
      });
      log.info(`Relance -> ${broker.name} (n°${r.reminderCount + 1})`);
      summary.sent++;
    } catch (e) {
      log.error(`Relance échouée (${broker.slug})`, { error: (e as Error).message });
      audit({ action: "reminder_failed", brokerSlug: broker.slug, requestId: r.id, detail: { message: (e as Error).message } });
      summary.failed++;
    }
  }

  audit({ action: live ? "reminder_run" : "reminder_run_dryrun", detail: { ...summary } });
  return summary;
}
