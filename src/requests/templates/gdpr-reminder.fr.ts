/**
 * Template de RELANCE (français) : suit une demande d'effacement restée sans
 * réponse satisfaisante passé le délai légal d'un mois.
 */
import type { IdentityData } from "../../domain/types";
import type { RenderedEmail } from "./gdpr-erasure.fr";

export interface ReminderInput {
  brokerName: string;
  identity: IdentityData;
  originalDate?: Date;
  newDeadline: Date;
  reminderCount: number;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" });
}

export function renderReminder(input: ReminderInput): RenderedEmail {
  const { brokerName, identity, originalDate, newDeadline, reminderCount } = input;
  const name = identity.fullNames[0] ?? "(nom non renseigné)";
  const since = originalDate ? ` du ${fmtDate(originalDate)}` : "";

  const subject = `RELANCE — Demande d'effacement RGPD (art. 17) restée sans réponse — ${name}`;

  const body = `Madame, Monsieur,

Je fais suite à ma demande d'effacement de mes données personnelles${since}
(RGPD, art. 17), restée sans confirmation de suppression au-delà du délai légal
d'UN MOIS prévu à l'article 12.3 du RGPD.

Il s'agit de ma relance n°${reminderCount}. Je vous demande de nouveau de :
  1. Supprimer toutes les données me concernant et d'en cesser tout traitement ;
  2. Me CONFIRMER PAR ÉCRIT que l'effacement a été RÉALISÉ.

À défaut de réponse satisfaisante d'ici le ${fmtDate(newDeadline)}, je saisirai la
CNIL (ou l'autorité de contrôle compétente) d'une réclamation pour non-respect de
mes droits.

Cordialement,
${name}`;

  return { subject, body };
}
