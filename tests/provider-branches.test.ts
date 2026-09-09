/**
 * Proves BOTH branches (unconfigured / configured) of every provider's
 * env-gated code path are STILL reachable after the `tests/setup.ts` scrub —
 * i.e. the scrub makes the suite hermetic without permanently welding any
 * provider into its "off" state. A suite can always re-enable a provider
 * in-suite with `vi.stubEnv` (+ `vi.resetModules()` + dynamic import for
 * modules that capture env at load).
 *
 * Every test here is hermetic and offline: no real network, no live provider
 * calls. `afterEach` restores env + mocks so tests are order-independent.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import Anthropic from '@anthropic-ai/sdk';
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { z } from 'zod';

import { computeTwilioSignature, TwilioProvider } from '@/lib/messaging/twilio';
import { LinqProvider } from '@/lib/messaging/linq';
import {
  __setEmbeddingClient,
  embedFactContent,
} from '@/lib/agent/memory/embed';
import {
  GET as stripeWebhookGET,
  POST as stripeWebhookPOST,
} from '@/app/api/webhooks/stripe/route';
import type { VerifyInboundRequest } from '@/lib/messaging/provider';
import type { OutboundMessage } from '@/lib/messaging/types';
import {
  installMessagingMock,
  uninstallMessagingMock,
} from '@/lib/messaging/test-hooks';

// Mock the OpenAI SDK so the CONFIGURED embedding branch selects a real client
// WITHOUT a network call. `vi.mock` is file-scoped, so the Anthropic tests below
// still exercise the real SDK's synchronous constructor.
vi.mock('openai', () => ({
  default: class MockOpenAI {
    embeddings = {
      // 1536 = EMBEDDING_DIMENSIONS (embed.ts length-validates on it).
      create: async () => ({ data: [{ embedding: new Array(1536).fill(0.01) }] }),
    };
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  uninstallMessagingMock();
  __setEmbeddingClient(null);
});

// ---------------------------------------------------------------------------
// Retell — both custom tools and lifecycle webhooks use raw-body HMAC. No
// account-key bearer is embedded in a provider-held tool definition.
// ---------------------------------------------------------------------------

describe('Retell signed request auth', () => {
  const API_KEY = 'test-key';
  const raw = JSON.stringify({
    call_id: 'call_1',
    from_number: '+15550000001',
    to_number: '+15550000002',
  });
  const schema = z.object({
    call_id: z.string(),
    from_number: z.string(),
    to_number: z.string(),
  });

  function signature(body: string, key: string, stamp = Date.now()): string {
    const digest = crypto.createHmac('sha256', key).update(body + String(stamp)).digest('hex');
    return `v=${stamp},d=${digest}`;
  }

  function request(body: string, signedWith?: string, stamp?: number): NextRequest {
    const headers = new Headers({ 'content-type': 'application/json' });
    if (signedWith) headers.set('x-retell-signature', signature(body, signedWith, stamp));
    return new NextRequest('https://app.odesa.example/api/retell/tools/get_rent_status', {
      method: 'POST',
      headers,
      body,
    });
  }

  it('rejects missing key, missing signature, malformed signature, and API-key bearer alone', async () => {
    const { verifyRetellAuth } = await import('@/lib/agent/retell-auth');
    expect(verifyRetellAuth(request(raw, API_KEY)).ok).toBe(false);

    vi.stubEnv('RETELL_API_KEY', API_KEY);
    expect(verifyRetellAuth(request(raw)).ok).toBe(false);
    const bearerOnly = new NextRequest('https://app.odesa.example/api/retell/tools/get_rent_status', {
      method: 'POST',
      headers: { authorization: `Bearer ${API_KEY}` },
      body: raw,
    });
    expect(verifyRetellAuth(bearerOnly).ok).toBe(false);
  });

  it('verifies the raw body before parsing a valid custom-tool request', async () => {
    vi.stubEnv('RETELL_API_KEY', API_KEY);
    const { readToolRequest, verifyRetellAuth } = await import('@/lib/agent/retell-auth');
    const req = request(raw, API_KEY);
    expect(verifyRetellAuth(req).ok).toBe(true);
    const parsed = await readToolRequest(req, schema);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.call_id).toBe('call_1');
  });

  it('fails closed before parsing when the syntactically valid signature is wrong or expired', async () => {
    vi.stubEnv('RETELL_API_KEY', API_KEY);
    const { readToolRequest, verifyRetellAuth } = await import('@/lib/agent/retell-auth');

    const wrong = request(raw, 'wrong-key-with-enough-entropy');
    expect(verifyRetellAuth(wrong).ok).toBe(true); // structural precheck only
    const wrongResult = await readToolRequest(wrong, schema);
    expect(wrongResult.ok).toBe(false);
    if (!wrongResult.ok) expect(wrongResult.response.status).toBe(401);

    const expired = request(raw, API_KEY, Date.now() - 6 * 60 * 1000);
    const expiredResult = await readToolRequest(expired, schema);
    expect(expiredResult.ok).toBe(false);
    if (!expiredResult.ok) expect(expiredResult.response.status).toBe(401);
  });

  it('keeps lifecycle HMAC fail closed on the account API key', async () => {
    vi.stubEnv('RETELL_API_KEY', API_KEY);
    vi.stubEnv('RETELL_REQUIRE_SIGNATURE', 'true');
    const { verifyRetellWebhookAuth } = await import('@/lib/agent/retell-auth');
    const webhookBody = '{"event":"call_ended"}';

    expect(
      verifyRetellWebhookAuth(request(webhookBody, API_KEY), webhookBody).ok,
    ).toBe(true);
    expect(
      verifyRetellWebhookAuth(request(webhookBody, 'wrong-key'), webhookBody).ok,
    ).toBe(false);
    expect(verifyRetellWebhookAuth(request(webhookBody), webhookBody).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Twilio — the real secret is required unless the explicit test harness is on.
// ---------------------------------------------------------------------------

describe('Twilio webhook signature (fail closed + explicit test injection)', () => {
  const url = 'https://example.test/api/messaging/inbound/twilio';
  const params = { From: '+15551234567', To: '+15557654321', Body: 'hermetic' };
  const rawBody = new URLSearchParams(params).toString();
  // twilio.ts DEFAULT_TEST_TOKEN (module-private; value asserted by fallback).
  const FALLBACK_TOKEN = 'twilio-test-token';
  const REAL_TOKEN = 'real-twilio-secret';

  function req(signature: string): VerifyInboundRequest {
    return { url, rawBody, headers: { 'x-twilio-signature': signature } };
  }

  it('the token drives the signature: fallback vs real token differ', () => {
    const sigFallback = computeTwilioSignature(FALLBACK_TOKEN, url, params);
    const sigReal = computeTwilioSignature(REAL_TOKEN, url, params);
    expect(sigFallback).not.toBe(sigReal);
  });

  it('unconfigured: rejects the source-known deterministic test token', () => {
    const provider = new TwilioProvider();
    expect(provider.verifyInbound(req(computeTwilioSignature(FALLBACK_TOKEN, url, params)))).toEqual({
      ok: false,
      reason: 'Twilio webhook secret not configured',
    });
    expect(provider.verifyInbound(req(computeTwilioSignature(REAL_TOKEN, url, params))).ok).toBe(false);
  });

  it('explicit test state: permits the deterministic test token only while installed', () => {
    installMessagingMock();
    const provider = new TwilioProvider();
    expect(provider.verifyInbound(req(computeTwilioSignature(FALLBACK_TOKEN, url, params))).ok).toBe(true);
    expect(provider.verifyInbound(req(computeTwilioSignature(REAL_TOKEN, url, params))).ok).toBe(false);
  });

  it('configured: stubbing TWILIO_AUTH_TOKEN flips which signature verifies', () => {
    vi.stubEnv('TWILIO_AUTH_TOKEN', REAL_TOKEN);
    const provider = new TwilioProvider();
    expect(provider.verifyInbound(req(computeTwilioSignature(REAL_TOKEN, url, params))).ok).toBe(true);
    expect(provider.verifyInbound(req(computeTwilioSignature(FALLBACK_TOKEN, url, params))).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stripe billing — route.ts reads BILLING_ENABLED live (line 53). Both branches
// stay short of the Stripe client, so no key is needed and nothing hits network.
// ---------------------------------------------------------------------------

describe('Stripe billing gate (live BILLING_ENABLED read)', () => {
  type StripeReq = Parameters<typeof stripeWebhookPOST>[0];

  function postReq(): StripeReq {
    // Plain Request cast to the handler param, mirroring the route's own tests;
    // no stripe-signature header, so the guarded path returns 400 (never builds
    // a Stripe client).
    return new Request('https://x/api/webhooks/stripe', {
      method: 'POST',
      body: '{}',
    }) as unknown as StripeReq;
  }

  it('unconfigured: GET reports disabled and POST 503s before touching Stripe', async () => {
    const getRes = await stripeWebhookGET({} as StripeReq);
    expect(await getRes.json()).toEqual({ enabled: false });

    const postRes = await stripeWebhookPOST(postReq());
    expect(postRes.status).toBe(503);
  });

  it('configured: BILLING_ENABLED=true → GET reports enabled and POST passes the gate (400 missing signature, not 503)', async () => {
    vi.stubEnv('BILLING_ENABLED', 'true');
    const getRes = await stripeWebhookGET({} as StripeReq);
    expect(await getRes.json()).toEqual({ enabled: true });

    const postRes = await stripeWebhookPOST(postReq());
    expect(postRes.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// OpenAI embedding — embed.ts selects a client by OPENAI_API_KEY at call time
// (getClient, line 56); missing key → null (degraded, substring-only).
// ---------------------------------------------------------------------------

describe('OpenAI embedding selection (live OPENAI_API_KEY read)', () => {
  it('unconfigured: embedFactContent degrades to null when OPENAI_API_KEY is scrubbed', async () => {
    __setEmbeddingClient(null); // clear any client cached by a prior test
    expect(await embedFactContent('hermetic fact')).toBeNull();
  });

  it('configured: stubbing OPENAI_API_KEY selects a client and returns a 1536-dim vector (mocked SDK)', async () => {
    __setEmbeddingClient(null);
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
    const result = await embedFactContent('hermetic fact');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1536);
  });
});

// ---------------------------------------------------------------------------
// Anthropic — the client is constructed from ANTHROPIC_API_KEY at
// llm.ts:43 / hosted-haiku.ts:104. We mirror that exact construction and read
// the resolved key off the instance (no request → no network).
// ---------------------------------------------------------------------------

describe('Anthropic client construction (ANTHROPIC_API_KEY resolution)', () => {
  // `dangerouslyAllowBrowser` is needed ONLY because the vitest env is jsdom;
  // it does not affect apiKey resolution (the SDK sets
  // `this.apiKey = typeof apiKey === 'string' ? apiKey : null`).
  function construct(): Anthropic {
    return new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      dangerouslyAllowBrowser: true,
    });
  }

  it('unconfigured: constructed client has no key when ANTHROPIC_API_KEY is scrubbed', () => {
    expect(construct().apiKey).toBeNull();
  });

  it('configured: the stubbed ANTHROPIC_API_KEY is observed at construction', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    expect(construct().apiKey).toBe('sk-ant-test');
  });
});

// ---------------------------------------------------------------------------
// Linq/Sendblue — linq.ts gates the real fetch on LINQ_API_KEY_ID /
// LINQ_API_SECRET_KEY at call time (lines 81-83).
// ---------------------------------------------------------------------------

describe('Linq send credential gate (live LINQ_* read)', () => {
  const MSG: OutboundMessage = {
    toE164: '+15551234567',
    fromE164: '+15557654321',
    body: 'hermetic',
  };

  it('unconfigured: send returns the not-set error and never calls fetch', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    const result = await new LinqProvider().send(MSG);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('LINQ_API_KEY_ID / LINQ_API_SECRET_KEY not set');
    }
  });

  it('configured: stubbing LINQ creds routes send through fetch with the stubbed keys', async () => {
    vi.stubEnv('LINQ_API_KEY_ID', 'linq-key-id');
    vi.stubEnv('LINQ_API_SECRET_KEY', 'linq-secret');
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message_handle: 'linq-123' }),
      text: async () => '{"message_handle":"linq-123"}',
    } as unknown as Response);

    const result = await new LinqProvider().send(MSG);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['sb-api-key-id']).toBe('linq-key-id');
    expect(headers['sb-api-secret-key']).toBe('linq-secret');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.providerMessageId).toBe('linq-123');
    }
  });
});
