'use client';

import { Star } from 'lucide-react';
import { useState } from 'react';
import { categoryPillClass } from '@/lib/category-colors';
import { senderColor, senderInitial, senderName } from '@/lib/sender-style';
import type { DraftWithMessage } from '@/lib/types';
import { FreshnessChip } from './FreshnessChip';
import { TimeAgo } from './TimeAgo';

// Gmail-style compact list row (STAQPRO-382 Phase 2a-3, 2026-05-15).
// Replaces the prior fixed-h-14 Outlook-style row with:
//   - sender avatar bubble (initial + per-sender color, h-7 w-7)
//   - star toggle (local state for now — Phase 2c will persist)
//   - saturated category color pill (CATEGORY_COLORS map)
//   - content-driven row height (py-2 instead of fixed h-14)
//
// `mode` controls whether the row reflects the inbound classification
// (pending view) or the outbound disposition (sent view).
export function DraftCard({
  draft,
  isSelected,
  mode = 'pending',
  onSelect,
}: {
  draft: DraftWithMessage;
  isSelected: boolean;
  mode?: 'pending' | 'sent';
  onSelect: () => void;
}) {
  const m = draft.message;
  const fromAddr = m.from_addr ?? '';
  const displayName = senderName(fromAddr);

  // Star state is local for now. Phase 2c lifts this to a parent-managed
  // map keyed by draft.id and persists via a new mailbox.draft_stars table
  // (or persona.statistical_markers if we keep it simple).
  const [starred, setStarred] = useState(false);

  // Sent view shows when the draft was finalized.
  const sentTimestamp = draft.sent_at ?? draft.updated_at ?? draft.created_at;
  const dispositionLabel = mode === 'sent' ? draft.status : null;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={isSelected}
      className={`group flex w-full items-center gap-2 border-l-2 px-2 py-2 text-left transition-colors duration-100 ${
        isSelected
          ? 'border-l-accent-orange bg-bg-panel'
          : 'border-l-transparent hover:bg-bg-panel/60'
      }`}
    >
      {/* Sender avatar — initial inside a per-sender colored circle. */}
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${senderColor(fromAddr)}`}
        title={fromAddr}
      >
        {senderInitial(fromAddr)}
      </div>

      {/* Star toggle. Click eats the parent button click so toggling doesn't
          select the row. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setStarred((s) => !s);
        }}
        className="shrink-0 p-1 text-ink-dim hover:text-amber-400"
        aria-label={starred ? 'Unstar draft' : 'Star draft'}
        aria-pressed={starred}
      >
        <Star className={`h-4 w-4 ${starred ? 'fill-amber-400 text-amber-400' : ''}`} />
      </button>

      {/* Sender + subject + meta. min-w-0 to allow truncation inside flex. */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="shrink-0 truncate text-sm font-medium text-ink">
            {displayName || '(unknown)'}
          </span>
          {/* Right-side timestamp / freshness. Pending view = freshness chip
              keyed on created_at (color advances with age — actionable
              signal). Sent view = bare relative timestamp (read-only). */}
          <span className="ml-auto shrink-0 font-mono tabular-nums">
            {mode === 'sent' ? (
              <span className="font-mono text-[11px] text-ink-dim">
                <TimeAgo iso={sentTimestamp} />
              </span>
            ) : (
              <FreshnessChip iso={draft.created_at} />
            )}
          </span>
        </div>

        <div className="mt-0.5 flex min-w-0 items-center gap-2 overflow-hidden">
          {/* Category pill — saturated color per category, dark-theme tuned.
              See dashboard/lib/category-colors.ts for the map. */}
          {mode === 'pending' && m.classification ? (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${categoryPillClass(m.classification)}`}
              title={
                m.confidence != null
                  ? `${m.classification} ${Math.round(parseFloat(m.confidence) * 100)}%`
                  : m.classification
              }
            >
              {m.classification}
            </span>
          ) : dispositionLabel ? (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${dispositionPillClass(dispositionLabel)}`}
            >
              {dispositionLabel}
            </span>
          ) : null}

          <span className="min-w-0 truncate text-xs text-ink-muted">
            {m.subject || '(no subject)'}
          </span>
        </div>
      </div>
    </button>
  );
}

// Disposition (sent-view) pill class. Mirrors the action semantics:
// sent = success-green, approved = sending-orange, rejected = killed-red.
function dispositionPillClass(status: string): string {
  switch (status) {
    case 'sent':
      return 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30';
    case 'approved':
      return 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30';
    case 'rejected':
      return 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30';
    default:
      return 'bg-zinc-500/15 text-zinc-400 ring-1 ring-zinc-500/30';
  }
}
