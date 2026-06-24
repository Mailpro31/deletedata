/**
 * Registre des brokers : upsert (par slug), lecture avec overrides fusionnés,
 * activation, et ajout d'overrides (corriger URL/email/canal sans coder).
 */
import { and, eq, like } from "drizzle-orm";
import { getDb } from "../db/client";
import { brokers, overrides, type BrokerInsert, type BrokerRow } from "../db/schema";
import type { Channel, Jurisdiction } from "../domain/types";
import { audit } from "../audit/log";

export interface BrokerFilter {
  active?: boolean;
  channel?: Channel;
  jurisdiction?: Jurisdiction;
  source?: string;
  search?: string;
}

function loadOverrideMap(): Map<number, Record<string, unknown>> {
  const db = getDb();
  const rows = db.select().from(overrides).all();
  const map = new Map<number, Record<string, unknown>>();
  for (const o of rows) {
    map.set(o.brokerId, { ...(map.get(o.brokerId) ?? {}), ...o.patch });
  }
  return map;
}

function merge(row: BrokerRow, patch?: Record<string, unknown>): BrokerRow {
  return patch ? ({ ...row, ...patch } as BrokerRow) : row;
}

export function listBrokers(filter: BrokerFilter = {}): BrokerRow[] {
  const db = getDb();
  const conds = [];
  if (filter.active !== undefined) conds.push(eq(brokers.active, filter.active));
  if (filter.channel) conds.push(eq(brokers.channel, filter.channel));
  if (filter.jurisdiction) conds.push(eq(brokers.jurisdiction, filter.jurisdiction));
  if (filter.source) conds.push(eq(brokers.source, filter.source));
  if (filter.search) conds.push(like(brokers.name, `%${filter.search}%`));
  const rows = db
    .select()
    .from(brokers)
    .where(conds.length ? and(...conds) : undefined)
    .all();
  const ovs = loadOverrideMap();
  return rows.map((r) => merge(r, ovs.get(r.id)));
}

export function getBrokerBySlug(slug: string): BrokerRow | undefined {
  const db = getDb();
  const row = db.select().from(brokers).where(eq(brokers.slug, slug)).get();
  return row ? withOverrides(row) : undefined;
}

export function getBrokerById(id: number): BrokerRow | undefined {
  const db = getDb();
  const row = db.select().from(brokers).where(eq(brokers.id, id)).get();
  return row ? withOverrides(row) : undefined;
}

function withOverrides(row: BrokerRow): BrokerRow {
  const db = getDb();
  const ovs = db.select().from(overrides).where(eq(overrides.brokerId, row.id)).all();
  let patch: Record<string, unknown> = {};
  for (const o of ovs) patch = { ...patch, ...o.patch };
  return merge(row, patch);
}

/** Upsert par slug. Par défaut, NE touche PAS à `active` (préserve la curation). */
export function upsertBrokers(
  rows: BrokerInsert[],
  opts: { activate?: boolean } = {},
): { inserted: number; updated: number } {
  const db = getDb();
  let inserted = 0;
  let updated = 0;
  db.transaction((tx) => {
    for (const item of rows) {
      const existing = tx
        .select({ id: brokers.id })
        .from(brokers)
        .where(eq(brokers.slug, item.slug))
        .get();
      if (existing) {
        const set: Partial<BrokerInsert> = { ...item };
        if (!opts.activate) delete set.active; // ne pas écraser la curation
        tx.update(brokers).set(set).where(eq(brokers.slug, item.slug)).run();
        updated++;
      } else {
        tx.insert(brokers)
          .values({ ...item, active: opts.activate ? true : (item.active ?? false) })
          .run();
        inserted++;
      }
    }
  });
  return { inserted, updated };
}

export function setActive(slug: string, active: boolean): boolean {
  const db = getDb();
  const res = db.update(brokers).set({ active }).where(eq(brokers.slug, slug)).run();
  if (res.changes > 0) {
    audit({ action: active ? "broker_activated" : "broker_deactivated", brokerSlug: slug });
  }
  return res.changes > 0;
}

export function addOverride(
  slug: string,
  patch: Record<string, unknown>,
  note?: string,
): boolean {
  const db = getDb();
  const broker = db.select({ id: brokers.id }).from(brokers).where(eq(brokers.slug, slug)).get();
  if (!broker) return false;
  db.insert(overrides).values({ brokerId: broker.id, patch, note: note ?? null }).run();
  audit({ action: "broker_override_added", brokerSlug: slug, detail: { patch, note } });
  return true;
}

export function countBrokers(): { total: number; active: number } {
  const db = getDb();
  const total = db.select().from(brokers).all().length;
  const active = db.select().from(brokers).where(eq(brokers.active, true)).all().length;
  return { total, active };
}
