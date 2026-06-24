/**
 * Source : Eraser (`digisamroc/eraser`, MIT) — `data/brokers.yaml`.
 * Schéma attendu (souple) : id, name, email, website, opt_out_url, region,
 * category. On tolère les variantes de noms de champs et les valeurs absentes.
 */
import { parse } from "yaml";
import type { RawBroker } from "../types";
import { slugify } from "../../../util/text";

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

export function parseEraserYaml(text: string): RawBroker[] {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (e) {
    throw new Error(`YAML Eraser invalide : ${(e as Error).message}`);
  }

  const list: unknown[] = Array.isArray(doc)
    ? doc
    : doc && typeof doc === "object" && Array.isArray((doc as Record<string, unknown>).brokers)
      ? ((doc as Record<string, unknown>).brokers as unknown[])
      : [];

  const out: RawBroker[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const b = entry as Record<string, unknown>;
    const name = str(b.name) ?? str(b.id);
    if (!name) continue;
    const slug = (str(b.id) ?? str(b.slug) ?? slugify(name)) || slugify(name);
    out.push({
      slug,
      name,
      optOutUrl: str(b.opt_out_url) ?? str(b.optOutUrl) ?? str(b.website) ?? str(b.url),
      email: str(b.email) ?? str(b.privacy_email),
      region: str(b.region) ?? str(b.jurisdiction),
      category: str(b.category) ?? str(b.type),
      requiresIdentityDoc: Boolean(
        b.requires_id ?? b.requiresIdentityDoc ?? b.identity_verification,
      ),
      source: "eraser",
      sourceLicense: "MIT",
    });
  }
  return out;
}
