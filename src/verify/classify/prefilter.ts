/**
 * Pré-filtre regex OPTIONNEL pour économiser des appels LLM.
 *
 * VOLONTAIREMENT TRÈS PRUDENT : on ne pré-classe QUE des cas évidents et sans
 * ambiguïté de SENS (auto-réponses, échecs de remise) -> `unrelated`. On ne
 * pré-confirme JAMAIS une suppression (le cas dangereux) : toute formulation de
 * suppression est laissée au LLM, car « will delete » ≠ « have deleted ».
 */
import type { Classification } from "../../domain/types";

export function prefilter(subject: string, text: string): Classification | null {
  const s = `${subject}\n${text}`.toLowerCase();

  if (
    /\bout of office\b|réponse automatique|auto-?reply|automatic reply|absence du bureau|congés|on vacation/.test(
      s,
    )
  ) {
    return "unrelated";
  }
  if (
    /mail delivery (failed|subsystem)|delivery status notification|undeliverable|message non (remis|distribué)|adresse (introuvable|inexistante)/.test(
      s,
    )
  ) {
    return "unrelated";
  }
  // Tout le reste : trop ambigu pour la regex -> on délègue au LLM.
  return null;
}
