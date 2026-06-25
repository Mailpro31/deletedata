/**
 * Classification via Vertex AI (Gemini Flash) — SDK `@google/genai` (backend
 * Vertex). Vertex n'entraîne PAS sur les données : conforme au traitement de
 * mes PII (emails de réponse). Sortie JSON stricte + parsing robuste + backoff
 * sur 429.
 *
 * Auth : Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS ou
 * `gcloud auth application-default login`). Région EU recommandée.
 */
import { GoogleGenAI, Type } from "@google/genai";
import { requireVertex } from "../../config/env";
import { CLASSIFICATIONS, type Classification } from "../../domain/types";
import { SYSTEM_INSTRUCTION, buildPrompt } from "./prompt";
import { log } from "../../config/logger";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let client: GoogleGenAI | null = null;
function getClient(): { ai: GoogleGenAI; model: string } {
  const v = requireVertex();
  if (!client) {
    client = new GoogleGenAI({ vertexai: true, project: v.project, location: v.location });
  }
  return { ai: client, model: v.model };
}

function isClassification(v: unknown): v is Classification {
  return typeof v === "string" && (CLASSIFICATIONS as readonly string[]).includes(v);
}

/** Parsing JSON robuste : direct, puis extraction d'un bloc {...}. */
export function parseStatus(text: string): Classification | null {
  const attempt = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  let obj = attempt(text.trim());
  if (!obj) {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) obj = attempt(m[0]);
  }
  const status = obj && typeof obj === "object" ? (obj as Record<string, unknown>).status : undefined;
  return isClassification(status) ? status : null;
}

export interface ClassifyResult {
  status: Classification;
  raw: string;
}

export async function classifyEmail(emailText: string): Promise<ClassifyResult> {
  const { ai, model } = getClient();
  const retries = 5;
  let attempt = 0;
  for (;;) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: buildPrompt(emailText.slice(0, 12_000)),
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: { status: { type: Type.STRING, enum: [...CLASSIFICATIONS] } },
            required: ["status"],
          },
        },
      });
      const raw = res.text ?? "";
      const status = parseStatus(raw);
      if (!status) {
        // On NE confirme jamais par défaut : fallback prudent vers unrelated.
        log.warn("Classification illisible -> fallback 'unrelated'", { raw: raw.slice(0, 200) });
        return { status: "unrelated", raw };
      }
      return { status, raw };
    } catch (e) {
      const err = e as { status?: number; code?: number; message?: string };
      const is429 =
        err?.status === 429 ||
        err?.code === 429 ||
        /\b429\b|RESOURCE_EXHAUSTED|rate limit/i.test(String(err?.message ?? ""));
      attempt++;
      if (!is429 || attempt > retries) throw e;
      const delay = Math.min(32_000, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 500);
      log.warn(`Vertex 429 — backoff ${delay} ms (essai ${attempt}/${retries})`);
      await sleep(delay);
    }
  }
}

/** Petit appel de vérification de connexion (pour `test-connections`). */
export async function verifyVertex(): Promise<Classification> {
  const r = await classifyEmail(
    "Bonjour, nous confirmons que vos données personnelles ont bien été supprimées de nos fichiers.",
  );
  return r.status;
}
