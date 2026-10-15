import React from "react";
import { UserCheck } from "lucide-react";
import * as api from "../api/client";
import { MIN_SUGGESTION_CHARS } from "../usage/knownPeople";

// The sign-in form's "Your Name", with the names already in use suggested as it is typed, so one
// person does not become "TJ" on some plans and "T.J. Pascal" on others. Suggestions need the
// team's username and password first (the server refuses otherwise), which is why this field
// comes after them.

const DEBOUNCE_MS = 250;

export function DisplayNameField({ value, onChange, username, password }: {
  value: string;
  onChange: (value: string) => void;
  username: string;
  password: string;
}) {
  const [suggestions, setSuggestions] = React.useState<Array<{ name: string; plans: number }>>([]);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const listId = React.useId();
  const hasCredentials = Boolean(username.trim() && password.trim());
  const typed = value.trim();

  React.useEffect(() => {
    if (typed.length < MIN_SUGGESTION_CHARS || !hasCredentials) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api.suggestNames({ username, password, query: typed }).then((names) => {
        if (cancelled) return;
        setSuggestions(names);
        setActive(-1);
      });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [typed, hasCredentials, username, password]);

  // Nothing to suggest once the name typed is exactly one already in use.
  const shown = suggestions.length === 1 && suggestions[0].name === typed ? [] : suggestions;
  const visible = open && shown.length > 0;

  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!visible) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % shown.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? shown.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      // Picking a name must not also submit the form.
      e.preventDefault();
      pick(shown[active].name);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <label htmlFor="displayName" className="text-xs font-bold text-slate-700 block">
        Your Name
      </label>
      <div className="relative">
        <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-400">
          <UserCheck className="w-4 h-4" />
        </span>
        <input
          id="displayName"
          type="text"
          required
          autoComplete="off"
          role="combobox"
          aria-expanded={visible}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={visible && active >= 0 ? `${listId}-${active}` : undefined}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          // Delayed so a click on a suggestion lands before the list closes.
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          placeholder="e.g. TJ Pascal"
          className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-600/10 focus:border-indigo-600 transition-all text-slate-800"
        />
        {visible ? (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
          >
            <li className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Already in use</li>
            {shown.map((s, i) => (
              <li
                key={s.name}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s.name);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm ${i === active ? "bg-indigo-50 text-indigo-900" : "text-slate-800"}`}
              >
                <span className="truncate font-medium">{s.name}</span>
                <span className="shrink-0 text-[11px] text-slate-400">{s.plans} plan{s.plans === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <p className="text-[10px] text-slate-400 leading-snug">
        {typed.length >= MIN_SUGGESTION_CHARS && !hasCredentials
          ? "Enter the username and password above to see names already in use."
          : "Shown on the plans you create. If your name is suggested, pick it so your plans stay together."}
      </p>
    </div>
  );
}
