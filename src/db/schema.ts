/**
 * Schéma de la base (Drizzle, SQLite chiffré).
 *
 * Conventions :
 *  - timestamps en `timestamp_ms` (Date <-> entier ms).
 *  - énumérations stockées en texte, typées via `.$type<...>()`.
 *  - colonnes JSON en `text({ mode: "json" })`.
 */
import {
  sqliteTable,
  integer,
  text,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
import type {
  Channel,
  ConfidenceStatus,
  ErrorEntry,
  FormConfig,
  IdentityData,
  Jurisdiction,
  Proof,
  RequestStatus,
  VerificationMethod,
  BatchStatus,
} from "../domain/types";

const now = () => new Date();

/** Variantes de mon identité (noms, emails, adresses). */
export const identities = sqliteTable("identities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
  data: text("data", { mode: "json" }).$type<IdentityData>().notNull(),
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(now).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$defaultFn(now).$onUpdateFn(now).notNull(),
});

/** Catalogue des data brokers. */
export const brokers = sqliteTable(
  "brokers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    optOutUrl: text("opt_out_url"),
    email: text("email"),
    emailDomain: text("email_domain"),
    channel: text("channel").$type<Channel>().notNull().default("manual"),
    jurisdiction: text("jurisdiction").$type<Jurisdiction>().notNull().default("global"),
    hasPublicSearch: integer("has_public_search", { mode: "boolean" }).notNull().default(false),
    verificationMethod: text("verification_method").$type<VerificationMethod>().notNull().default("none"),
    requiresIdentityDoc: integer("requires_identity_doc", { mode: "boolean" }).notNull().default(false),
    formConfig: text("form_config", { mode: "json" }).$type<FormConfig>(),
    source: text("source"),
    sourceLicense: text("source_license"),
    // active = "prêt à envoyer" (sous-ensemble curaté). Le reste = pistes.
    active: integer("active", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(now).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$defaultFn(now).$onUpdateFn(now).notNull(),
  },
  (t) => [
    uniqueIndex("brokers_slug_unique").on(t.slug),
    index("brokers_active_idx").on(t.active),
    index("brokers_channel_idx").on(t.channel),
  ],
);

/** Corrections par broker (URL/email/canal...) sans toucher au code. */
export const overrides = sqliteTable("overrides", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  brokerId: integer("broker_id").notNull().references(() => brokers.id, { onDelete: "cascade" }),
  // Patch partiel fusionné à la lecture du broker.
  patch: text("patch", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(now).notNull(),
});

/** Lots d'approbation : on approuve un lot avant tout envoi. */
export const approvalBatches = sqliteTable("approval_batches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label"),
  status: text("status").$type<BatchStatus>().notNull().default("pending"),
  count: integer("count").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(now).notNull(),
  approvedAt: integer("approved_at", { mode: "timestamp_ms" }),
});

/** Une demande d'effacement : lien identity <-> broker. */
export const requests = sqliteTable(
  "requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    identityId: integer("identity_id").notNull().references(() => identities.id, { onDelete: "cascade" }),
    brokerId: integer("broker_id").notNull().references(() => brokers.id, { onDelete: "cascade" }),
    batchId: integer("batch_id").references(() => approvalBatches.id, { onDelete: "set null" }),
    status: text("status").$type<RequestStatus>().notNull().default("draft"),
    confidenceStatus: text("confidence_status").$type<ConfidenceStatus>().notNull().default("pending"),
    channel: text("channel").$type<Channel>().notNull(),
    // Plus-addressing : alias `local+slug@domaine` pour rattacher la réponse.
    plusAlias: text("plus_alias"),
    // Message-ID généré à l'envoi (fallback de rattachement par threading).
    messageId: text("message_id"),
    threadRefs: text("thread_refs", { mode: "json" }).$type<string[]>(),
    subject: text("subject"),
    body: text("body"),
    deadlineAt: integer("deadline_at", { mode: "timestamp_ms" }),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }),
    lastReminderAt: integer("last_reminder_at", { mode: "timestamp_ms" }),
    reminderCount: integer("reminder_count").notNull().default(0),
    proof: text("proof", { mode: "json" }).$type<Proof>(),
    errorLog: text("error_log", { mode: "json" }).$type<ErrorEntry[]>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(now).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$defaultFn(now).$onUpdateFn(now).notNull(),
  },
  (t) => [
    uniqueIndex("requests_identity_broker_unique").on(t.identityId, t.brokerId),
    index("requests_status_idx").on(t.status),
    index("requests_confidence_idx").on(t.confidenceStatus),
    index("requests_message_id_idx").on(t.messageId),
    index("requests_plus_alias_idx").on(t.plusAlias),
  ],
);

/** Suivi incrémental IMAP (singleton, id=1) pour l'idempotence. */
export const imapState = sqliteTable("imap_state", {
  id: integer("id").primaryKey(),
  mailbox: text("mailbox").notNull(),
  uidValidity: integer("uid_validity"),
  lastSeenUid: integer("last_seen_uid").notNull().default(0),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$defaultFn(now).$onUpdateFn(now).notNull(),
});

/** Mails non rattachables -> file "à revoir" du dashboard. */
export const reviewQueue = sqliteTable("review_queue", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  emailUid: integer("email_uid"),
  uidValidity: integer("uid_validity"),
  fromAddr: text("from_addr"),
  toAddr: text("to_addr"),
  subject: text("subject"),
  receivedAt: integer("received_at", { mode: "timestamp_ms" }),
  snippet: text("snippet"),
  reason: text("reason"),
  resolvedBrokerId: integer("resolved_broker_id").references(() => brokers.id, { onDelete: "set null" }),
  resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(now).notNull(),
});

/** Journal d'audit APPEND-ONLY : chaque action sensible. */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ts: integer("ts", { mode: "timestamp_ms" }).$defaultFn(now).notNull(),
    action: text("action").notNull(),
    brokerSlug: text("broker_slug"),
    requestId: integer("request_id"),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    subject: text("subject"),
    detail: text("detail", { mode: "json" }).$type<Record<string, unknown>>(),
  },
  (t) => [index("audit_ts_idx").on(t.ts), index("audit_request_idx").on(t.requestId)],
);

// Types ligne inférés (réutilisés dans le code).
export type IdentityRow = typeof identities.$inferSelect;
export type BrokerRow = typeof brokers.$inferSelect;
export type BrokerInsert = typeof brokers.$inferInsert;
export type RequestRow = typeof requests.$inferSelect;
export type RequestInsert = typeof requests.$inferInsert;
export type OverrideRow = typeof overrides.$inferSelect;
export type ApprovalBatchRow = typeof approvalBatches.$inferSelect;
export type ReviewQueueRow = typeof reviewQueue.$inferSelect;
export type AuditRow = typeof auditLog.$inferSelect;
