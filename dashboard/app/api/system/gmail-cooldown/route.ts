// dashboard/app/api/system/gmail-cooldown/route.ts
//
// STAQPRO-331 #5 — operator-facing read of the Gmail rate-limit cooldown.
// Powers the GmailCooldownBanner in the queue UI.
//
// Sibling to /api/internal/gmail-cooldown (n8n-facing): both read the same
// `mailbox.system_state.gmail_rate_limit_until` populated by the
// gmail-ratelimit-sweeper (STAQPRO-227). The internal route returns just
// the boolean gate; this one returns the full shape the operator UI needs
// (raw deadline + the recommended +1h safe-to-send timestamp + when we
// last detected the 429, so the banner can say "set 2 min ago").

import { NextResponse } from 'next/server';
import { getGmailCooldown } from '@/lib/queries-system-state';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const cooldown = await getGmailCooldown();
  return NextResponse.json({
    is_active: cooldown.isActive,
    until: cooldown.until?.toISOString() ?? null,
    set_at: cooldown.set_at?.toISOString() ?? null,
    recommended_safe_at: cooldown.recommended_safe_at?.toISOString() ?? null,
  });
}
