import React, { useState, useEffect, useRef } from 'react';
import { Eye, EyeOff, Edit2, RotateCcw } from 'lucide-react';
import { PlanText } from './PlanText';
import { hasPlanTextList } from '../utils/planText';

export interface EditableDetailCardProps {
  panelKey: string;
  defaultTitle: string;
  defaultContent: string;
  titleOverride?: string;
  contentOverride?: string;
  isInactive?: boolean;
  readOnly?: boolean;
  onToggleActive?: (inactive: boolean) => void;
  onSave?: (title: string, content: string) => void;
  onReset?: () => void;
  fullWidth?: boolean;
  hasOverride?: boolean;
  customView?: React.ReactNode;
}

export const EditableDetailCard: React.FC<EditableDetailCardProps> = ({
  panelKey,
  defaultTitle,
  defaultContent,
  titleOverride,
  contentOverride,
  isInactive = false,
  readOnly = false,
  onToggleActive,
  onSave,
  onReset,
  fullWidth = false,
  hasOverride = false,
  customView,
}) => {
  const effectiveTitle = titleOverride !== undefined ? titleOverride : defaultTitle;
  const effectiveContent = contentOverride !== undefined ? contentOverride : defaultContent;

  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(effectiveTitle);
  const [draftContent, setDraftContent] = useState(effectiveContent);
  const cardRef = useRef<HTMLDivElement>(null);

  // Sync draft state with effective values when not editing
  useEffect(() => {
    if (!isEditing) {
      setDraftTitle(effectiveTitle);
      setDraftContent(effectiveContent);
    }
  }, [effectiveTitle, effectiveContent, isEditing]);

  const commitEdits = () => {
    setIsEditing(false);
    if (onSave) {
      onSave(draftTitle.trim(), draftContent.trim());
    }
  };

  const handleBlurContainer = (e: React.FocusEvent<HTMLDivElement>) => {
    // If the newly focused element is still inside our card, don't commit yet
    if (cardRef.current && cardRef.current.contains(e.relatedTarget as Node)) {
      return;
    }
    commitEdits();
  };

  // If in readOnly (share view) and inactive, completely omit from DOM
  if (readOnly && isInactive) {
    return null;
  }

  return (
    <div
      ref={cardRef}
      data-panel-key={panelKey}
      className={`group relative rounded-xl border p-3 transition-all ${
        fullWidth ? 'md:col-span-2' : ''
      } ${
        isInactive
          ? 'border-dashed border-slate-300 bg-slate-100/70 opacity-40 hover:opacity-70'
          : 'border-slate-200/80 bg-slate-50/90 hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      {/* Top right action controls for planner mode */}
      {!readOnly && (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
          {hasOverride && onReset && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onReset();
              }}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 opacity-0 transition-opacity hover:bg-slate-200/60 hover:text-slate-700 group-hover:opacity-100"
              title="Reset to default"
              aria-label="Reset to default"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          )}

          {!isEditing && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
              }}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 opacity-0 transition-opacity hover:bg-slate-200/60 hover:text-slate-700 group-hover:opacity-100"
              title="Click to edit"
              aria-label="Edit text"
            >
              <Edit2 className="h-3 w-3" />
            </button>
          )}

          {onToggleActive && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleActive(!isInactive);
              }}
              className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition-all ${
                isInactive
                  ? 'bg-amber-100/80 text-amber-700 opacity-100 hover:bg-amber-200'
                  : 'text-slate-400 opacity-0 transition-opacity hover:bg-slate-200/60 hover:text-slate-700 group-hover:opacity-100'
              }`}
              title={
                isInactive
                  ? 'Inactive (hidden from share link) - click to show'
                  : 'Active - click to hide from share link'
              }
              aria-label={isInactive ? 'Show in share view' : 'Hide from share view'}
            >
              {isInactive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      )}

      {/* Editing Mode */}
      {!readOnly && isEditing ? (
        <div
          className="space-y-2"
          onBlur={handleBlurContainer}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setDraftTitle(effectiveTitle);
              setDraftContent(effectiveContent);
              setIsEditing(false);
            }
          }}
        >
          <div>
            <label className="mb-0.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Title / Label
            </label>
            <input
              type="text"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              className="w-full rounded-md border border-indigo-300 bg-white px-2 py-1 text-xs font-bold text-slate-900 shadow-2xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              placeholder="Panel title..."
              autoFocus
            />
          </div>
          <div>
            <label className="mb-0.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Body Content
            </label>
            <textarea
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-indigo-300 bg-white px-2 py-1.5 text-xs text-slate-800 shadow-2xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              placeholder="Content details..."
            />
          </div>
          <div className="flex items-center justify-between pt-1">
            <span className="text-[10px] text-slate-400">Auto-saves on blur • Esc to cancel</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault(); // Prevent blur from committing before cancel
                  setDraftTitle(effectiveTitle);
                  setDraftContent(effectiveContent);
                  setIsEditing(false);
                }}
                className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault(); // Commit right away
                  commitEdits();
                }}
                className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-bold text-white shadow-2xs hover:bg-indigo-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* View / Click-to-edit Mode */
        <div
          onClick={() => {
            if (!readOnly) setIsEditing(true);
          }}
          className={`${!readOnly ? 'cursor-pointer' : ''} pr-12`}
        >
          <span className="font-bold text-slate-900">
            {effectiveTitle}
            {effectiveTitle.endsWith(':') ? ' ' : ': '}
          </span>
          {contentOverride === undefined && customView ? (
            <span className="text-slate-700 leading-relaxed whitespace-pre-wrap">{customView}</span>
          ) : hasPlanTextList(effectiveContent || '') ? (
            // A bulleted list cannot sit inline after the title, so it drops below it.
            <PlanText text={effectiveContent} className="mt-1 text-slate-700 leading-relaxed" />
          ) : (
            <span className="text-slate-700 leading-relaxed whitespace-pre-wrap">{effectiveContent || 'None specified.'}</span>
          )}
          {isInactive && !readOnly && (
            <span className="ml-2 inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800">
              Inactive in share link
            </span>
          )}
        </div>
      )}
    </div>
  );
};
