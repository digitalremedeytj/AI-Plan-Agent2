import React from "react";
import { Eye, Loader2 } from "lucide-react";
import * as api from "../api/client";

// The amber bar shown on every page (main app, dashboard, ScoutAI review) while an admin is viewing
// the app as an editor or a user, so nobody mistakes a narrowed view for a bug. Mounted once in
// main.tsx; it asks the server who is signed in rather than trusting anything client-side.

const DESCRIPTIONS: Record<"editor" | "user", string> = {
  editor: "You can change settings, but not manage people.",
  user: "Settings are read-only, and admin pages are closed to you.",
};

/** Switches view and reloads, so every page and permission starts from the new role. */
export async function switchViewAs(role: "editor" | "user" | null): Promise<void> {
  await api.setViewAs(role);
  window.location.reload();
}

export function ViewAsBanner() {
  const [viewAs, setViewAs] = React.useState<"editor" | "user" | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    api.fetchSession().then((user) => setViewAs(user?.viewAs ?? null)).catch(() => {});
  }, []);

  if (!viewAs) return null;
  const label = viewAs === "editor" ? "Editor" : "User";
  return (
    <div role="status" className="relative z-[60] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-400 px-4 py-2 text-sm text-amber-950 shadow-sm print:hidden">
      <Eye className="h-4 w-4 shrink-0" />
      <span>
        <strong className="font-bold">Viewing as {label}.</strong> {DESCRIPTIONS[viewAs]} Changes you make are still saved as you.
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          switchViewAs(null).catch((err) => {
            setError(err?.message || "Could not switch back. Try again.");
            setBusy(false);
          });
        }}
        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-950 px-3 py-1 text-xs font-bold text-amber-50 hover:bg-amber-900 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Return to Admin
      </button>
      {error ? <span className="w-full text-center text-xs font-semibold">{error}</span> : null}
    </div>
  );
}
