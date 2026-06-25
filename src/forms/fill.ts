/**
 * Moteur de remplissage de formulaires (Playwright).
 *
 * Config par broker (FormConfig) : liste de formulaires (plusieurs URLs
 * possibles), chacun avec des champs `{selector, action, value}`. Les valeurs
 * peuvent contenir des jetons d'identité ($email, $fullName...).
 *
 * `submit:false` = répétition (rehearse) : remplit SANS cliquer le bouton
 * d'envoi (pour vérifier les sélecteurs). `submit:true` = envoi réel.
 * Screenshot systématique (succès et échec) -> ./screenshots, pour debug/preuve.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import type { BrokerRow } from "../db/schema";
import type { FormConfig, IdentityData } from "../domain/types";
import { launchBrowser } from "./browser";
import { buildTokenMap, resolveValue } from "./tokens";

export interface FormFillResult {
  url: string;
  filled: number;
  submitted: boolean;
  ok: boolean;
  screenshotPath?: string;
  error?: string;
}

const SHOT_DIR = "./screenshots";
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

async function fillOneForm(
  page: Page,
  form: FormConfig["forms"][number],
  tokens: Record<string, string>,
  opts: { submit: boolean },
  shotBase: string,
): Promise<FormFillResult> {
  let filled = 0;
  try {
    await page.goto(form.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    for (const field of form.fields) {
      const action = field.action ?? "fill";
      const value = field.value ? resolveValue(field.value, tokens) : "";
      const loc = page.locator(field.selector).first();
      switch (action) {
        case "fill":
          await loc.fill(value, { timeout: 10_000 });
          break;
        case "check":
          await loc.check({ timeout: 10_000 });
          break;
        case "uncheck":
          await loc.uncheck({ timeout: 10_000 });
          break;
        case "select":
          await loc.selectOption(value, { timeout: 10_000 });
          break;
        case "click":
          await loc.click({ timeout: 10_000 });
          break;
      }
      filled++;
    }

    let submitted = false;
    if (opts.submit && form.submitSelector) {
      await page.locator(form.submitSelector).first().click({ timeout: 10_000 });
      await page.waitForTimeout(1500); // laisser la soumission aboutir
      submitted = true;
    }

    const screenshotPath = `${shotBase}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return { url: form.url, filled, submitted, ok: true, screenshotPath };
  } catch (e) {
    let screenshotPath: string | undefined;
    try {
      screenshotPath = `${shotBase}-error.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
    } catch {
      screenshotPath = undefined;
    }
    return {
      url: form.url,
      filled,
      submitted: false,
      ok: false,
      screenshotPath,
      error: (e as Error).message,
    };
  }
}

export async function fillBrokerForms(
  broker: BrokerRow,
  identity: IdentityData,
  plusAlias: string | null,
  opts: { submit: boolean },
): Promise<FormFillResult[]> {
  const config = broker.formConfig;
  if (!config?.forms?.length) {
    throw new Error(
      `Aucune config de formulaire pour ${broker.slug}. Définis-la (forms set-config).`,
    );
  }
  mkdirSync(SHOT_DIR, { recursive: true });
  const tokens = buildTokenMap(identity, plusAlias);
  const browser = await launchBrowser();
  const results: FormFillResult[] = [];
  try {
    const context = await browser.newContext();
    let i = 0;
    for (const form of config.forms) {
      const page = await context.newPage();
      const shotBase = join(SHOT_DIR, `${broker.slug}-${stamp()}-${i}`);
      results.push(await fillOneForm(page, form, tokens, opts, shotBase));
      await page.close();
      i++;
    }
  } finally {
    await browser.close();
  }
  return results;
}
