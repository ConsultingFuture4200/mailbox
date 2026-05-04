// dashboard/app/api/internal/gmail-cooldown/route.ts
//
// STAQPRO-228 — read-side gate for the Gmail per-user 429 ratchet.
//
// Pair to STAQPRO-227's gmail-ratelimit-sweeper (write side). The sweeper
// records the latest "Retry after" hint into mailbox.system_state.
// gmail_rate_limit_until; this route exposes that flag to n8n so the
// MailBOX parent workflow can short-circuit the Schedule → Gmail Get
// path while we're still in Google's probation window.
//
// Without this gate, n8n's 5-min Schedule trigger fires Gmail Get every
// cycle regardless of cooldown state, and each fresh 429 ratchets Google's
// per-user probation further out (memory: gmail_ratelimit_probation.md).
//
// GET because the n8n IF node only needs the boolean. Trivial enough to
// poll on every cycle.

import { NextResponse } from 'next/server';
import { getGmailCooldown } from '@/lib/queries-system-state';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const cooldown = await getGmailCooldown();
  return NextResponse.json({
    in_cooldown: cooldown.isActive,
    until: cooldown.until?.toISOString() ?? null,
  });
}
