/**
 * Heuristiques de normalisation RawBroker -> ligne `brokers`.
 *
 * Aucune source open-source n'encode proprement le `channel` (email/form/manual)
 * ni `hasPublicSearch` : on les INFÈRE ici, prudemment. La curation manuelle
 * (passage en `active`) et les overrides corrigent au cas par cas.
 */
import type { BrokerInsert } from "../../db/schema";
import type { Channel, Jurisdiction, VerificationMethod } from "../../domain/types";
import type { RawBroker } from "./types";
import { domainFromEmail, domainFromUrl } from "../../util/text";

export function inferJurisdiction(region?: string): Jurisdiction {
  const r = (region ?? "").toLowerCase();
  if (r.startsWith("eu") || r.includes("europe") || r === "gdpr") return "eu";
  if (r === "us" || r === "usa" || r.startsWith("us")) return "us";
  return "global";
}

export function inferPublicSearch(category?: string): boolean {
  const c = (category ?? "").toLowerCase();
  if (c.includes("background")) return false; // pas de recherche publique
  return (
    c.includes("people") ||
    c.includes("search") ||
    c.includes("directory") ||
    c.includes("marketing")
  );
}

export function inferChannel(raw: RawBroker): Channel {
  // background-check / pièce d'identité -> action manuelle (pas d'auto fiable).
  if (raw.requiresIdentityDoc) return "manual";
  if ((raw.category ?? "").toLowerCase().includes("background")) return "manual";
  if (raw.email && !raw.optOutUrl) return "email";
  if (raw.optOutUrl) return "form";
  if (raw.email) return "email";
  return "manual";
}

export function inferVerification(
  channel: Channel,
  hasPublicSearch: boolean,
  raw: RawBroker,
): VerificationMethod {
  if (raw.requiresIdentityDoc) return "none";
  if (channel === "email") return "email"; // on attend une confirmation email
  if (hasPublicSearch) return "rescan"; // re-scan public possible (Passe 2)
  return "none"; // honnêtement invérifiable
}

export function normalizeBroker(raw: RawBroker): BrokerInsert {
  const channel = inferChannel(raw);
  const jurisdiction = inferJurisdiction(raw.region);
  const hasPublicSearch = inferPublicSearch(raw.category);
  const verificationMethod = inferVerification(channel, hasPublicSearch, raw);
  const emailDomain = raw.email
    ? domainFromEmail(raw.email)
    : raw.optOutUrl
      ? domainFromUrl(raw.optOutUrl)
      : undefined;

  return {
    slug: raw.slug,
    name: raw.name,
    optOutUrl: raw.optOutUrl ?? null,
    email: raw.email ?? null,
    emailDomain: emailDomain ?? null,
    channel,
    jurisdiction,
    hasPublicSearch,
    verificationMethod,
    requiresIdentityDoc: raw.requiresIdentityDoc ?? false,
    source: raw.source,
    sourceLicense: raw.sourceLicense,
    active: false, // l'import n'active jamais : curation explicite requise.
  };
}
