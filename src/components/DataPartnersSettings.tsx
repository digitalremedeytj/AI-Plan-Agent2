import React from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import * as api from "../api/client";
import type { PartnerProvider, PartnerProviderOverride } from "../research/partnerData";
import { PartnerLogo } from "./PartnerLogo";

// Settings -> Data Partners: each partner's logo and the line a client reads under it on a plan.
// Logos are stored as images (/api/images), which a share link can show without a session; a plan
// shows the logo as it is here today, so uploading one later updates plans already shared.

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export function DataPartnersSettings({ readOnly }: { readOnly: boolean }) {
  const [providers, setProviders] = React.useState<PartnerProvider[] | null>(null);
  const [revision, setRevision] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  const [uploading, setUploading] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [dirty, setDirty] = React.useState(false);

  const load = React.useCallback(() => {
    api.getPartnerProviders()
      .then((r) => { setProviders(r.providers); setRevision(r.revision); setDirty(false); })
      .catch((err) => setMessage({ tone: "error", text: err?.message || "The data partners could not be loaded." }));
  }, []);
  React.useEffect(load, [load]);

  if (!providers) return <div className="p-6 flex items-center gap-2 text-xs text-slate-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>;

  const update = (id: string, patch: Partial<PartnerProvider>) => {
    setProviders(providers.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    setDirty(true);
  };

  const uploadLogo = async (id: string, file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setMessage({ tone: "error", text: "Use a PNG, JPEG or WebP logo." });
    if (file.size > MAX_LOGO_BYTES) return setMessage({ tone: "error", text: "That logo is over 2 MB." });
    setUploading(id);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const res = await api.authFetch("/api/images", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl }) });
      const body = await res.json().catch(() => null);
      if (!res.ok || typeof body?.url !== "string") throw new Error(body?.error || "The logo could not be stored.");
      update(id, { logoUrl: body.url });
      setMessage(null);
    } catch (err: any) {
      setMessage({ tone: "error", text: err?.message || "The logo could not be stored." });
    } finally {
      setUploading(null);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const overrides: PartnerProviderOverride[] = providers.map((p) => ({ id: p.id, logoUrl: p.logoUrl, description: p.description }));
      const r = await api.savePartnerProviders(overrides, revision);
      setProviders(r.providers);
      setRevision(r.revision);
      setDirty(false);
      setMessage({ tone: "ok", text: "Saved. Plans show the new logos straight away, including shared links." });
    } catch (err: any) {
      setMessage({ tone: "error", text: err?.status === 409 ? "Someone else changed the data partners. Reload to see their changes." : err?.message || "Could not save." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-slate-900">Data partners</h3>
        <p className="text-xs text-slate-500 mt-0.5">The logos and descriptions clients see on plans built with partner research. Until a logo is uploaded, the partner's name is shown in its colour.</p>
      </div>
      <ul className="space-y-2">
        {providers.filter((p) => p.id !== "other").map((p) => (
          <li key={p.id} className="rounded-xl border border-slate-200 bg-white p-3 flex flex-col md:flex-row md:items-center gap-3">
            <div className="w-40 shrink-0 flex items-center h-10"><PartnerLogo provider={p} size="lg" /></div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-slate-800">{p.name}</div>
              <input
                value={p.description}
                disabled={readOnly}
                onChange={(e) => update(p.id, { description: e.target.value })}
                className="mt-1 w-full text-xs px-2 py-1.5 border border-slate-200 rounded-lg disabled:bg-slate-50"
              />
            </div>
            {!readOnly && (
              <div className="flex items-center gap-1.5 shrink-0">
                <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50 border border-indigo-100 px-2.5 py-1.5 rounded-lg cursor-pointer">
                  {uploading === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
                  {p.logoUrl ? "Replace logo" : "Upload logo"}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { void uploadLogo(p.id, e.target.files?.[0]); e.target.value = ""; }} />
                </label>
                {p.logoUrl && (
                  <button type="button" onClick={() => update(p.id, { logoUrl: "" })} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer" aria-label={`Remove ${p.name} logo`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {message && <p className={`text-xs ${message.tone === "error" ? "text-rose-600" : "text-emerald-700"}`}>{message.text}</p>}
      {!readOnly && (
        <div className="flex justify-end gap-2">
          {dirty && <button type="button" onClick={load} className="text-xs font-semibold text-slate-600 hover:bg-slate-100 px-3 py-1.5 rounded-lg cursor-pointer">Discard</button>}
          <button type="button" onClick={save} disabled={!dirty || saving} className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 px-4 py-2 rounded-lg cursor-pointer disabled:cursor-not-allowed">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save data partners
          </button>
        </div>
      )}
    </div>
  );
}
