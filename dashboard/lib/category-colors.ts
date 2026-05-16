// dashboard/lib/category-colors.ts
//
// Category → Tailwind-pill mapping for classification badges. Dark-theme
// tuned: each pill uses the saturated-500 stop with /15 background + /30
// ring + a -300 text stop so the pill stays legible on bg-bg-deep (#0a0a0a).
//
// Ported from sandbox/src/App.tsx lines 44-53 (light-mode version) on
// 2026-05-15 as part of STAQPRO-382 Phase 2a-3. The category set mirrors
// the live classification enum (dashboard/lib/classification/normalize.ts);
// unknown categories fall back to the zinc/slate "neutral" treatment.
//
// Categories that exist on the live classifier but aren't in the sandbox
// list (none today) should be added below in the same shape.

export const CATEGORY_COLORS: Record<string, string> = {
  escalate: 'bg-red-500/15 text-red-300 ring-1 ring-red-500/30',
  reorder: 'bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30',
  inquiry: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
  scheduling: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
  follow_up: 'bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30',
  internal: 'bg-slate-500/15 text-slate-300 ring-1 ring-slate-500/30',
  spam_marketing: 'bg-zinc-500/15 text-zinc-400 ring-1 ring-zinc-500/30',
  unknown: 'bg-zinc-500/15 text-zinc-400 ring-1 ring-zinc-500/30',
};

export function categoryPillClass(category: string | null | undefined): string {
  if (!category) return CATEGORY_COLORS.unknown;
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.unknown;
}
