import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

type Tab = "overview" | "brokers" | "requests" | "batches" | "review";

interface Async<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

const CONF_LABEL: Record<string, string> = {
  confirmed_email: "confirmé (email)",
  confirmed_rescan: "confirmé (re-scan)",
  reminded: "relancé",
  pending: "en attente",
  unverifiable: "invérifiable",
  refused: "refusé",
};

function Badge({ kind, value }: { kind: string; value: string }) {
  return <span className={`badge badge-${kind}`}>{value}</span>;
}

function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): Async<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(() => {
    setLoading(true);
    fn()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(reload, [reload]);
  return { data, error, loading, reload };
}

export function App() {
  const [tab, setTab] = useState<Tab>("overview");
  const status = useAsync<any>(() => api.status(), []);

  return (
    <div className="app">
      <header>
        <h1>deletedata</h1>
        <span className={`mode ${status.data?.live ? "live" : "dry"}`}>
          {status.data?.live ? "● MODE LIVE (envois réels)" : "● DRY-RUN (aucun envoi)"}
        </span>
      </header>

      <nav>
        {(["overview", "brokers", "requests", "batches", "review"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t === "overview"
              ? "Vue d'ensemble"
              : t === "brokers"
                ? "Brokers"
                : t === "requests"
                  ? "Demandes"
                  : t === "batches"
                    ? "Lots / approbation"
                    : "À revoir"}
          </button>
        ))}
      </nav>

      <main>
        {tab === "overview" && <Overview status={status} />}
        {tab === "brokers" && <Brokers />}
        {tab === "requests" && <Requests />}
        {tab === "batches" && <Batches onChange={status.reload} />}
        {tab === "review" && <ReviewQueue />}
      </main>
    </div>
  );
}

function Overview({ status }: { status: Async<any> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const s = status.data;

  const act = async (name: string, fn: () => Promise<any>) => {
    if (!confirm(`Lancer « ${name} » ?`)) return;
    setBusy(name);
    try {
      const r = await fn();
      alert(`${name} : ${JSON.stringify(r)}`);
      status.reload();
    } catch (e) {
      alert(`Erreur : ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  if (status.error) return <p className="error">Erreur : {status.error}</p>;
  if (!s) return <p>Chargement…</p>;

  return (
    <div>
      <section className="hero">
        <div className="pct">{s.confirmedDeletedPct}%</div>
        <div className="pct-label">
          de mes données <strong>confirmées supprimées</strong>
          <br />
          <small>
            {s.confirmedDeleted} confirmées / {s.actioned} demandes actionnées — jamais gonflé
          </small>
        </div>
      </section>

      <div className="cards">
        <Card title="Brokers" value={`${s.brokers.active} / ${s.brokers.total}`} sub="actifs / total" />
        <Card title="Demandes" value={s.requestsTotal} sub="au total" />
        <Card title="Échéances dépassées" value={s.overdueAwaiting} sub="en attente" />
        <Card title="À revoir" value={s.reviewQueue} sub="mails non rattachés" />
      </div>

      <div className="cols">
        <div>
          <h3>Par statut</h3>
          <KeyVals obj={s.byStatus} />
        </div>
        <div>
          <h3>Par confiance</h3>
          <KeyVals obj={s.byConfidence} labels={CONF_LABEL} />
        </div>
      </div>

      {s.failures?.length > 0 && (
        <section>
          <h3>Échecs ({s.failures.length})</h3>
          <ul className="failures">
            {s.failures.map((f: any) => (
              <li key={f.requestId}>
                #{f.requestId} <b>{f.broker}</b> — {f.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="actions">
        <h3>Actions</h3>
        <button disabled={!!busy} onClick={() => act("Générer brouillons", () => api.draft())}>
          Générer brouillons
        </button>
        <button disabled={!!busy} onClick={() => act("Envoyer (dry-run sauf si live)", () => api.send())}>
          Envoyer
        </button>
        <button disabled={!!busy} onClick={() => act("Vérifier IMAP", () => api.verify())}>
          Vérifier (IMAP)
        </button>
        <button disabled={!!busy} onClick={() => act("Re-scan", () => api.rescan())}>
          Re-scan
        </button>
        <button disabled={!!busy} onClick={() => act("Cycle complet", () => api.cycle())}>
          Cycle complet
        </button>
        {busy && <span className="busy">… {busy}</span>}
      </section>
    </div>
  );
}

function Card({ title, value, sub }: { title: string; value: any; sub: string }) {
  return (
    <div className="card">
      <div className="card-title">{title}</div>
      <div className="card-value">{value}</div>
      <div className="card-sub">{sub}</div>
    </div>
  );
}

function KeyVals({ obj, labels }: { obj: Record<string, number>; labels?: Record<string, string> }) {
  const entries = Object.entries(obj || {});
  if (!entries.length) return <p className="muted">—</p>;
  return (
    <ul className="kv">
      {entries.map(([k, v]) => (
        <li key={k}>
          <span>{labels?.[k] ?? k}</span>
          <b>{v}</b>
        </li>
      ))}
    </ul>
  );
}

function Brokers() {
  const [active, setActive] = useState(true);
  const [channel, setChannel] = useState("");
  const [search, setSearch] = useState("");
  const q = `?${active ? "active=true&" : ""}${channel ? `channel=${channel}&` : ""}${search ? `search=${encodeURIComponent(search)}` : ""}`;
  const list = useAsync<any[]>(() => api.brokers(q), [q]);

  const toggle = async (slug: string, value: boolean) => {
    await api.activate(slug, value);
    list.reload();
  };
  const override = async (slug: string) => {
    const kv = prompt("Override (ex: email=x@y.com ou channel=email) :");
    if (!kv) return;
    const i = kv.indexOf("=");
    if (i < 0) return alert("Format key=value attendu.");
    await api.override(slug, { [kv.slice(0, i).trim()]: kv.slice(i + 1) }, "via dashboard");
    list.reload();
  };

  return (
    <div>
      <div className="filters">
        <label>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> actifs seulement
        </label>
        <select value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="">tous canaux</option>
          <option value="email">email</option>
          <option value="form">form</option>
          <option value="manual">manual</option>
        </select>
        <input placeholder="recherche…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {list.error && <p className="error">{list.error}</p>}
      <table>
        <thead>
          <tr>
            <th>slug</th>
            <th>nom</th>
            <th>canal</th>
            <th>juri.</th>
            <th>vérif.</th>
            <th>actif</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {(list.data ?? []).map((b) => (
            <tr key={b.slug}>
              <td>{b.slug}</td>
              <td>{b.name}</td>
              <td><Badge kind={b.channel} value={b.channel} /></td>
              <td>{b.jurisdiction}</td>
              <td>{b.verificationMethod}</td>
              <td>{b.active ? "oui" : "—"}</td>
              <td>
                <button onClick={() => toggle(b.slug, !b.active)}>{b.active ? "désactiver" : "activer"}</button>
                <button onClick={() => override(b.slug)}>override</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">{list.data?.length ?? 0} broker(s)</p>
    </div>
  );
}

function Requests() {
  const [status, setStatus] = useState("");
  const [notSent, setNotSent] = useState(false);
  const q = `?${status ? `status=${status}&` : ""}${notSent ? "notSent=true" : ""}`;
  const list = useAsync<any[]>(() => api.requests(q), [q]);
  const [detail, setDetail] = useState<any>(null);

  return (
    <div>
      <div className="filters">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">tous statuts</option>
          {["draft", "awaiting_approval", "approved", "sent", "acknowledged", "reminded", "confirmed", "refused", "needs_info", "manual_required", "failed"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={notSent} onChange={(e) => setNotSent(e.target.checked)} /> non envoyées
        </label>
      </div>
      <table>
        <thead>
          <tr><th>id</th><th>broker</th><th>canal</th><th>statut</th><th>confiance</th><th>deadline</th><th>preuve</th></tr>
        </thead>
        <tbody>
          {(list.data ?? []).map((r) => (
            <tr key={r.id} onClick={() => api.requestDetail(r.id).then(setDetail)} className="clickable">
              <td>{r.id}</td>
              <td>{r.broker}</td>
              <td>{r.channel}</td>
              <td><Badge kind={r.status} value={r.status} /></td>
              <td>{CONF_LABEL[r.confidence] ?? r.confidence}</td>
              <td>{r.deadlineAt ? new Date(r.deadlineAt).toLocaleDateString("fr-FR") : "—"}</td>
              <td>{r.hasProof ? "✓" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {detail && (
        <div className="modal" onClick={() => setDetail(null)}>
          <div className="modal-body" onClick={(e) => e.stopPropagation()}>
            <h3>{detail.brokerName} — #{detail.request.id}</h3>
            <p><b>Statut :</b> {detail.request.status} / {CONF_LABEL[detail.request.confidenceStatus] ?? detail.request.confidenceStatus}</p>
            <p><b>To :</b> {detail.request.plusAlias ?? "—"}</p>
            <p><b>Sujet :</b> {detail.request.subject}</p>
            <pre>{detail.request.body}</pre>
            {detail.request.proof && <p className="proof"><b>Preuve :</b> {JSON.stringify(detail.request.proof)}</p>}
            <button onClick={() => setDetail(null)}>fermer</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Batches({ onChange }: { onChange: () => void }) {
  const list = useAsync<any[]>(() => api.batches(), []);
  const [open, setOpen] = useState<any[] | null>(null);

  const approve = async (id: number) => {
    if (!confirm(`Approuver le lot #${id} ? (prérequis à l'envoi)`)) return;
    await api.approve(id);
    list.reload();
    onChange();
  };
  const reject = async (id: number) => {
    await api.reject(id);
    list.reload();
  };

  return (
    <div>
      <table>
        <thead>
          <tr><th>lot</th><th>statut</th><th>à approuver</th><th>total</th><th></th></tr>
        </thead>
        <tbody>
          {(list.data ?? []).map((b) => (
            <tr key={b.id}>
              <td>#{b.id}</td>
              <td><Badge kind={b.status} value={b.status} /></td>
              <td>{b.pending}</td>
              <td>{b.count}</td>
              <td>
                <button onClick={() => api.batch(b.id).then(setOpen)}>voir</button>
                {b.status === "pending" && <button onClick={() => approve(b.id)}>approuver</button>}
                {b.status === "pending" && <button onClick={() => reject(b.id)}>rejeter</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && (
        <div className="modal" onClick={() => setOpen(null)}>
          <div className="modal-body" onClick={(e) => e.stopPropagation()}>
            <h3>Demandes du lot</h3>
            <ul>
              {open.map((it: any) => (
                <li key={it.request.id}>
                  <b>{it.brokerName}</b> [{it.request.channel}] — {it.request.subject}
                </li>
              ))}
            </ul>
            <button onClick={() => setOpen(null)}>fermer</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewQueue() {
  const list = useAsync<any[]>(() => api.reviewQueue(), []);
  return (
    <table>
      <thead>
        <tr><th>de</th><th>à</th><th>sujet</th><th>raison</th></tr>
      </thead>
      <tbody>
        {(list.data ?? []).map((m) => (
          <tr key={m.id}>
            <td>{m.fromAddr}</td>
            <td>{m.toAddr}</td>
            <td>{m.subject}</td>
            <td>{m.reason}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
