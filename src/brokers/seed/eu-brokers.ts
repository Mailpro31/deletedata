/**
 * Jeu de brokers CURATÉ (sous-ensemble `active`, prêt à l'envoi).
 *
 * ⚠️ Données best-effort : emails et URLs d'opt-out évoluent souvent. AVANT tout
 * envoi réel, vérifie-les (les garde-fous dry-run + approbation par lot te
 * laissent voir exactement ce qui partira). Corrige au cas par cas via les
 * `overrides` (sans toucher au code).
 *
 * `verificationMethod` :
 *   email  -> on guettera une confirmation par email (parsing IMAP)
 *   rescan -> recherche publique re-scannable (Passe 2)
 *   none   -> invérifiable (ex: nécessite une pièce d'identité)
 */
import type { BrokerInsert } from "../../db/schema";
import type { Channel, Jurisdiction, VerificationMethod } from "../../domain/types";
import { domainFromEmail, domainFromUrl } from "../../util/text";

interface SeedBroker {
  slug: string;
  name: string;
  channel: Channel;
  jurisdiction: Jurisdiction;
  verificationMethod: VerificationMethod;
  optOutUrl?: string;
  email?: string;
  hasPublicSearch?: boolean;
  requiresIdentityDoc?: boolean;
}

const SEED: SeedBroker[] = [
  // --- People-search US (recherche publique -> vérifiable par re-scan) ------
  { slug: "spokeo", name: "Spokeo", channel: "form", jurisdiction: "us", hasPublicSearch: true, verificationMethod: "rescan", optOutUrl: "https://www.spokeo.com/optout" },
  { slug: "beenverified", name: "BeenVerified", channel: "form", jurisdiction: "us", hasPublicSearch: true, verificationMethod: "rescan", optOutUrl: "https://www.beenverified.com/app/optout/search" },
  { slug: "whitepages", name: "Whitepages", channel: "form", jurisdiction: "us", hasPublicSearch: true, verificationMethod: "rescan", optOutUrl: "https://www.whitepages.com/suppression-requests" },
  { slug: "intelius", name: "Intelius", channel: "form", jurisdiction: "us", hasPublicSearch: true, verificationMethod: "rescan", optOutUrl: "https://www.intelius.com/opt-out/submit/" },
  { slug: "peoplefinders", name: "PeopleFinders", channel: "form", jurisdiction: "us", hasPublicSearch: true, verificationMethod: "rescan", optOutUrl: "https://www.peoplefinders.com/opt-out" },
  { slug: "radaris", name: "Radaris", channel: "form", jurisdiction: "us", hasPublicSearch: true, verificationMethod: "rescan", optOutUrl: "https://radaris.com/control/privacy" },
  { slug: "mylife", name: "MyLife", channel: "form", jurisdiction: "us", hasPublicSearch: true, verificationMethod: "rescan", optOutUrl: "https://www.mylife.com/ccpa/index.pubview" },
  { slug: "truepeoplesearch", name: "TruePeopleSearch", channel: "form", jurisdiction: "us", hasPublicSearch: true, verificationMethod: "rescan", optOutUrl: "https://www.truepeoplesearch.com/removal" },

  // --- Adtech / data-marketing (opt-out RGPD par email privacy@) -----------
  { slug: "criteo", name: "Criteo", channel: "email", jurisdiction: "eu", verificationMethod: "email", email: "privacy@criteo.com", optOutUrl: "https://www.criteo.com/privacy/" },
  { slug: "liveramp", name: "LiveRamp", channel: "email", jurisdiction: "global", verificationMethod: "email", email: "privacy@liveramp.com", optOutUrl: "https://liveramp.com/opt_out/" },
  { slug: "quantcast", name: "Quantcast", channel: "email", jurisdiction: "eu", verificationMethod: "email", email: "privacy@quantcast.com" },
  { slug: "outbrain", name: "Outbrain", channel: "email", jurisdiction: "global", verificationMethod: "email", email: "privacy@outbrain.com", optOutUrl: "https://www.outbrain.com/privacy/interest-based-ads-opt-out/" },
  { slug: "taboola", name: "Taboola", channel: "email", jurisdiction: "global", verificationMethod: "email", email: "privacy@taboola.com" },
  { slug: "lotame", name: "Lotame", channel: "email", jurisdiction: "global", verificationMethod: "email", email: "privacy@lotame.com", optOutUrl: "https://www.lotame.com/about-lotame/privacy/lotames-opt-out/" },
  { slug: "adform", name: "Adform", channel: "email", jurisdiction: "eu", verificationMethod: "email", email: "privacy@adform.com" },

  // --- Data brokers "form", sans recherche publique (souvent invérifiables) -
  { slug: "acxiom", name: "Acxiom", channel: "form", jurisdiction: "global", verificationMethod: "email", optOutUrl: "https://www.acxiom.com/optout/" },
  { slug: "epsilon", name: "Epsilon", channel: "form", jurisdiction: "global", verificationMethod: "none", optOutUrl: "https://www.epsilon.com/us/consumer-information" },

  // --- Annuaires / FR-EU ----------------------------------------------------
  { slug: "pagesjaunes", name: "PagesJaunes (Solocal)", channel: "form", jurisdiction: "eu", hasPublicSearch: true, verificationMethod: "rescan", optOutUrl: "https://www.pagesjaunes.fr/aide/comment-supprimer-mes-coordonnees" },

  // --- Credit / identité : action manuelle (pièce d'identité requise) -------
  { slug: "lexisnexis", name: "LexisNexis", channel: "manual", jurisdiction: "global", verificationMethod: "none", requiresIdentityDoc: true, optOutUrl: "https://optout.lexisnexis.com/" },
  { slug: "experian", name: "Experian", channel: "manual", jurisdiction: "global", verificationMethod: "none", requiresIdentityDoc: true, optOutUrl: "https://www.experian.com/privacy/center" },
  { slug: "equifax", name: "Equifax", channel: "manual", jurisdiction: "global", verificationMethod: "none", requiresIdentityDoc: true, optOutUrl: "https://www.equifax.com/personal/privacy/" },
  { slug: "transunion", name: "TransUnion", channel: "manual", jurisdiction: "global", verificationMethod: "none", requiresIdentityDoc: true, optOutUrl: "https://www.transunion.com/optout" },
  { slug: "oracle-data-cloud", name: "Oracle Advertising", channel: "manual", jurisdiction: "global", verificationMethod: "none", optOutUrl: "https://www.oracle.com/legal/privacy/" },
];

function toInsert(s: SeedBroker): BrokerInsert {
  const emailDomain = s.email
    ? domainFromEmail(s.email)
    : s.optOutUrl
      ? domainFromUrl(s.optOutUrl)
      : undefined;
  return {
    slug: s.slug,
    name: s.name,
    optOutUrl: s.optOutUrl ?? null,
    email: s.email ?? null,
    emailDomain: emailDomain ?? null,
    channel: s.channel,
    jurisdiction: s.jurisdiction,
    hasPublicSearch: s.hasPublicSearch ?? false,
    verificationMethod: s.verificationMethod,
    requiresIdentityDoc: s.requiresIdentityDoc ?? false,
    source: "seed-eu",
    sourceLicense: "curated",
    active: true,
  };
}

export function seedBrokers(): BrokerInsert[] {
  return SEED.map(toInsert);
}
