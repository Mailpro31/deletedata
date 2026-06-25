/**
 * Envoi des demandes APPROUVÉES par email (SMTP).
 *
 *  GARDE-FOUS :
 *   - DRY-RUN par défaut : on logue l'email rendu, on N'ENVOIE RIEN.
 *   - LIVE seulement si DRY_RUN=false ET LIVE_CONFIRM=I_UNDERSTAND (double verrou).
 *   - From + Reply-To = alias plus-addressing -> la réponse revient sur l'alias.
 *   - Retry avec backoff exponentiel + jitter sur échec SMTP transitoire.
 *
 *  Canaux non-email en Passe 1 :
 *   - `form`   : remplissage automatique = Passe 2 -> tracé "action manuelle".
 *   - `manual` : action manuelle requise (ex: pièce d'identité).
 */
import nodemailer, { type Transporter } from "nodemailer";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client";
import { requests, type RequestRow } from "../db/schema";
import { getBrokerById } from "../brokers/registry";
import { getIdentity } from "../identity/service";
import { env, isLive, assertLive, requireSmtp } from "../config/env";
import { initialConfidenceOnSend } from "../domain/status";
import { audit } from "../audit/log";
import { log } from "../config/logger";

export interface SendOptions {
  batchId?: number;
  requestIds?: number[];
  max?: number;
}

export interface SendSummary {
  total: number;
  sent: number;
  formsSubmitted: number;
  simulated: number;
  manual: number;
  failed: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function addOneMonth(d: Date): Date {
  const n = new Date(d);
  n.setMonth(n.getMonth() + 1);
  return n;
}

export async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const retries = 4;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      attempt++;
      if (attempt > retries) throw e;
      const delay = Math.min(16_000, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
      log.warn(`Échec (${label}), nouvel essai ${attempt}/${retries} dans ${delay} ms`, {
        error: (e as Error).message,
      });
      await sleep(delay);
    }
  }
}

let transporter: Transporter | null = null;
export function getTransporter(): Transporter {
  if (transporter) return transporter;
  const s = requireSmtp();
  transporter = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    auth: { user: s.user, pass: s.pass },
  });
  return transporter;
}

/** Vérifie la connexion SMTP (pour `test-connections`). */
export async function verifySmtp(): Promise<void> {
  await getTransporter().verify();
}

function appendError(r: RequestRow, message: string): void {
  const db = getDb();
  const errs = [...(r.errorLog ?? []), { at: new Date().toISOString(), message }];
  db.update(requests)
    .set({ status: "failed", errorLog: errs })
    .where(eq(requests.id, r.id))
    .run();
  audit({
    action: "request_failed",
    requestId: r.id,
    fromStatus: r.status,
    toStatus: "failed",
    detail: { message },
  });
  log.error(`Échec demande #${r.id} : ${message}`);
}

export async function sendApproved(opts: SendOptions = {}): Promise<SendSummary> {
  const db = getDb();
  const conds = [eq(requests.status, "approved")];
  if (opts.batchId !== undefined) conds.push(eq(requests.batchId, opts.batchId));
  if (opts.requestIds?.length) conds.push(inArray(requests.id, opts.requestIds));
  let rows = db.select().from(requests).where(and(...conds)).all();
  if (opts.max) rows = rows.slice(0, opts.max);

  const live = isLive();
  if (live) {
    assertLive(); // re-vérifie le double verrou
    log.warn(
      "⚠️  MODE ENVOI RÉEL : des emails vont PARTIR sous ton nom. (DRY_RUN=false + LIVE_CONFIRM=I_UNDERSTAND)",
    );
  } else {
    log.info(
      "Mode DRY-RUN : AUCUN email ne part. Les demandes sont seulement simulées et loguées.",
    );
  }

  const summary: SendSummary = {
    total: rows.length,
    sent: 0,
    formsSubmitted: 0,
    simulated: 0,
    manual: 0,
    failed: 0,
  };

  for (const r of rows) {
    const broker = getBrokerById(r.brokerId);
    if (!broker) {
      appendError(r, "broker introuvable");
      summary.failed++;
      continue;
    }

    // --- Canal manuel : action manuelle requise (jamais automatisé) --------
    if (r.channel === "manual") {
      const reason = broker.requiresIdentityDoc
        ? "pièce d'identité requise"
        : "action manuelle requise";
      summary.manual++;
      if (!live) {
        log.info(`[DRY-RUN] action manuelle requise — ${broker.name} : ${reason}`);
        continue;
      }
      db.update(requests).set({ status: "manual_required" }).where(eq(requests.id, r.id)).run();
      audit({
        action: "request_manual_required",
        brokerSlug: broker.slug,
        requestId: r.id,
        fromStatus: r.status,
        toStatus: "manual_required",
        detail: { optOutUrl: broker.optOutUrl, reason },
      });
      log.info(`Action manuelle — ${broker.name} : ${reason}`);
      continue;
    }

    // --- Canal formulaire : remplissage auto Playwright (si config) --------
    if (r.channel === "form") {
      if (!broker.formConfig?.forms?.length) {
        // Sans config de formulaire, on ne peut pas automatiser -> action manuelle.
        summary.manual++;
        if (!live) {
          log.info(`[DRY-RUN] formulaire sans config -> action manuelle — ${broker.name}`);
          continue;
        }
        db.update(requests).set({ status: "manual_required" }).where(eq(requests.id, r.id)).run();
        audit({
          action: "request_manual_required",
          brokerSlug: broker.slug,
          requestId: r.id,
          fromStatus: r.status,
          toStatus: "manual_required",
          detail: { optOutUrl: broker.optOutUrl, reason: "formulaire sans config" },
        });
        continue;
      }
      if (!live) {
        log.info(`[DRY-RUN] remplirait + soumettrait le(s) formulaire(s) de ${broker.name}`);
        summary.simulated++;
        continue;
      }
      const identity = getIdentity(r.identityId);
      if (!identity) {
        appendError(r, "identité introuvable pour le formulaire");
        summary.failed++;
        continue;
      }
      try {
        const { fillBrokerForms } = await import("../forms/fill");
        const results = await fillBrokerForms(broker, identity.data, r.plusAlias, { submit: true });
        if (results.every((x) => x.ok && x.submitted)) {
          const now = new Date();
          const deadline = addOneMonth(now);
          db.update(requests)
            .set({
              status: "sent",
              confidenceStatus: initialConfidenceOnSend(broker.verificationMethod),
              sentAt: now,
              deadlineAt: deadline,
            })
            .where(eq(requests.id, r.id))
            .run();
          audit({
            action: "request_form_submitted",
            brokerSlug: broker.slug,
            requestId: r.id,
            fromStatus: r.status,
            toStatus: "sent",
            detail: { results },
          });
          log.info(`Formulaire(s) soumis -> ${broker.name}`);
          summary.formsSubmitted++;
        } else {
          const msg =
            results.filter((x) => !x.ok).map((x) => x.error).join(" ; ") || "soumission incomplète";
          appendError(r, `formulaire: ${msg}`);
          audit({ action: "request_form_failed", brokerSlug: broker.slug, requestId: r.id, detail: { results } });
          summary.failed++;
        }
      } catch (e) {
        appendError(r, `formulaire: ${(e as Error).message}`);
        summary.failed++;
      }
      continue;
    }

    // --- Canal email -------------------------------------------------------
    const to = broker.email;
    if (!to) {
      appendError(r, "aucune adresse email pour ce broker (canal email)");
      summary.failed++;
      continue;
    }

    const from = r.plusAlias ?? env.MAIL_BASE_ADDRESS ?? env.SMTP_USER ?? "";
    const fromHeader = env.MAIL_FROM_NAME ? `${env.MAIL_FROM_NAME} <${from}>` : from;

    if (!live) {
      log.info(`[DRY-RUN] enverrait -> ${broker.name} <${to}>`, {
        from: fromHeader,
        replyTo: r.plusAlias,
        subject: r.subject,
        messageId: r.messageId,
      });
      audit({
        action: "send_simulated",
        brokerSlug: broker.slug,
        requestId: r.id,
        subject: r.subject ?? null,
        detail: { to, from: fromHeader },
      });
      summary.simulated++;
      continue;
    }

    try {
      const transport = getTransporter();
      const info = await withRetry(
        () =>
          transport.sendMail({
            from: fromHeader,
            to,
            replyTo: r.plusAlias ?? undefined,
            subject: r.subject ?? "Demande d'effacement de mes données (RGPD art. 17)",
            text: r.body ?? "",
            messageId: r.messageId ?? undefined,
          }),
        `email ${broker.slug}`,
      );
      const now = new Date();
      const deadline = addOneMonth(now);
      db.update(requests)
        .set({
          status: "sent",
          confidenceStatus: initialConfidenceOnSend(broker.verificationMethod),
          sentAt: now,
          deadlineAt: deadline,
        })
        .where(eq(requests.id, r.id))
        .run();
      audit({
        action: "request_sent",
        brokerSlug: broker.slug,
        requestId: r.id,
        fromStatus: r.status,
        toStatus: "sent",
        subject: r.subject ?? null,
        detail: { to, messageId: info.messageId },
      });
      log.info(
        `Envoyé -> ${broker.name} <${to}> (deadline ${deadline.toLocaleDateString("fr-FR")})`,
      );
      summary.sent++;
    } catch (e) {
      appendError(r, (e as Error).message);
      summary.failed++;
    }
  }

  audit({ action: live ? "send_run" : "send_run_dryrun", detail: { ...summary } });
  return summary;
}
