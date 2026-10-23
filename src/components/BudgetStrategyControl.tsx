import React from 'react';
import { DollarSign } from 'lucide-react';
import {
  BUDGET_STRATEGY_DESCRIPTIONS,
  BUDGET_STRATEGY_LABELS,
  BUDGET_STRATEGY_MODES,
  modeNeedsAdditionalBudget,
  type BudgetStrategyMode,
} from '../planning/budgetStrategy';
import { parseCurrencyInput } from '../planning/settings';

interface BudgetStrategyControlProps {
  mode: BudgetStrategyMode;
  additionalBudgetInput: string;
  onModeChange: (mode: BudgetStrategyMode) => void;
  onAdditionalBudgetChange: (value: string) => void;
  /** The RFP's media budget the choice starts from. */
  rfpBudget: number;
  /** The budget tiers' media-type cap for a budget, for the "unlocks more media types" note. */
  capFor?: (budget: number) => number;
  disabled?: boolean;
  idPrefix: string;
  /** Limits the choices, e.g. the upload review offers "as is" separately. Defaults to all four. */
  modes?: BudgetStrategyMode[];
}

const money = (value: number) => `$${Math.round(value).toLocaleString()}`;

/**
 * The four ways to plan an uploaded RFP's budget. Used in the brief before a plan exists and on
 * the plan afterwards, so a planner can change the budget approach at either point.
 */
export const BudgetStrategyControl: React.FC<BudgetStrategyControlProps> = ({
  mode,
  additionalBudgetInput,
  onModeChange,
  onAdditionalBudgetChange,
  rfpBudget,
  capFor,
  disabled = false,
  idPrefix,
  modes = BUDGET_STRATEGY_MODES,
}) => {
  const additional = parseCurrencyInput(additionalBudgetInput);
  const needsAdditional = modeNeedsAdditionalBudget(mode);
  const total = rfpBudget + (needsAdditional ? additional : 0);

  let capNote = '';
  if (capFor && needsAdditional && additional > 0) {
    if (mode === 'incremental') {
      const cap = capFor(additional);
      if (cap > 0) capNote = `The additional ${money(additional)} can fund up to ${cap} new media type${cap === 1 ? '' : 's'}.`;
    } else {
      const before = capFor(rfpBudget);
      const after = capFor(total);
      if (after > before) capNote = `At ${money(total)} the plan can include up to ${after} media types, ${after - before} more than at ${money(rfpBudget)}.`;
    }
  }

  return (
    <div className="space-y-2.5">
      <div role="radiogroup" aria-label="Budget approach" className={`grid gap-2 sm:grid-cols-2 ${modes.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4'}`}>
        {modes.map((option) => {
          const selected = option === mode;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onModeChange(option)}
              className={`rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${selected ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
            >
              <div className={`text-xs font-extrabold ${selected ? 'text-indigo-900' : 'text-slate-900'}`}>{BUDGET_STRATEGY_LABELS[option]}</div>
              <div className="mt-1 text-[11px] leading-4 text-slate-600">{BUDGET_STRATEGY_DESCRIPTIONS[option]}</div>
            </button>
          );
        })}
      </div>
      {needsAdditional && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <label htmlFor={`${idPrefix}-additional-budget`} className="flex items-center gap-1 text-xs font-bold text-slate-700">
            <DollarSign className="h-3.5 w-3.5 text-indigo-600" /> Additional budget
          </label>
          <input
            id={`${idPrefix}-additional-budget`}
            type="text"
            inputMode="decimal"
            value={additionalBudgetInput}
            disabled={disabled}
            onChange={(event) => onAdditionalBudgetChange(event.target.value)}
            placeholder="25,000"
            className="w-32 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
          <span className="text-xs text-slate-600">
            {additional > 0
              ? <>Plan total <span className="font-bold text-slate-900">{money(total)}</span> ({money(rfpBudget)} RFP + {money(additional)} additional)</>
              : <span className="font-semibold text-amber-700">Enter the additional budget to plan with.</span>}
          </span>
        </div>
      )}
      {capNote && <p className="text-[11px] font-semibold text-emerald-700">{capNote}</p>}
    </div>
  );
};
