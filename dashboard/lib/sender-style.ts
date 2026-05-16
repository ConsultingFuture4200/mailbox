// dashboard/lib/sender-style.ts
//
// Per-sender presentation helpers — ported from sandbox/src/App.tsx (lines
// 87-105) on 2026-05-15 as part of STAQPRO-382 Phase 2a-3 (Gmail-feel polish).
//
// Pure functions over the from_addr string. No DB lookup, no caller-supplied
// label. If we later want operator-overridable display names + colors, that
// belongs in `mailbox.persona.statistical_markers` or a contact_map table —
// these helpers are deterministic-from-address fallbacks.

const AVATAR_PALETTE = [
  'bg-rose-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-blue-500',
  'bg-violet-500',
  'bg-pink-500',
  'bg-teal-500',
  'bg-orange-500',
] as const;

/**
 * Extract a human-readable display name from an email address.
 * "alex.morgan@example.com" → "Alex Morgan"
 * "support@example.com"      → "Support"
 * ""                         → "(unknown)"
 */
export function senderName(addr: string): string {
  if (!addr) return '(unknown)';
  const local = addr.split('@')[0];
  return local
    .split(/[._-]/)
    .filter(Boolean)
    .map((p) => p[0]?.toUpperCase() + p.slice(1))
    .join(' ');
}

/**
 * First letter of the address, upper-cased. Used as avatar text.
 */
export function senderInitial(addr: string): string {
  if (!addr) return '?';
  return addr[0].toUpperCase();
}

/**
 * Deterministic bg color from the address. djb2-style hash → palette index.
 * Same address always maps to the same color. Returns a Tailwind utility
 * (already in the JIT scan via inclusion in this file).
 */
export function senderColor(addr: string): string {
  let h = 0;
  for (let i = 0; i < addr.length; i++) {
    h = (h * 31 + addr.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}
