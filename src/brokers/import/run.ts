/**
 * Orchestration de l'import : charge une source (fichier local ou URL),
 * la parse, la normalise, puis upsert. Le seed curaté est appliqué à part
 * (avec activation).
 */
import { readFile } from "node:fs/promises";
import { parseEraserYaml } from "./sources/eraser";
import { parseJustVanishJson } from "./sources/justvanish";
import { parseBadboolMarkdown } from "./sources/badbool";
import { normalizeBroker } from "./normalize";
import type { RawBroker } from "./types";
import { upsertBrokers } from "../registry";
import { seedBrokers } from "../seed/eu-brokers";
import { audit } from "../../audit/log";
import { log } from "../../config/logger";

export type SourceName = "eraser" | "justvanish" | "badbool";

const PARSERS: Record<SourceName, (text: string) => RawBroker[]> = {
  eraser: parseEraserYaml,
  justvanish: parseJustVanishJson,
  badbool: parseBadboolMarkdown,
};

export const SOURCE_URLS: Partial<Record<SourceName, string>> = {
  eraser:
    "https://raw.githubusercontent.com/digisamroc/eraser/main/data/brokers.yaml",
};

async function loadText(opts: { file?: string; url?: string }): Promise<string> {
  if (opts.file) return readFile(opts.file, "utf8");
  if (opts.url) {
    const res = await fetch(opts.url);
    if (!res.ok) {
      throw new Error(`Téléchargement échoué (HTTP ${res.status}) : ${opts.url}`);
    }
    return res.text();
  }
  throw new Error("Préciser --file <chemin> ou --url <url> (ou laisser l'URL par défaut).");
}

export interface ImportResult {
  source: SourceName;
  parsed: number;
  inserted: number;
  updated: number;
}

export async function importSource(
  source: SourceName,
  opts: { file?: string; url?: string } = {},
): Promise<ImportResult> {
  const url = opts.url ?? (opts.file ? undefined : SOURCE_URLS[source]);
  const text = await loadText({ file: opts.file, url });
  const raws = PARSERS[source](text);
  const rows = raws.map(normalizeBroker);
  const { inserted, updated } = upsertBrokers(rows);
  audit({
    action: "brokers_imported",
    detail: { source, parsed: raws.length, inserted, updated },
  });
  log.info(
    `Import ${source} : ${raws.length} lus, ${inserted} ajoutés, ${updated} mis à jour.`,
  );
  return { source, parsed: raws.length, inserted, updated };
}

/** Applique le seed curaté (active = true). */
export function seedCurated(): { inserted: number; updated: number } {
  const res = upsertBrokers(seedBrokers(), { activate: true });
  audit({ action: "brokers_seeded", detail: res });
  log.info(
    `Seed curaté : ${res.inserted} ajoutés, ${res.updated} mis à jour (active=true).`,
  );
  return res;
}
