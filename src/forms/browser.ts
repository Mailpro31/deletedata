/** Lancement du navigateur Playwright (Chromium, headless). */
import { chromium, type Browser } from "playwright";

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true });
}
