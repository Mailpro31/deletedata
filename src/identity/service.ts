/**
 * Gestion des variantes de mon identité (noms/alias, emails, adresses).
 * Je suis mon propre sujet de données : plusieurs variantes possibles.
 */
import { desc, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { identities, type IdentityRow } from "../db/schema";
import type { IdentityData } from "../domain/types";
import { audit } from "../audit/log";

export function createIdentity(
  label: string,
  data: IdentityData,
  isPrimary = false,
): IdentityRow {
  const db = getDb();
  if (isPrimary) {
    db.update(identities).set({ isPrimary: false }).run(); // un seul primaire
  }
  const row = db
    .insert(identities)
    .values({ label, data, isPrimary })
    .returning()
    .get();
  // On ne loggue PAS les PII dans l'audit : juste le label.
  audit({ action: "identity_created", detail: { label, isPrimary } });
  return row;
}

export function listIdentities(): IdentityRow[] {
  return getDb().select().from(identities).orderBy(desc(identities.isPrimary)).all();
}

export function getIdentity(id: number): IdentityRow | undefined {
  return getDb().select().from(identities).where(eq(identities.id, id)).get();
}

/** Identité principale (isPrimary) ou, à défaut, la première créée. */
export function getPrimaryIdentity(): IdentityRow | undefined {
  const db = getDb();
  return (
    db.select().from(identities).where(eq(identities.isPrimary, true)).get() ??
    db.select().from(identities).orderBy(identities.id).get()
  );
}

export function updateIdentity(
  id: number,
  patch: Partial<{ label: string; data: IdentityData; isPrimary: boolean }>,
): boolean {
  const db = getDb();
  if (patch.isPrimary) db.update(identities).set({ isPrimary: false }).run();
  const res = db.update(identities).set(patch).where(eq(identities.id, id)).run();
  if (res.changes > 0) audit({ action: "identity_updated", detail: { id } });
  return res.changes > 0;
}

export function deleteIdentity(id: number): boolean {
  const res = getDb().delete(identities).where(eq(identities.id, id)).run();
  if (res.changes > 0) audit({ action: "identity_deleted", detail: { id } });
  return res.changes > 0;
}
