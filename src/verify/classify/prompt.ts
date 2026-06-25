/**
 * Prompt de classification (concis pour économiser des tokens).
 *
 * PIÈGE CRITIQUE encodé dans le prompt : « nous supprimerons / we will delete »
 * = `acknowledged`, surtout PAS `confirmed_deletion`. Seul un effacement DÉJÀ
 * RÉALISÉ vaut `confirmed_deletion`.
 */
export const SYSTEM_INSTRUCTION =
  "Tu classes le SENS d'un email reçu en réponse à une demande d'effacement RGPD. " +
  "Réponds en JSON STRICT et UNIQUEMENT {\"status\":\"<catégorie>\"}, sans autre texte.";

export function buildPrompt(emailText: string): string {
  return [
    "Catégories :",
    "- confirmed_deletion : les données ONT ÉTÉ supprimées (action accomplie, au passé).",
    "- acknowledged : accusé de réception / pris en compte / en cours (PAS encore supprimé).",
    "- needs_more_info : demande de vérification d'identité ou d'informations complémentaires.",
    "- refused : la demande est refusée.",
    "- unrelated : sans rapport avec une demande d'effacement.",
    "",
    'RÈGLE : « nous supprimerons » / « we will delete » => acknowledged (PAS confirmed_deletion).',
    "Seul un effacement déjà effectué => confirmed_deletion.",
    "",
    "Email :",
    '"""',
    emailText,
    '"""',
  ].join("\n");
}
