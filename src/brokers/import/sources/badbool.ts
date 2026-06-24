/**
 * Source : "Big-Ass Data Broker Opt-Out List" (`yaelwrites/...`).
 * Licence CC BY-NC-SA -> OK en usage PERSONNEL NON COMMERCIAL, avec attribution.
 *
 * Le contenu est du Markdown libre : extraction best-effort par ligne (nom de
 * lien, première URL, premier email). À considérer comme des pistes à enrichir.
 */
import type { RawBroker } from "../types";
import { slugify } from "../../../util/text";

const LINK = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/;
const URL_RE = /(https?:\/\/[^\s)>\]]+)/;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

export function parseBadboolMarkdown(text: string): RawBroker[] {
  const out: RawBroker[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    // On ne traite que les puces de liste susceptibles de décrire un broker.
    if (!/^[-*]\s+/.test(line)) continue;

    const link = line.match(LINK);
    const url = link?.[2] ?? line.match(URL_RE)?.[1];
    const email = line.match(EMAIL_RE)?.[0];
    let name = link?.[1];
    if (!name) {
      // Heuristique : texte avant le premier ':' ou '—'.
      const m = line.replace(/^[-*]\s+/, "").split(/[:—–-]/)[0]?.trim();
      name = m && m.length > 1 && m.length < 80 ? m : undefined;
    }
    if (!name) continue;

    const slug = slugify(name);
    if (seen.has(slug)) continue;
    seen.add(slug);

    out.push({
      slug,
      name,
      optOutUrl: url,
      email,
      source: "badbool",
      sourceLicense: "CC-BY-NC-SA",
    });
  }
  return out;
}
