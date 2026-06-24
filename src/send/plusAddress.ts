/**
 * Plus-addressing : `local+broker-slug@domaine`.
 *
 * À l'envoi, on met cet alias en From/Reply-To. La réponse du broker arrive
 * donc avec l'alias dans le champ "To" -> rattachement immédiat et fiable.
 * Gmail (et beaucoup d'autres) route tout `local+xxx@` vers `local@`.
 */

/** Construit l'alias pour un broker à partir de l'adresse de base. */
export function buildPlusAlias(baseAddress: string, slug: string): string {
  const at = baseAddress.lastIndexOf("@");
  if (at < 0) return baseAddress;
  const localFull = baseAddress.slice(0, at);
  const domain = baseAddress.slice(at + 1);
  const local = localFull.split("+")[0]; // retire un éventuel +tag déjà présent
  const tag = slug.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  return `${local}+${tag}@${domain}`;
}

/** Extrait le slug du broker depuis un alias plus-addressing (sinon undefined). */
export function extractSlugFromPlusAlias(address: string): string | undefined {
  const at = address.lastIndexOf("@");
  if (at < 0) return undefined;
  const local = address.slice(0, at);
  const plus = local.indexOf("+");
  if (plus < 0) return undefined;
  return local.slice(plus + 1).toLowerCase() || undefined;
}

/** Adresse "de base" (local sans +tag) en minuscules, pour comparer les boîtes. */
export function baseOfAddress(address: string): string {
  const at = address.lastIndexOf("@");
  if (at < 0) return address.toLowerCase();
  const local = address.slice(0, at).split("+")[0];
  return `${local}@${address.slice(at + 1)}`.toLowerCase();
}
