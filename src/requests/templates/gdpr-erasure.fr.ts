/**
 * Template de demande d'effacement RGPD (français), art. 17 + art. 15.
 * Rendu en texte brut : sujet + corps. Aucune donnée n'est inventée ; on
 * n'inclut que les variantes d'identité fournies par l'utilisateur.
 */
import type { IdentityData } from "../../domain/types";

export interface TemplateInput {
  brokerName: string;
  identity: IdentityData;
  date: Date;
  deadline: Date;
  /** Adresse de réponse souhaitée (alias plus-addressing). */
  replyTo?: string;
}

export interface RenderedEmail {
  subject: string;
  body: string;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("fr-FR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function bulletList(label: string, items: string[]): string {
  const clean = items.map((s) => s.trim()).filter(Boolean);
  if (clean.length === 0) return "";
  return `${label} :\n${clean.map((s) => `  - ${s}`).join("\n")}\n`;
}

export function renderGdprErasure(input: TemplateInput): RenderedEmail {
  const { brokerName, identity, date, deadline } = input;
  const primaryName = identity.fullNames[0] ?? "(nom non renseigné)";

  const subject = `Demande d'effacement de mes données personnelles (RGPD art. 17) — ${primaryName}`;

  const idBlock = [
    bulletList("Nom(s) et variantes", identity.fullNames),
    bulletList("Adresse(s) email", identity.emails),
    bulletList("Adresse(s) postale(s)", identity.addresses),
    identity.phones?.length ? bulletList("Téléphone(s)", identity.phones) : "",
    identity.birthDate ? `Date de naissance : ${identity.birthDate}\n` : "",
  ]
    .filter(Boolean)
    .join("");

  const body = `Madame, Monsieur,

J'exerce par la présente mon droit à l'effacement de mes données à caractère
personnel, prévu à l'article 17 du Règlement général sur la protection des
données (RGPD - Règlement UE 2016/679), ainsi que mon droit d'accès prévu à
l'article 15.

Je vous demande de :
  1. Supprimer l'ensemble des données à caractère personnel me concernant que
     ${brokerName} détient, traite ou a partagées avec des tiers ;
  2. Cesser tout traitement et toute commercialisation de ces données ;
  3. Communiquer ma demande à tout sous-traitant ou tiers à qui vous auriez
     transmis ces données (art. 19 RGPD) ;
  4. Me CONFIRMER PAR ÉCRIT, à l'adresse depuis laquelle vous recevez ce
     message, que l'effacement a bien été RÉALISÉ (et non simplement « pris en
     compte »).

Données permettant de m'identifier dans vos fichiers :
${idBlock}
Conformément à l'article 12.3 du RGPD, vous disposez d'un délai d'UN MOIS à
compter de la réception de cette demande, soit au plus tard le ${fmtDate(
    deadline,
  )}, pour y répondre.

À défaut de réponse satisfaisante dans ce délai, je me réserve le droit
d'introduire une réclamation auprès de la CNIL (Commission Nationale de
l'Informatique et des Libertés) ou de l'autorité de contrôle compétente.

Je vous remercie de traiter cette demande avec la diligence requise.

Fait le ${fmtDate(date)}.

${primaryName}`;

  return { subject, body };
}
