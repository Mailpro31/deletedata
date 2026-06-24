/**
 * Pipeline de vérification IMAP en 4 étapes :
 *   1. lecture incrémentale (UID)        -> fetchNewMessages
 *   2. rattachement réponse -> broker     -> attach
 *   3. classification du SENS (LLM)       -> prefilter + Vertex
 *   4. mise à jour + audit                -> ici
 *
 * Règle d'or : `acknowledged` (accusé) NE confirme JAMAIS la suppression.
 * Les mails non rattachables vont dans la file "à revoir" (reviewQueue).
 */
import { eq } from "drizzle-orm";
import { getDb } from "../../db/client";
import { requests, reviewQueue, type BrokerRow, type RequestRow } from "../../db/schema";
import {
  fetchNewMessages,
  setLastSeenUid,
  setUidValidity,
  type ParsedMessage,
} from "./fetchIncremental";
import { attach, loadCandidates } from "./attach";
import { prefilter } from "../classify/prefilter";
import { classifyEmail } from "../classify/vertex";
import { classificationToOutcome } from "../../domain/status";
import { getBrokerById } from "../../brokers/registry";
import { audit } from "../../audit/log";
import { log } from "../../config/logger";
import { truncate } from "../../util/text";
import type { Classification, ConfidenceStatus, Proof, RequestStatus } from "../../domain/types";

export interface VerifyResult {
  fetched: number;
  matched: number;
  unmatched: number;
  confirmed: number;
  acknowledged: number;
  needsInfo: number;
  refused: number;
  unrelated: number;
  errors: number;
}

export interface VerifyOptions {
  /** false => rattachement seulement, sans appel LLM (test sans Vertex). */
  classify?: boolean;
}

function queueForReview(msg: ParsedMessage, reason: string): void {
  getDb()
    .insert(reviewQueue)
    .values({
      emailUid: msg.uid,
      fromAddr: msg.from ?? null,
      toAddr: msg.to.join(", ") || null,
      subject: msg.subject,
      receivedAt: msg.date ?? null,
      snippet: truncate(msg.text, 280),
      reason,
    })
    .run();
}

function applyOutcome(
  request: RequestRow,
  broker: BrokerRow | undefined,
  cls: Classification,
  msg: ParsedMessage,
  res: VerifyResult,
): void {
  const db = getDb();
  const outcome = classificationToOutcome(cls, broker?.requiresIdentityDoc ?? false);

  if (cls === "confirmed_deletion") res.confirmed++;
  else if (cls === "acknowledged") res.acknowledged++;
  else if (cls === "needs_more_info") res.needsInfo++;
  else if (cls === "refused") res.refused++;
  else res.unrelated++;

  if (outcome.noop) {
    audit({
      action: "reply_unrelated",
      brokerSlug: broker?.slug ?? null,
      requestId: request.id,
      detail: { uid: msg.uid },
    });
    return;
  }

  const patch: { status: RequestStatus; confidenceStatus: ConfidenceStatus; proof?: Proof } = {
    status: outcome.status,
    confidenceStatus: outcome.confidenceStatus,
  };
  // PREUVE attachée UNIQUEMENT pour une suppression confirmée.
  if (cls === "confirmed_deletion") {
    patch.proof = {
      type: "email",
      emailUid: msg.uid,
      snippet: truncate(msg.text, 280),
      classifiedAt: new Date().toISOString(),
    };
  }
  db.update(requests).set(patch).where(eq(requests.id, request.id)).run();
  audit({
    action: "reply_classified",
    brokerSlug: broker?.slug ?? null,
    requestId: request.id,
    fromStatus: request.status,
    toStatus: outcome.status,
    subject: msg.subject,
    detail: { classification: cls, confidence: outcome.confidenceStatus, method: msg.uid },
  });
}

export async function runImapVerification(opts: VerifyOptions = {}): Promise<VerifyResult> {
  const doClassify = opts.classify !== false;
  const { uidValidity, messages } = await fetchNewMessages();
  if (uidValidity) setUidValidity(uidValidity);

  const candidates = loadCandidates();
  const res: VerifyResult = {
    fetched: messages.length,
    matched: 0,
    unmatched: 0,
    confirmed: 0,
    acknowledged: 0,
    needsInfo: 0,
    refused: 0,
    unrelated: 0,
    errors: 0,
  };

  for (const msg of messages) {
    try {
      const match = attach(msg, candidates);
      if (!match) {
        queueForReview(msg, "non rattaché à un broker");
        audit({
          action: "reply_unmatched",
          subject: msg.subject,
          detail: { uid: msg.uid, from: msg.from },
        });
        res.unmatched++;
        setLastSeenUid(msg.uid);
        continue;
      }
      res.matched++;
      const broker = getBrokerById(match.request.brokerId);

      let cls: Classification = "unrelated";
      if (doClassify) {
        const pre = prefilter(msg.subject, msg.text);
        if (pre) {
          cls = pre;
        } else {
          try {
            cls = (await classifyEmail(`Sujet: ${msg.subject}\n\n${msg.text}`)).status;
          } catch (e) {
            log.error(`Classification échouée (uid ${msg.uid})`, {
              error: (e as Error).message,
            });
            queueForReview(msg, "classification échouée");
            res.errors++;
            setLastSeenUid(msg.uid);
            continue;
          }
        }
      }

      applyOutcome(match.request, broker, cls, msg, res);
      setLastSeenUid(msg.uid);
    } catch (e) {
      log.error(`Erreur de traitement (uid ${msg.uid})`, { error: (e as Error).message });
      res.errors++;
      setLastSeenUid(msg.uid); // avancer pour ne pas rester bloqué
    }
  }

  audit({ action: "imap_verification_run", detail: { ...res } });
  log.info(
    `Vérification IMAP : ${res.fetched} mail(s), ${res.matched} rattaché(s), ` +
      `${res.confirmed} confirmé(s) supprimé(s), ${res.acknowledged} accusé(s), ${res.unmatched} à revoir.`,
  );
  return res;
}
