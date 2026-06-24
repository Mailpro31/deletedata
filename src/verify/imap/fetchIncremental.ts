/**
 * Lecture IMAP INCRÉMENTALE par UID (idempotence).
 *
 * On ne récupère que les mails d'UID > dernier UID traité, on persiste l'UID max
 * au fil de l'eau (dans le pipeline). On gère le changement d'`uidValidity`
 * (qui invalide les UID -> on repart de 0).
 */
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/client";
import { imapState } from "../../db/schema";
import { createImapClient } from "./client";
import { requireImap } from "../../config/env";
import { log } from "../../config/logger";

export interface ParsedMessage {
  uid: number;
  from?: string;
  fromName?: string;
  to: string[]; // To + Cc + Delivered-To, en minuscules
  subject: string;
  messageId?: string;
  inReplyTo?: string;
  references: string[];
  text: string;
  date?: Date;
}

function getState() {
  const db = getDb();
  let st = db.select().from(imapState).where(eq(imapState.id, 1)).get();
  if (!st) {
    db.insert(imapState).values({ id: 1, mailbox: requireImap().mailbox, lastSeenUid: 0 }).run();
    st = db.select().from(imapState).where(eq(imapState.id, 1)).get()!;
  }
  return st;
}

export function setLastSeenUid(uid: number): void {
  const db = getDb();
  const st = getState();
  if (uid > st.lastSeenUid) {
    db.update(imapState).set({ lastSeenUid: uid }).where(eq(imapState.id, 1)).run();
  }
}

export function setUidValidity(v: number): void {
  getDb().update(imapState).set({ uidValidity: v }).where(eq(imapState.id, 1)).run();
}

function addrList(a: AddressObject | AddressObject[] | undefined): string[] {
  if (!a) return [];
  const arr = Array.isArray(a) ? a : [a];
  const out: string[] = [];
  for (const obj of arr) {
    for (const v of obj.value ?? []) {
      if (v.address) out.push(v.address.toLowerCase());
    }
  }
  return out;
}

function deliveredTo(p: ParsedMail): string[] {
  const dt = p.headers?.get("delivered-to");
  if (!dt) return [];
  if (typeof dt === "string") return [dt.toLowerCase()];
  if (Array.isArray(dt)) return dt.filter((x) => typeof x === "string").map((x) => (x as string).toLowerCase());
  return [];
}

function toParsedMessage(uid: number, p: ParsedMail): ParsedMessage {
  const fromVal = p.from?.value?.[0];
  const recipients = [...addrList(p.to), ...addrList(p.cc), ...deliveredTo(p)];
  const refs = p.references ? (Array.isArray(p.references) ? p.references : [p.references]) : [];
  return {
    uid,
    from: fromVal?.address?.toLowerCase(),
    fromName: fromVal?.name || undefined,
    to: [...new Set(recipients)],
    subject: p.subject ?? "",
    messageId: p.messageId,
    inReplyTo: p.inReplyTo,
    references: refs,
    text: p.text ?? (typeof p.html === "string" ? p.html : "") ?? "",
    date: p.date,
  };
}

export interface FetchResult {
  uidValidity?: number;
  messages: ParsedMessage[];
}

export async function fetchNewMessages(): Promise<FetchResult> {
  const c = requireImap();
  const state = getState();
  const client = createImapClient();
  await client.connect();

  const messages: ParsedMessage[] = [];
  let uidValidity: number | undefined;
  try {
    const lock = await client.getMailboxLock(c.mailbox);
    try {
      const mb = client.mailbox;
      uidValidity = mb ? Number(mb.uidValidity) : undefined;

      let startUid = state.lastSeenUid;
      if (state.uidValidity && uidValidity && state.uidValidity !== uidValidity) {
        log.warn("uidValidity a changé -> réinitialisation du suivi UID (relecture).");
        startUid = 0;
      }

      const range = `${startUid + 1}:*`;
      for await (const msg of client.fetch(
        range,
        { uid: true, source: true, envelope: true, internalDate: true },
        { uid: true },
      )) {
        const uid = Number(msg.uid);
        // Quirk IMAP : `N:*` renvoie toujours le dernier message même si N > max.
        if (uid <= startUid) continue;
        if (!msg.source) continue;
        const parsed = await simpleParser(msg.source);
        messages.push(toParsedMessage(uid, parsed));
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  messages.sort((a, b) => a.uid - b.uid);
  return { uidValidity, messages };
}
