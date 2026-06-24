/**
 * API locale (Express) qui pilote le dashboard. Liée à 127.0.0.1 uniquement
 * (outil local mono-utilisateur ; pas d'auth). Sert aussi le dashboard buildé
 * (web/dist) s'il est présent.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express, { type Request, type Response } from "express";
import { env, isLive } from "../config/env";
import { log } from "../config/logger";
import { listIdentities } from "../identity/service";
import { addOverride, listBrokers, setActive } from "../brokers/registry";
import {
  buildStatusReport,
  exportHistory,
  getRequestDetail,
  listReviewQueue,
  queryRequests,
} from "../reporting/status";
import {
  approveBatch,
  getBatchRequests,
  listBatches,
  rejectBatch,
} from "../requests/approve";
import { generateDrafts } from "../requests/draft";
import { sendApproved } from "../send/email";
import { runImapVerification } from "../verify/imap/pipeline";
import type { Channel, ConfidenceStatus, Jurisdiction, RequestStatus } from "../domain/types";

const qs = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;
const h =
  (fn: Handler) =>
  async (req: Request, res: Response): Promise<void> => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (e) {
      log.error(`API: ${(e as Error).message}`);
      if (!res.headersSent) res.status(500).json({ error: (e as Error).message });
    }
  };

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/api/status", h(() => buildStatusReport({ dryRun: env.DRY_RUN, live: isLive() })));
  app.get("/api/identities", h(() => listIdentities()));

  app.get(
    "/api/brokers",
    h((req) =>
      listBrokers({
        active:
          req.query.active === "true" ? true : req.query.active === "false" ? false : undefined,
        channel: qs(req.query.channel) as Channel | undefined,
        jurisdiction: qs(req.query.jurisdiction) as Jurisdiction | undefined,
        source: qs(req.query.source),
        search: qs(req.query.search),
      }),
    ),
  );
  app.post(
    "/api/brokers/:slug/activate",
    h((req) => ({ ok: setActive(String(req.params.slug), req.body?.active !== false) })),
  );
  app.post(
    "/api/brokers/:slug/override",
    h((req) => ({ ok: addOverride(String(req.params.slug), req.body?.patch ?? {}, req.body?.note) })),
  );

  app.get(
    "/api/requests",
    h((req) =>
      queryRequests({
        status: qs(req.query.status) as RequestStatus | undefined,
        confidence: qs(req.query.confidence) as ConfidenceStatus | undefined,
        channel: qs(req.query.channel) as Channel | undefined,
        notSent: req.query.notSent === "true",
        brokerSlug: qs(req.query.broker),
      }),
    ),
  );
  app.get(
    "/api/requests/:id",
    h((req) => {
      const d = getRequestDetail(Number(req.params.id));
      if (!d) throw new Error("demande introuvable");
      return d;
    }),
  );

  app.get("/api/batches", h(() => listBatches()));
  app.get("/api/batches/:id", h((req) => getBatchRequests(Number(req.params.id))));
  app.post("/api/batches/:id/approve", h((req) => approveBatch(Number(req.params.id))));
  app.post("/api/batches/:id/reject", h((req) => rejectBatch(Number(req.params.id))));

  app.get("/api/review-queue", h(() => listReviewQueue()));

  // Actions (respectent le dry-run / les garde-fous)
  app.post("/api/draft", h((req) => generateDrafts(req.body ?? {})));
  app.post("/api/send", h((req) => sendApproved(req.body ?? {})));
  app.post("/api/verify", h(() => runImapVerification()));
  app.post(
    "/api/rescan",
    h(async (req) => {
      const { runRescan } = await import("../verify/rescan/pipeline");
      return runRescan(req.body ?? {});
    }),
  );
  app.post(
    "/api/cycle",
    h(async (req) => {
      const { runCycle } = await import("../scheduler/cycle");
      return runCycle(req.body ?? {});
    }),
  );

  app.get(
    "/api/export",
    h((req, res) => {
      const fmt = req.query.format === "csv" ? "csv" : "json";
      const content = exportHistory(fmt);
      res.setHeader("Content-Type", fmt === "csv" ? "text/csv" : "application/json");
      res.send(content);
    }),
  );

  // Dashboard statique (si buildé)
  const webDist = resolve("./web/dist");
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.use((req, res, next) => {
      if (req.method === "GET" && !req.path.startsWith("/api/")) {
        res.sendFile("index.html", { root: webDist });
      } else {
        next();
      }
    });
  }

  return app;
}

export function serve(port = 4317): void {
  createApp().listen(port, "127.0.0.1", () => {
    log.info(
      `API + dashboard : http://127.0.0.1:${port} (local). Mode ${isLive() ? "LIVE" : "DRY-RUN"}.`,
    );
  });
}
