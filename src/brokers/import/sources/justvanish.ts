/**
 * Source : JustVanish (`AnalogJ/justvanish`, MIT) — JSON par organisation.
 * Utilisée surtout pour la métadonnée RGPD (régulation, vérification d'identité).
 * Parseur volontairement souple : si la structure diffère, renvoie [].
 */
import type { RawBroker } from "../types";
import { slugify } from "../../../util/text";

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

export function parseJustVanishJson(text: string): RawBroker[] {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON JustVanish invalide : ${(e as Error).message}`);
  }

  const list: unknown[] = Array.isArray(doc)
    ? doc
    : doc && typeof doc === "object"
      ? ((doc as Record<string, unknown>).organizations as unknown[]) ??
        ((doc as Record<string, unknown>).brokers as unknown[]) ??
        []
      : [];
  if (!Array.isArray(list)) return [];

  const out: RawBroker[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const b = entry as Record<string, unknown>;
    const name = str(b.name) ?? str(b.organization) ?? str(b.id);
    if (!name) continue;
    const emails = b.emails ?? b.contact_emails;
    const email = str(b.email) ?? (Array.isArray(emails) ? str(emails[0]) : undefined);
    const regs = b.regulations ?? b.regulation_type;
    const region = Array.isArray(regs)
      ? regs.map((x) => String(x)).join(",")
      : str(regs);
    out.push({
      slug: (str(b.id) ?? slugify(name)) || slugify(name),
      name,
      optOutUrl: str(b.opt_out_url) ?? str(b.url) ?? str(b.website),
      email,
      region,
      category: str(b.type) ?? str(b.category),
      requiresIdentityDoc: Boolean(
        b.identity_verification ?? b.requires_identity ?? b.requires_id,
      ),
      source: "justvanish",
      sourceLicense: "MIT",
    });
  }
  return out;
}
