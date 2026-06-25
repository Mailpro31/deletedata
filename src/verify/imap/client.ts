/** Connexion IMAP (imapflow). */
import { ImapFlow } from "imapflow";
import { requireImap } from "../../config/env";

export function createImapClient(): ImapFlow {
  const c = requireImap();
  return new ImapFlow({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: { user: c.user, pass: c.pass },
    logger: false,
  });
}

/** Vérifie la connexion IMAP (pour `test-connections`). */
export async function verifyImap(): Promise<{ mailbox: string; exists: number }> {
  const c = requireImap();
  const client = createImapClient();
  await client.connect();
  try {
    const lock = await client.getMailboxLock(c.mailbox);
    try {
      const mb = client.mailbox;
      return { mailbox: c.mailbox, exists: mb ? mb.exists : 0 };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}
