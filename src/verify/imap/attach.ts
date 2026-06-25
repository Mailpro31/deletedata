/**
 * Rattachement réponse -> demande/broker, par ordre de fiabilité décroissante :
 *   1. plus-address (alias `local+slug@` dans les destinataires)  [le plus sûr]
 *   2. domaine de l'expéditeur == emailDomain du broker
 *   3. threading (In-Reply-To / References == Message-ID envoyé)
 */
import { eq, isNotNull, or } from "drizzle-orm";
import { getDb } from "../../db/client";
import { brokers, requests, type RequestRow } from "../../db/schema";
import { extractSlugFromPlusAlias } from "../../send/plusAddress";
import { domainFromEmail } from "../../util/text";
import type { ParsedMessage } from "./fetchIncremental";

export interface Candidate {
  request: RequestRow;
  brokerSlug: string;
  emailDomain: string | null;
}

export type MatchMethod = "plus-address" | "sender-domain" | "threading";

export interface Match {
  request: RequestRow;
  brokerSlug: string;
  method: MatchMethod;
}

/** Charge les demandes susceptibles de recevoir une réponse (alias ou Message-ID posé). */
export function loadCandidates(): Candidate[] {
  const db = getDb();
  const rows = db
    .select({ request: requests, slug: brokers.slug, emailDomain: brokers.emailDomain })
    .from(requests)
    .innerJoin(brokers, eq(requests.brokerId, brokers.id))
    .where(or(isNotNull(requests.plusAlias), isNotNull(requests.messageId)))
    .all();
  return rows.map((r) => ({
    request: r.request,
    brokerSlug: r.slug,
    emailDomain: r.emailDomain,
  }));
}

export function attach(msg: ParsedMessage, candidates: Candidate[]): Match | null {
  const recipients = new Set(msg.to.map((a) => a.toLowerCase()));

  // 1) plus-address : égalité directe de l'alias.
  for (const c of candidates) {
    if (c.request.plusAlias && recipients.has(c.request.plusAlias.toLowerCase())) {
      return { request: c.request, brokerSlug: c.brokerSlug, method: "plus-address" };
    }
  }
  // 1bis) slug extrait d'un alias présent dans les destinataires.
  for (const addr of recipients) {
    const slug = extractSlugFromPlusAlias(addr);
    if (!slug) continue;
    const c = candidates.find((x) => x.brokerSlug === slug);
    if (c) return { request: c.request, brokerSlug: c.brokerSlug, method: "plus-address" };
  }

  // 2) domaine de l'expéditeur.
  if (msg.from) {
    const dom = domainFromEmail(msg.from);
    if (dom) {
      const matches = candidates.filter(
        (c) => c.emailDomain && c.emailDomain.toLowerCase() === dom,
      );
      if (matches.length > 0) {
        matches.sort(
          (a, b) =>
            (b.request.sentAt?.getTime() ?? 0) - (a.request.sentAt?.getTime() ?? 0),
        );
        const best = matches[0]!;
        return { request: best.request, brokerSlug: best.brokerSlug, method: "sender-domain" };
      }
    }
  }

  // 3) threading.
  const refs = new Set(
    [msg.inReplyTo, ...msg.references].filter((x): x is string => Boolean(x)),
  );
  if (refs.size > 0) {
    for (const c of candidates) {
      if (c.request.messageId && refs.has(c.request.messageId)) {
        return { request: c.request, brokerSlug: c.brokerSlug, method: "threading" };
      }
    }
  }

  return null;
}
