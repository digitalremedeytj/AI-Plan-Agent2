import React from 'react';
import { Ellipsis, Loader2 } from 'lucide-react';

export interface RowAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Shown as the item's tooltip when it is disabled, so the planner knows what to do instead. */
  disabledReason?: string;
}

/**
 * A row's secondary actions behind one small "⋯" button, so a list row spends its width on
 * content rather than on a column of controls. Keyboard: Enter/Space or ArrowDown opens and
 * focuses the first item, arrows move, Escape closes and returns focus to the button.
 */
export const RowActionsMenu: React.FC<{ label: string; actions: RowAction[]; busy?: boolean }> = ({ label, actions, busy = false }) => {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = React.useId();

  const close = (returnFocus = false) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  React.useEffect(() => {
    if (!open) return;
    itemRefs.current.find((item) => item && !item.disabled)?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const moveFocus = (step: number) => {
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => Boolean(item) && !item!.disabled);
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(index + step + items.length) % items.length].focus();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); }
        }}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-wait ${open ? 'bg-slate-100 text-slate-700' : ''}`}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ellipsis className="h-4 w-4" />}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); close(true); }
            else if (event.key === 'ArrowDown') { event.preventDefault(); moveFocus(1); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); moveFocus(-1); }
            else if (event.key === 'Tab') close();
          }}
          className="absolute right-0 top-full z-20 mt-1 w-48 rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
        >
          {actions.map((action, index) => (
            <button
              key={action.id}
              ref={(element) => { itemRefs.current[index] = element; }}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              title={action.disabled ? action.disabledReason : undefined}
              onClick={() => { close(true); action.onSelect(); }}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${action.danger ? 'text-rose-700 hover:bg-rose-50 focus:bg-rose-50' : 'text-slate-700 hover:bg-slate-50 focus:bg-slate-50'}`}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
