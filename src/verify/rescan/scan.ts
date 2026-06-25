/**
 * Moteur de re-scan (Playwright) : recherche mon profil sur l'interface
 * publique d'un broker pour VÉRIFIER la suppression.
 *
 * Honnêteté : on ne conclut "not_found" (supprimé) QUE si `notFoundText` est
 * explicitement présent ET qu'aucun `foundSelector` ne matche. Tout le reste
 * est "inconclusive" (on ne confirme jamais à tort).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { BrokerRow } from "../../db/schema";
import type { IdentityData } from "../../domain/types";
import { launchBrowser } from "../../forms/browser";
import { buildTokenMap, resolveValue } from "../../forms/tokens";

export type RescanOutcome = "not_found" | "found" | "inconclusive";
export interface RescanResult {
  outcome: RescanOutcome;
  screenshotPath?: string;
  error?: string;
}

const SHOT_DIR = "./screenshots";
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

export async function rescanBroker(
  broker: BrokerRow,
  identity: IdentityData,
  plusAlias?: string | null,
): Promise<RescanResult> {
  const cfg = broker.rescanConfig;
  if (!cfg?.searchUrl) throw new Error(`Aucune config de re-scan pour ${broker.slug}.`);
  mkdirSync(SHOT_DIR, { recursive: true });
  const tokens = buildTokenMap(identity, plusAlias);
  const url = resolveValue(cfg.searchUrl, tokens);

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

      if (cfg.searchForm) {
        for (const f of cfg.searchForm.fields) {
          const v = f.value ? resolveValue(f.value, tokens) : "";
          const loc = page.locator(f.selector).first();
          const a = f.action ?? "fill";
          if (a === "fill") await loc.fill(v, { timeout: 10_000 });
          else if (a === "select") await loc.selectOption(v, { timeout: 10_000 });
          else if (a === "check") await loc.check({ timeout: 10_000 });
          else if (a === "click") await loc.click({ timeout: 10_000 });
        }
        if (cfg.searchForm.submitSelector) {
          await page.locator(cfg.searchForm.submitSelector).first().click({ timeout: 10_000 });
          await page.waitForLoadState("domcontentloaded").catch(() => {});
        }
      }

      if (cfg.waitMs) await page.waitForTimeout(cfg.waitMs);

      const found = cfg.foundSelector
        ? (await page.locator(cfg.foundSelector).count()) > 0
        : false;
      let notFound = false;
      if (cfg.notFoundText) {
        const body = (await page.content()).toLowerCase();
        notFound = body.includes(cfg.notFoundText.toLowerCase());
      }

      const screenshotPath = join(SHOT_DIR, `rescan-${broker.slug}-${stamp()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

      // Présence détectée -> "found" (conservateur : ne jamais sur-affirmer la suppression).
      const outcome: RescanOutcome = found ? "found" : notFound ? "not_found" : "inconclusive";
      return { outcome, screenshotPath };
    } finally {
      await page.close();
    }
  } catch (e) {
    return { outcome: "inconclusive", error: (e as Error).message };
  } finally {
    await browser.close();
  }
}
