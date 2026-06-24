/** Petits utilitaires texte (slug, domaines, troncature). */

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "broker"
  );
}

export function domainFromUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

export function domainFromEmail(email: string): string | undefined {
  const at = email.lastIndexOf("@");
  if (at < 0) return undefined;
  return email.slice(at + 1).trim().toLowerCase() || undefined;
}

export function truncate(s: string, n: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length <= n ? clean : clean.slice(0, n - 1) + "…";
}
