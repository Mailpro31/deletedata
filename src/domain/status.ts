/**
 * Logique de statuts : transitions + mapping classification -> issue.
 *
 *  >>> LE GARDE-FOU CENTRAL DE L'OUTIL <<<
 * Un simple accusé de réception (`acknowledged`) NE DOIT JAMAIS être marqué
 * "supprimé". Seul `confirmed_deletion` produit une confiance `confirmed_email`.
 */
import type {
  Classification,
  ConfidenceStatus,
  RequestStatus,
  VerificationMethod,
} from "./types";

export interface Outcome {
  status: RequestStatus;
  confidenceStatus: ConfidenceStatus;
  /** true => la réponse ne change rien (cas `unrelated`). */
  noop?: boolean;
  /** true => action manuelle requise (ex: pièce d'identité). */
  manual?: boolean;
}

/**
 * Mapping classification de réponse -> issue appliquée à la demande.
 * @param requiresIdentityDoc le broker exige-t-il une pièce d'identité ?
 */
export function classificationToOutcome(
  c: Classification,
  requiresIdentityDoc = false,
): Outcome {
  switch (c) {
    case "confirmed_deletion":
      // SEUL cas qui vaut "supprimé" : preuve par email.
      return { status: "confirmed", confidenceStatus: "confirmed_email" };
    case "acknowledged":
      // Accusé de réception => RESTE EN ATTENTE (déclenchera une relance).
      return { status: "acknowledged", confidenceStatus: "pending" };
    case "needs_more_info":
      return {
        status: requiresIdentityDoc ? "manual_required" : "needs_info",
        confidenceStatus: "pending",
        manual: requiresIdentityDoc,
      };
    case "refused":
      return { status: "refused", confidenceStatus: "refused" };
    case "unrelated":
    default:
      return { status: "sent", confidenceStatus: "pending", noop: true };
  }
}

/** Confiance initiale au moment de l'envoi, selon la méthode de vérification. */
export function initialConfidenceOnSend(
  method: VerificationMethod,
): ConfidenceStatus {
  // Aucun moyen de vérifier publiquement -> tracé honnêtement comme invérifiable.
  return method === "none" ? "unverifiable" : "pending";
}

/** Demande "terminée" (plus de relance automatique) ? */
export function isTerminal(status: RequestStatus): boolean {
  return status === "confirmed" || status === "refused";
}

/** Confiance comptant comme "confirmée supprimée" (pour le % honnête). */
export function isConfirmedDeleted(conf: ConfidenceStatus): boolean {
  return conf === "confirmed_email" || conf === "confirmed_rescan";
}

/** Une demande dans ce statut attend-elle encore une réponse (relançable) ? */
export function isAwaitingResponse(status: RequestStatus): boolean {
  return status === "sent" || status === "acknowledged" || status === "reminded";
}

// Transitions autorisées (intégrité). On reste permissif mais on bloque les
// sauts manifestement incohérents (ex: draft -> confirmed sans envoi).
const ALLOWED: Record<RequestStatus, RequestStatus[]> = {
  draft: ["awaiting_approval", "failed"],
  awaiting_approval: ["approved", "draft", "failed"],
  approved: ["queued", "sent", "draft", "failed"],
  queued: ["sent", "failed"],
  sent: [
    "acknowledged",
    "confirmed",
    "refused",
    "needs_info",
    "manual_required",
    "reminded",
    "failed",
  ],
  acknowledged: [
    "confirmed",
    "refused",
    "needs_info",
    "manual_required",
    "reminded",
    "failed",
  ],
  reminded: [
    "acknowledged",
    "confirmed",
    "refused",
    "needs_info",
    "manual_required",
    "failed",
  ],
  needs_info: ["manual_required", "confirmed", "refused", "sent", "failed"],
  manual_required: ["confirmed", "refused", "sent", "failed"],
  confirmed: [], // terminal
  refused: ["sent"], // re-ciblage possible plus tard
  failed: ["draft", "awaiting_approval", "queued", "sent"],
};

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return from === to || (ALLOWED[from]?.includes(to) ?? false);
}
