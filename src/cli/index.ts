/**
 * CLI de pilotage (commander). Commandes :
 *   db migrate
 *   identity add | list
 *   brokers import <source> | seed | list | activate | deactivate | override
 *   draft
 *   review [batchId] | approve <batchId> | reject <batchId>
 *   send
 *   verify
 *   status | requests | review-queue
 *   export
 */
import { writeFileSync } from "node:fs";
import { Command } from "commander";
import { env, isLive } from "../config/env";
import { log } from "../config/logger";
import { closeDatabase } from "../db/client";
import { runMigrations } from "../db/migrate";
import { createIdentity, listIdentities } from "../identity/service";
import type { IdentityData } from "../domain/types";
import { importSource, seedCurated, type SourceName } from "../brokers/import/run";
import {
  addOverride,
  getBrokerBySlug,
  listBrokers,
  setActive,
} from "../brokers/registry";
import { generateDrafts } from "../requests/draft";
import {
  approveBatch,
  getBatchRequests,
  listBatches,
  rejectBatch,
} from "../requests/approve";
import { sendApproved } from "../send/email";
import { runImapVerification } from "../verify/imap/pipeline";
import {
  buildStatusReport,
  exportHistory,
  queryRequests,
  type RequestFilter,
} from "../reporting/status";

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

async function run(fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
  } catch (e) {
    log.error((e as Error).message);
    process.exitCode = 1;
  } finally {
    closeDatabase();
  }
}

function table(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const fmt = (cells: string[]) =>
    cells.map((c, i) => (c ?? "").padEnd(widths[i] ?? 0)).join("  ");
  console.log(fmt(headers));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) console.log(fmt(r));
  if (rows.length === 0) console.log("(aucune ligne)");
}

function modeBanner(): void {
  if (isLive()) {
    log.warn("⚠️  MODE LIVE : les envois sont RÉELS (DRY_RUN=false + LIVE_CONFIRM=I_UNDERSTAND).");
  } else {
    log.info("Mode DRY-RUN (par défaut) : aucun email ne part. Rien ne peut être envoyé par accident.");
  }
}

const BOOL_KEYS = new Set(["hasPublicSearch", "requiresIdentityDoc", "active"]);
function parseSetPairs(pairs: string[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const p of pairs) {
    const i = p.indexOf("=");
    if (i < 0) throw new Error(`--set attend key=value, reçu : ${p}`);
    const key = p.slice(0, i).trim();
    const val = p.slice(i + 1);
    patch[key] = BOOL_KEYS.has(key) ? ["true", "1", "yes"].includes(val.toLowerCase()) : val;
  }
  return patch;
}

const dt = (d: Date | null) => (d ? d.toLocaleDateString("fr-FR") : "—");

// ---------------------------------------------------------------------------
//  Programme
// ---------------------------------------------------------------------------

const program = new Command();
program
  .name("deletedata")
  .description("Outil personnel et local de suppression de données data brokers (RGPD).")
  .version("0.1.0");

// --- db --------------------------------------------------------------------
const db = program.command("db").description("Base de données");
db.command("migrate")
  .description("Applique les migrations à la base chiffrée")
  .action(() => run(() => runMigrations()));

// --- identity --------------------------------------------------------------
const identity = program.command("identity").description("Variantes de mon identité");
identity
  .command("add")
  .requiredOption("--label <label>", "libellé de l'identité")
  .option("--name <name>", "nom/variante (répétable)", collect, [])
  .option("--email <email>", "email (répétable)", collect, [])
  .option("--address <address>", "adresse (répétable)", collect, [])
  .option("--phone <phone>", "téléphone (répétable)", collect, [])
  .option("--birthdate <date>", "date de naissance")
  .option("--primary", "définir comme identité principale", false)
  .action((opts) =>
    run(() => {
      const data: IdentityData = {
        fullNames: opts.name,
        emails: opts.email,
        addresses: opts.address,
        phones: opts.phone?.length ? opts.phone : undefined,
        birthDate: opts.birthdate,
      };
      const row = createIdentity(opts.label, data, Boolean(opts.primary));
      log.info(`Identité #${row.id} créée (${row.label})${row.isPrimary ? " [principale]" : ""}.`);
    }),
  );
identity
  .command("list")
  .description("Liste les identités")
  .action(() =>
    run(() => {
      const rows = listIdentities();
      table(
        ["id", "label", "principale", "noms", "emails"],
        rows.map((r) => [
          String(r.id),
          r.label,
          r.isPrimary ? "oui" : "",
          String(r.data.fullNames?.length ?? 0),
          String(r.data.emails?.length ?? 0),
        ]),
      );
    }),
  );

// --- brokers ---------------------------------------------------------------
const brokers = program.command("brokers").description("Catalogue des data brokers");
brokers
  .command("import <source>")
  .description("Importe une source (eraser | justvanish | badbool)")
  .option("--file <path>", "fichier local à parser")
  .option("--url <url>", "URL à télécharger (sinon URL par défaut de la source)")
  .action((source: string, opts) =>
    run(async () => {
      const res = await importSource(source as SourceName, { file: opts.file, url: opts.url });
      log.info(`Import terminé : ${res.parsed} lus, ${res.inserted} ajoutés, ${res.updated} mis à jour.`);
    }),
  );
brokers
  .command("seed")
  .description("Charge le jeu curaté EU/FR (active=true)")
  .action(() =>
    run(() => {
      const res = seedCurated();
      log.info(`Seed : ${res.inserted} ajoutés, ${res.updated} mis à jour.`);
    }),
  );
brokers
  .command("list")
  .option("--active", "seulement les brokers actifs")
  .option("--channel <channel>", "email | form | manual")
  .option("--jurisdiction <j>", "eu | us | global")
  .option("--source <source>", "filtrer par source")
  .option("--search <text>", "recherche dans le nom")
  .action((opts) =>
    run(() => {
      const rows = listBrokers({
        active: opts.active ? true : undefined,
        channel: opts.channel,
        jurisdiction: opts.jurisdiction,
        source: opts.source,
        search: opts.search,
      });
      table(
        ["slug", "nom", "canal", "juri.", "actif", "vérif.", "email/URL"],
        rows.map((b) => [
          b.slug,
          b.name.slice(0, 28),
          b.channel,
          b.jurisdiction,
          b.active ? "oui" : "",
          b.verificationMethod,
          (b.email ?? b.optOutUrl ?? "").slice(0, 40),
        ]),
      );
      console.log(`\n${rows.length} broker(s).`);
    }),
  );
brokers
  .command("activate <slug>")
  .action((slug: string) =>
    run(() => log.info(setActive(slug, true) ? `${slug} activé.` : `${slug} introuvable.`)),
  );
brokers
  .command("deactivate <slug>")
  .action((slug: string) =>
    run(() => log.info(setActive(slug, false) ? `${slug} désactivé.` : `${slug} introuvable.`)),
  );
brokers
  .command("override <slug>")
  .description("Corrige un broker sans coder (ex: --set email=x@y.com --set channel=email)")
  .option("--set <kv>", "paire key=value (répétable)", collect, [])
  .option("--note <note>", "note explicative")
  .action((slug: string, opts) =>
    run(() => {
      const patch = parseSetPairs(opts.set);
      const ok = addOverride(slug, patch, opts.note);
      log.info(ok ? `Override ajouté sur ${slug}.` : `${slug} introuvable.`);
    }),
  );

// --- draft -----------------------------------------------------------------
program
  .command("draft")
  .description("Génère des brouillons (lot 'à approuver') pour les brokers actifs")
  .option("--identity <id>", "id d'identité (défaut: principale)")
  .option("--channel <channel>", "limiter à un canal")
  .option("--broker <slug>", "cibler un broker précis (répétable)", collect, [])
  .option("--force", "ignorer l'anti-spam", false)
  .option("--label <label>", "libellé du lot")
  .action((opts) =>
    run(() => {
      const res = generateDrafts({
        identityId: opts.identity ? Number(opts.identity) : undefined,
        channel: opts.channel,
        brokerSlugs: opts.broker?.length ? opts.broker : undefined,
        force: Boolean(opts.force),
        label: opts.label,
      });
      log.info(
        `Lot #${res.batchId} : ${res.created} créés, ${res.updated} mis à jour, ${res.skipped} ignorés.`,
      );
      if (Object.keys(res.skippedReasons).length) {
        console.log("Raisons d'exclusion :", res.skippedReasons);
      }
      console.log(`\n-> Vérifie le lot : \`cli review ${res.batchId}\` puis \`cli approve ${res.batchId}\`.`);
    }),
  );

// --- review / approve ------------------------------------------------------
program
  .command("review [batchId]")
  .description("Liste les lots en attente, ou détaille un lot (sujets/corps)")
  .option("--full", "afficher le corps complet des emails", false)
  .action((batchId: string | undefined, opts) =>
    run(() => {
      if (!batchId) {
        const batches = listBatches(true);
        table(
          ["lot", "statut", "à approuver", "total", "créé"],
          batches.map((b) => [
            String(b.id),
            b.status,
            String(b.pending),
            String(b.count),
            dt(b.createdAt),
          ]),
        );
        return;
      }
      const items = getBatchRequests(Number(batchId));
      console.log(`Lot #${batchId} — ${items.length} demande(s) :\n`);
      for (const it of items) {
        console.log(`── #${it.request.id} ${it.brokerName} [${it.request.channel}] (${it.request.status})`);
        console.log(`   To: ${it.request.plusAlias ?? "(via formulaire/manuel)"}`);
        console.log(`   Sujet: ${it.request.subject ?? ""}`);
        if (opts.full) {
          console.log("   ----");
          console.log(
            (it.request.body ?? "").split("\n").map((l) => `   ${l}`).join("\n"),
          );
        }
        console.log("");
      }
      console.log(`Pour approuver : \`cli approve ${batchId}\``);
    }),
  );
program
  .command("approve <batchId>")
  .description("Approuve un lot (prérequis à l'envoi)")
  .action((batchId: string) =>
    run(() => {
      const res = approveBatch(Number(batchId));
      log.info(`${res.approved} demande(s) approuvée(s).`);
    }),
  );
program
  .command("reject <batchId>")
  .action((batchId: string) =>
    run(() => {
      const res = rejectBatch(Number(batchId));
      log.info(`${res.rejected} demande(s) remises en brouillon.`);
    }),
  );

// --- send ------------------------------------------------------------------
program
  .command("send")
  .description("Envoie les demandes APPROUVÉES (dry-run par défaut)")
  .option("--batch <id>", "limiter à un lot")
  .option("--request <id>", "limiter à des demandes précises (répétable)", collect, [])
  .option("--max <n>", "nombre maximum d'envois")
  .action((opts) =>
    run(async () => {
      modeBanner();
      const res = await sendApproved({
        batchId: opts.batch ? Number(opts.batch) : undefined,
        requestIds: opts.request?.length ? opts.request.map(Number) : undefined,
        max: opts.max ? Number(opts.max) : undefined,
      });
      log.info(
        `Bilan envoi : ${res.sent} envoyé(s), ${res.simulated} simulé(s) [dry-run], ` +
          `${res.manual} action(s) manuelle(s), ${res.failed} échec(s) (sur ${res.total}).`,
      );
    }),
  );

// --- verify ----------------------------------------------------------------
program
  .command("verify")
  .description("Vérifie les réponses par IMAP (incrémental) + classification")
  .option("--no-classify", "ne pas appeler le LLM (rattachement seulement)")
  .action((opts) =>
    run(async () => {
      const res = await runImapVerification({ classify: opts.classify });
      log.info(
        `IMAP : ${res.fetched} mail(s), ${res.matched} rattaché(s), ${res.confirmed} confirmé(s) supprimé(s), ` +
          `${res.acknowledged} accusé(s), ${res.needsInfo} info requise, ${res.refused} refus, ${res.unmatched} à revoir, ${res.errors} erreur(s).`,
      );
    }),
  );

// --- status / requests -----------------------------------------------------
program
  .command("status")
  .description("Vue d'ensemble honnête")
  .action(() =>
    run(() => {
      const r = buildStatusReport({ dryRun: env.DRY_RUN, live: isLive() });
      console.log("\n=== deletedata — état ===");
      console.log(`Mode               : ${r.live ? "LIVE (envois réels)" : "DRY-RUN (aucun envoi)"}`);
      console.log(`Brokers            : ${r.brokers.total} (dont ${r.brokers.active} actifs)`);
      console.log(`Demandes           : ${r.requestsTotal}`);
      console.log(`\n*** ${r.confirmedDeletedPct}% de mes données CONFIRMÉES supprimées ***`);
      console.log(`   (${r.confirmedDeleted} confirmées / ${r.actioned} demandes actionnées — jamais gonflé)`);
      console.log(`\nPar statut       :`, r.byStatus);
      console.log(`Par confiance    :`, r.byConfidence);
      console.log(`\nÉchéances dépassées en attente : ${r.overdueAwaiting}`);
      console.log(`Mails à revoir (non rattachés) : ${r.reviewQueue}`);
      if (r.failures.length) {
        console.log(`\nÉchecs (${r.failures.length}) :`);
        for (const f of r.failures) console.log(`  - #${f.requestId} ${f.broker} : ${f.message}`);
      }
    }),
  );
program
  .command("requests")
  .description("Liste filtrée des demandes")
  .option("--status <s>")
  .option("--confidence <c>")
  .option("--channel <c>")
  .option("--not-sent", "uniquement les non envoyées")
  .option("--broker <slug>")
  .action((opts) =>
    run(() => {
      const filter: RequestFilter = {
        status: opts.status,
        confidence: opts.confidence,
        channel: opts.channel,
        notSent: Boolean(opts.notSent),
        brokerSlug: opts.broker,
      };
      const rows = queryRequests(filter);
      table(
        ["id", "broker", "canal", "statut", "confiance", "envoyé", "deadline", "preuve"],
        rows.map((r) => [
          String(r.id),
          r.broker,
          r.channel,
          r.status,
          r.confidence,
          dt(r.sentAt),
          dt(r.deadlineAt),
          r.hasProof ? "oui" : "",
        ]),
      );
      console.log(`\n${rows.length} demande(s).`);
    }),
  );

// --- export ----------------------------------------------------------------
program
  .command("export")
  .description("Exporte l'historique (preuve RGPD)")
  .option("--format <fmt>", "json | csv", "json")
  .option("--out <file>", "fichier de sortie (sinon stdout)")
  .action((opts) =>
    run(() => {
      const fmt = opts.format === "csv" ? "csv" : "json";
      const content = exportHistory(fmt);
      if (opts.out) {
        writeFileSync(opts.out, content, "utf8");
        log.info(`Export ${fmt} écrit dans ${opts.out}.`);
      } else {
        console.log(content);
      }
    }),
  );

program.parseAsync().catch((e) => {
  log.error((e as Error).message);
  process.exitCode = 1;
});
