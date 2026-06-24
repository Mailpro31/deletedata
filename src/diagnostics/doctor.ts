/**
 * `doctor` : diagnostic de configuration et d'état — n'envoie RIEN.
 *
 * Donne en un coup d'œil ce qui est configuré, ce qui manque, l'état de la base,
 * et la prochaine action recommandée. Ne loggue JAMAIS de secret : seulement le
 * NOM des variables (✓/✗), jamais leur valeur.
 */
import { env, isLive, type Env } from "../config/env";

export interface GroupCheck {
  name: string;
  present: string[];
  missing: string[];
  ok: boolean;
}

export interface ConfigReport {
  live: boolean;
  modeWarnings: string[];
  groups: GroupCheck[];
}

function group(name: string, fields: Record<string, string | undefined>): GroupCheck {
  const present: string[] = [];
  const missing: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== "") present.push(k);
    else missing.push(k);
  }
  return { name, present, missing, ok: missing.length === 0 };
}

/**
 * Vérifie la présence des variables d'environnement par groupe.
 * PUR (testable) et sûr : ne lit que la présence, jamais la valeur d'un secret.
 */
export function checkConfig(e: Env): ConfigReport {
  const live = e.DRY_RUN === false && e.LIVE_CONFIRM === "I_UNDERSTAND";
  const modeWarnings: string[] = [];
  if (e.DRY_RUN === false && e.LIVE_CONFIRM !== "I_UNDERSTAND") {
    modeWarnings.push(
      "DRY_RUN=false mais LIVE_CONFIRM≠I_UNDERSTAND → envoi réel toujours BLOQUÉ (volontaire).",
    );
  }
  if (e.DRY_RUN !== false && e.LIVE_CONFIRM === "I_UNDERSTAND") {
    modeWarnings.push(
      "LIVE_CONFIRM=I_UNDERSTAND mais DRY_RUN≠false → reste en dry-run (aucun envoi).",
    );
  }
  const groups: GroupCheck[] = [
    group("Base chiffrée", { DB_PASSPHRASE: e.DB_PASSPHRASE }),
    group("SMTP (envoi)", {
      SMTP_HOST: e.SMTP_HOST,
      SMTP_USER: e.SMTP_USER,
      SMTP_PASS: e.SMTP_PASS,
    }),
    group("IMAP (vérification)", {
      IMAP_HOST: e.IMAP_HOST,
      IMAP_USER: e.IMAP_USER,
      IMAP_PASS: e.IMAP_PASS,
    }),
    group("Vertex AI (classification)", {
      GOOGLE_CLOUD_PROJECT: e.GOOGLE_CLOUD_PROJECT,
    }),
  ];
  return { live, modeWarnings, groups };
}

const byPrefix = (groups: GroupCheck[], prefix: string): GroupCheck | undefined =>
  groups.find((g) => g.name.startsWith(prefix));

/** Prochaines actions, dérivées de l'état (config + base). */
export function nextSteps(cfg: ConfigReport, dbReachable: boolean): string[] {
  const steps: string[] = [];
  const db = byPrefix(cfg.groups, "Base");
  if (db && !db.ok) {
    steps.push("Renseigne DB_PASSPHRASE dans .env, puis `npm run db:migrate`.");
    return steps;
  }
  if (!dbReachable) {
    steps.push("Initialise la base : `npm run db:migrate`.");
    return steps;
  }
  const smtp = byPrefix(cfg.groups, "SMTP");
  const imap = byPrefix(cfg.groups, "IMAP");
  if ((smtp && !smtp.ok) || (imap && !imap.ok)) {
    steps.push("Complète SMTP/IMAP (app password Gmail) dans .env, puis `npm run test-connections`.");
  } else {
    steps.push("Teste les connexions : `npm run test-connections`.");
  }
  steps.push("Déclare ton identité (`identity add`) et charge les brokers (`brokers seed`).");
  steps.push("Répétition en dry-run : `draft` → `review --full` → `approve` → `send`.");
  return steps;
}

const icon = (ok: boolean): string => (ok ? "✓" : "✗");

/** Exécute le diagnostic complet et l'imprime. N'envoie rien ; n'écrit rien. */
export async function runDoctor(): Promise<void> {
  const cfg = checkConfig(env);
  console.log("\n=== deletedata — diagnostic (doctor) ===\n");

  console.log(`Mode d'envoi : ${cfg.live ? "LIVE (envois réels)" : "DRY-RUN (aucun envoi)"}`);
  for (const w of cfg.modeWarnings) console.log(`  ⚠️  ${w}`);

  console.log("\nConfiguration (.env) :");
  for (const g of cfg.groups) {
    const detail = g.missing.length ? ` — manque : ${g.missing.join(", ")}` : "";
    console.log(`  ${icon(g.ok)} ${g.name}${detail}`);
  }
  if (!byPrefix(cfg.groups, "Vertex")?.ok) {
    console.log("     (Vertex est optionnel : `verify --no-classify` fonctionne sans lui.)");
  }

  console.log("\nBase de données :");
  let dbReachable = false;
  try {
    const { buildStatusReport } = await import("../reporting/status");
    const r = buildStatusReport({ dryRun: env.DRY_RUN, live: isLive() });
    dbReachable = true;
    console.log(`  ✓ ouverte et lisible (${env.DB_PATH})`);
    console.log(`  Brokers  : ${r.brokers.total} (dont ${r.brokers.active} actifs)`);
    console.log(
      `  Demandes : ${r.requestsTotal} — ${r.confirmedDeletedPct}% confirmées supprimées ` +
        `(${r.confirmedDeleted}/${r.actioned})`,
    );
    if (r.overdueAwaiting) {
      console.log(`  ⏰ ${r.overdueAwaiting} demande(s) hors délai à relancer (\`remind\`)`);
    }
    if (r.reviewQueue) console.log(`  📥 ${r.reviewQueue} mail(s) à revoir`);
  } catch (e) {
    console.log(`  ✗ inaccessible : ${(e as Error).message}`);
  }

  console.log("\nProchaine action recommandée :");
  for (const step of nextSteps(cfg, dbReachable)) console.log(`  → ${step}`);
  console.log("");
}
