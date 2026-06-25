/**
 * Anti-spam : décide si l'on doit (re)cibler un broker.
 *
 * On ne renvoie PAS tout à chaque cycle. On (re)cible seulement si :
 *   - aucune demande existante, OU
 *   - la demande est encore dans le pipeline (brouillon / à approuver), OU
 *   - le délai de re-ciblage est écoulé depuis le dernier envoi.
 * Une suppression déjà confirmée n'est jamais re-ciblée (sauf `force`, ou
 * réacquisition détectée -> Passe 2).
 */
import type { RequestRow } from "../db/schema";
import { isConfirmedDeleted } from "../domain/status";

export interface TargetDecision {
  target: boolean;
  reason: string;
}

function daysSince(d: Date | null | undefined): number {
  if (!d) return Number.POSITIVE_INFINITY;
  return (Date.now() - d.getTime()) / 86_400_000;
}

export function shouldTarget(
  existing: RequestRow | undefined,
  opts: { retargetDays: number; force?: boolean },
): TargetDecision {
  if (opts.force) return { target: true, reason: "force" };
  if (!existing) return { target: true, reason: "nouveau" };

  if (isConfirmedDeleted(existing.confidenceStatus)) {
    return { target: false, reason: "déjà confirmé supprimé" };
  }

  if (
    existing.status === "draft" ||
    existing.status === "awaiting_approval" ||
    existing.status === "approved" ||
    existing.status === "failed"
  ) {
    return { target: true, reason: "encore dans le pipeline" };
  }

  const since = daysSince(existing.sentAt ?? existing.updatedAt);
  if (since >= opts.retargetDays) {
    return { target: true, reason: `délai écoulé (${Math.floor(since)} j)` };
  }
  return {
    target: false,
    reason: `récent (${Math.floor(since)} j < ${opts.retargetDays} j)`,
  };
}
