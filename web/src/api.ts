/* Client de l'API locale. Réponses typées en `any` (dashboard local simple). */

async function json(r: Response): Promise<any> {
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || r.statusText);
  return data;
}

function post(url: string, body: unknown = {}): Promise<any> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(json);
}

export const api = {
  status: () => fetch("/api/status").then(json),
  identities: () => fetch("/api/identities").then(json),
  brokers: (query = "") => fetch("/api/brokers" + query).then(json),
  activate: (slug: string, active: boolean) =>
    post(`/api/brokers/${encodeURIComponent(slug)}/activate`, { active }),
  override: (slug: string, patch: Record<string, unknown>, note?: string) =>
    post(`/api/brokers/${encodeURIComponent(slug)}/override`, { patch, note }),
  requests: (query = "") => fetch("/api/requests" + query).then(json),
  requestDetail: (id: number) => fetch(`/api/requests/${id}`).then(json),
  batches: () => fetch("/api/batches").then(json),
  batch: (id: number) => fetch(`/api/batches/${id}`).then(json),
  approve: (id: number) => post(`/api/batches/${id}/approve`),
  reject: (id: number) => post(`/api/batches/${id}/reject`),
  reviewQueue: () => fetch("/api/review-queue").then(json),
  draft: (body: unknown = {}) => post("/api/draft", body),
  send: (body: unknown = {}) => post("/api/send", body),
  verify: () => post("/api/verify", {}),
  rescan: (body: unknown = {}) => post("/api/rescan", body),
  cycle: (body: unknown = {}) => post("/api/cycle", body),
};
