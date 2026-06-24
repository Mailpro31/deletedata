/**
 * Types et énumérations du domaine (partagés par le schéma DB et la logique).
 *
 * Les énumérations sont des tuples `as const` : on s'en sert à la fois comme
 * valeurs (validation, listes) et comme types union.
 */

// Canal d'envoi d'une demande d'effacement.
export const CHANNELS = ["email", "form", "manual"] as const;
export type Channel = (typeof CHANNELS)[number];

// Juridiction du broker.
export const JURISDICTIONS = ["eu", "us", "global"] as const;
export type Jurisdiction = (typeof JURISDICTIONS)[number];

// Comment ce broker déclare pouvoir être VÉRIFIÉ (chaque broker déclare la sienne).
//  - email  : on attend une confirmation par email (parsing IMAP)
//  - rescan : recherche publique re-scannable (Passe 2, Playwright)
//  - none   : invérifiable -> tracé honnêtement comme tel
export const VERIFICATION_METHODS = ["email", "rescan", "none"] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

// Statut de cycle de vie d'une demande.
export const REQUEST_STATUSES = [
  "draft",
  "awaiting_approval",
  "approved",
  "queued",
  "sent",
  "acknowledged", // accusé de réception (PAS une suppression)
  "confirmed", // suppression confirmée (preuve)
  "refused",
  "needs_info", // le broker demande une vérification d'identité
  "reminded", // relancé après dépassement de la deadline
  "failed",
  "manual_required", // action manuelle nécessaire (ex: pièce d'identité)
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

// Statut de CONFIANCE affiché au tableau de bord (le cœur de l'honnêteté).
export const CONFIDENCE_STATUSES = [
  "pending", // en attente, dans le délai légal
  "reminded", // sans réponse à la deadline -> relance envoyée
  "confirmed_email", // confirmé par email (preuve la plus forte)
  "confirmed_rescan", // confirmé par re-scan (Passe 2)
  "unverifiable", // aucun moyen de vérification public
  "refused", // le broker a refusé
] as const;
export type ConfidenceStatus = (typeof CONFIDENCE_STATUSES)[number];

// Catégories de classification d'une réponse de broker (sortie du LLM).
export const CLASSIFICATIONS = [
  "confirmed_deletion", // les données ONT ÉTÉ supprimées (pas "seront")
  "acknowledged", // accusé de réception / traitement en cours
  "needs_more_info", // demande de vérification d'identité
  "refused",
  "unrelated",
] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

// Statut d'un lot d'approbation.
export const BATCH_STATUSES = ["pending", "approved", "rejected"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

/** Données d'identité (plusieurs variantes de moi-même), stockées en JSON. */
export interface IdentityData {
  /** Variantes de nom : nom légal, anciens noms, fautes d'orthographe, alias. */
  fullNames: string[];
  emails: string[];
  addresses: string[];
  phones?: string[];
  birthDate?: string;
  notes?: string;
}

/** Config de remplissage de formulaire (Passe 2, Playwright). */
export interface FormConfig {
  /** Plusieurs URLs possibles pour un même broker. */
  forms: Array<{
    url: string;
    /** Mapping sélecteur CSS -> action, défini SANS coder. */
    fields: Array<{
      selector: string;
      /** Valeur littérale, ou jeton d'identité (ex: "$email", "$fullName"). */
      value?: string;
      /** Action sur l'élément. */
      action?: "fill" | "check" | "uncheck" | "click" | "select";
    }>;
    submitSelector?: string;
  }>;
}

/** Config de re-scan d'un broker à recherche publique (Passe 2, Playwright). */
export interface RescanConfig {
  /** URL de recherche ; peut contenir des jetons ($firstName, $lastName, $fullName...). */
  searchUrl: string;
  /** Optionnel : remplir un formulaire de recherche avant de lire les résultats. */
  searchForm?: {
    fields: Array<{
      selector: string;
      value?: string;
      action?: "fill" | "select" | "click" | "check";
    }>;
    submitSelector?: string;
  };
  /** Sélecteur dont la PRÉSENCE indique un profil TROUVÉ (encore présent). */
  foundSelector?: string;
  /** Texte dont la présence indique AUCUN résultat (supprimé). */
  notFoundText?: string;
  /** Délai d'attente après chargement/recherche (ms). */
  waitMs?: number;
}

/** Preuve attachée à une demande confirmée. */
export interface Proof {
  type: "email" | "rescan";
  emailUid?: number;
  snippet?: string;
  screenshotPath?: string;
  classifiedAt?: string;
}

/** Entrée du journal d'erreurs d'une demande. */
export interface ErrorEntry {
  at: string;
  message: string;
}
