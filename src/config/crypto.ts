/**
 * Cryptographie applicative.
 *
 *  1. `deriveDbKeyHex` : dérive (scrypt) une clé brute 32 octets depuis la
 *     passphrase, pour ouvrir la base SQLCipher via `PRAGMA key="x'...'"`.
 *     Passer une clé hex brute évite tout problème d'échappement de la
 *     passphrase dans le PRAGMA.
 *  2. `encryptField` / `decryptField` : chiffrement AES-256-GCM d'un champ
 *     applicatif (couche optionnelle pour tout secret persisté en base ;
 *     la base entière est déjà chiffrée par SQLCipher).
 */
import {
  scryptSync,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { requireDb } from "./env";

const KEY_LEN = 32;
// Paramètres scrypt raisonnables pour un poste de travail (dérivation < 1s).
const SCRYPT = { N: 16384, r: 8, p: 1 } as const;

// Sels fixes avec séparation de domaine (clé DB ≠ clé champs applicatifs).
// Acceptable pour un outil local mono-utilisateur ; l'IV aléatoire par valeur
// fournit la sécurité sémantique.
const DB_SALT = Buffer.from("deletedata.v1.db-salt", "utf8");
const FIELD_SALT = Buffer.from("deletedata.v1.field-salt", "utf8");

/** Clé brute hex (32 octets) pour SQLCipher. */
export function deriveDbKeyHex(passphrase: string): string {
  return scryptSync(passphrase, DB_SALT, KEY_LEN, SCRYPT).toString("hex");
}

let cachedFieldKey: Buffer | null = null;
function fieldKey(): Buffer {
  if (cachedFieldKey) return cachedFieldKey;
  const { passphrase } = requireDb();
  cachedFieldKey = scryptSync(passphrase, FIELD_SALT, KEY_LEN, SCRYPT);
  return cachedFieldKey;
}

/** Chiffre une chaîne -> token `gcm.v1.<iv>.<tag>.<ciphertext>` (base64). */
export function encryptField(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", fieldKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "gcm",
    "v1",
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(".");
}

/** Déchiffre un token produit par `encryptField`. */
export function decryptField(token: string): string {
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== "gcm" || parts[1] !== "v1") {
    throw new Error("Champ chiffré au format invalide.");
  }
  const iv = Buffer.from(parts[2]!, "base64");
  const tag = Buffer.from(parts[3]!, "base64");
  const ct = Buffer.from(parts[4]!, "base64");
  const decipher = createDecipheriv("aes-256-gcm", fieldKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
