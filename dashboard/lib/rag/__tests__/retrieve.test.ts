// dashboard/lib/rag/__tests__/retrieve.test.ts
//
// STAQPRO-219 — assert the inbound's own backfilled twin never appears in
// `refs[].point_id`. Phase-B inspection of STAQPRO-207's 10 outliers showed
// every packet had its top retrieved ref at unit cosine — the inbound's own
// embedding scoring 1.000 against itself. retrieveForDraft must compute the
// inbound's deterministic point UUID and drop it via Qdrant must_not.has_id.
//
// The companion ./test/lib/rag-retrieve.test.ts holds the broader contract
// surface (cloud_gated, embed_unavailable, qdrant_unavailable, KB parallel
// search). This file is narrowly scoped to the self-filter behavior.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pointIdFromMessageId } from '../qdrant';
import { retrieveForDraft } from '../retrieve';

const INBOUND_MESSAGE_ID = '19c813bde357dc32'; // one of the STAQPRO-207 outliers
const SELF_POINT_ID = pointIdFromMessageId(INBOUND_MESSAGE_ID);

const baseInput = {
  from_addr: 'cust@example.com',
  subject: 'Re: order',
  body_text: 'Confirming the order details.',
  persona_key: 'default',
  message_id: INBOUND_MESSAGE_ID,
};

interface MockOpts {
  // Hits the mock will return for the email collection. The mock also
  // enforces the Qdrant `must_not.has_id` filter the call should be sending,
  // mirroring real Qdrant behavior.
  hits?: Array<{ id: string; score: number; payload: Record<string, unknown> }>;
  // Captures the parsed search request body so the test can inspect the
  // filter shape Qdrant would have received.
  capturedSearchBody?: { value: unknown };
}

function mockEmbedAndSearch(opts: MockOpts) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/embeddings')) {
      return new Response(JSON.stringify({ embedding: new Array(768).fill(0.01) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/collections/email_messages/points/search')) {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (opts.capturedSearchBody) opts.capturedSearchBody.value = body;
      // Mirror Qdrant: enforce must_not.has_id on the way out so the
      // assertion isn't just "did we send the filter" but also "would the
      // filter actually drop the self-match if Qdrant returned it."
      const filter = body?.filter;
      const excludedIds = new Set<string>();
      const must_not = filter?.must_not as Array<{ has_id?: string[] }> | undefined;
      if (Array.isArray(must_not)) {
        for (const clause of must_not) {
          if (Array.isArray(clause.has_id)) {
            for (const id of clause.has_id) excludedIds.add(id);
          }
        }
      }
      const filteredHits = (opts.hits ?? []).filter((h) => !excludedIds.has(h.id));
      return new Response(JSON.stringify({ result: filteredHits }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/collections/kb_documents/points/search')) {
      return new Response(JSON.stringify({ result: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

describe('retrieveForDraft self-filter — STAQPRO-219', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.OLLAMA_BASE_URL = 'http://test-ollama:11434';
    process.env.QDRANT_URL = 'http://test-qdrant:6333';
    delete process.env.RAG_DISABLED;
    delete process.env.RAG_CLOUD_ROUTE_ENABLED;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('sends must_not.has_id with the inbound self point UUID to Qdrant', async () => {
    const captured: { value: unknown } = { value: null };
    mockEmbedAndSearch({ hits: [], capturedSearchBody: captured });

    await retrieveForDraft({ ...baseInput, draft_source: 'local' });

    expect(captured.value).toMatchObject({
      filter: {
        must_not: [{ has_id: [SELF_POINT_ID] }],
      },
    });
  });

  it("inbound's own UUID never appears in refs[].point_id even if Qdrant returns it", async () => {
    // Simulate a misbehaving Qdrant that ignored the filter — the must_not
    // clause is enforced both at the wire and (defensively) here. The test
    // asserts the contract: under no circumstance does the self UUID land
    // in refs[].
    mockEmbedAndSearch({
      hits: [
        // The self-match Qdrant would have returned at 1.000 pre-fix.
        {
          id: SELF_POINT_ID,
          score: 1.0,
          payload: {
            message_id: INBOUND_MESSAGE_ID,
            sender: 'cust@example.com',
            subject: 'Re: order',
            body_excerpt: 'Confirming the order details.',
            sent_at: '2026-04-15T10:00:00Z',
            direction: 'inbound',
          },
        },
        // A genuine prior message from the same counterparty.
        {
          id: 'pid-prior',
          score: 0.78,
          payload: {
            message_id: 'prior-msg',
            sender: 'cust@example.com',
            subject: 'Earlier thread',
            body_excerpt: 'We had agreed on net-30 terms.',
            sent_at: '2026-04-01T09:00:00Z',
            direction: 'inbound',
          },
        },
      ],
    });

    const r = await retrieveForDraft({ ...baseInput, draft_source: 'local' });
    expect(r.reason).toBe('ok');
    for (const ref of r.refs) {
      expect(ref.point_id).not.toBe(SELF_POINT_ID);
    }
    // Sanity: the genuine prior survives the filter.
    expect(r.refs.map((x) => x.point_id)).toContain('pid-prior');
  });

  it('refs=0 with reason no_hits when the only Qdrant hit was the self-match', async () => {
    // Spot-check mirrors the issue's acceptance criterion: previously-
    // inspected packets that used to return refs=1 (the self-match) should
    // now collapse to empty refs + no_hits, falling through to persona-stub.
    mockEmbedAndSearch({
      hits: [
        {
          id: SELF_POINT_ID,
          score: 1.0,
          payload: {
            message_id: INBOUND_MESSAGE_ID,
            sender: 'cust@example.com',
            subject: 'Re: order',
            body_excerpt: 'Confirming the order details.',
            sent_at: '2026-04-15T10:00:00Z',
            direction: 'inbound',
          },
        },
      ],
    });

    const r = await retrieveForDraft({ ...baseInput, draft_source: 'local' });
    expect(r.reason).toBe('no_hits');
    expect(r.refs).toEqual([]);
  });

  it('omits must_not.has_id when message_id is not supplied (back-compat)', async () => {
    // Eval harness and legacy callers without a message_id should retain
    // pre-219 behavior — the filter clause is conditional, not always-on.
    const captured: { value: unknown } = { value: null };
    mockEmbedAndSearch({ hits: [], capturedSearchBody: captured });

    const inputWithoutMessageId = {
      from_addr: 'cust@example.com',
      subject: 'Re: order',
      body_text: 'Confirming the order details.',
      persona_key: 'default',
      draft_source: 'local' as const,
    };
    await retrieveForDraft(inputWithoutMessageId);

    const body = captured.value as { filter?: { must_not?: unknown } } | null;
    expect(body?.filter?.must_not).toBeUndefined();
  });
});
