/**
 * Substitution de jetons d'identité dans les valeurs de formulaire.
 * Permet d'écrire la config SANS coder : `value: "$email"`, `"$fullName"`, etc.
 */
import type { IdentityData } from "../domain/types";

/** Construit la table des jetons à partir de l'identité (+ alias plus-addressing). */
export function buildTokenMap(
  identity: IdentityData,
  plusAlias?: string | null,
): Record<string, string> {
  const fullName = identity.fullNames[0] ?? "";
  const parts = fullName.split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? "";
  const lastName = parts.slice(1).join(" ");
  return {
    $fullName: fullName,
    $firstName: firstName,
    $lastName: lastName,
    // $email = alias plus-addressing si dispo (traçable), sinon email principal.
    $email: plusAlias || identity.emails[0] || "",
    $primaryEmail: identity.emails[0] ?? "",
    $plusAlias: plusAlias ?? "",
    $address: identity.addresses[0] ?? "",
    $phone: identity.phones?.[0] ?? "",
    $birthDate: identity.birthDate ?? "",
  };
}

/** Remplace les jetons `$xxx` connus dans une valeur ; laisse le reste intact. */
export function resolveValue(value: string, tokens: Record<string, string>): string {
  return value.replace(/\$[a-zA-Z]+/g, (m) => (m in tokens ? tokens[m]! : m));
}
