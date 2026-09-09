/**
 * Unit tests for LinqProvider (Sendblue HTTP client) and normaliseLinqInbound.
 * Phase 9 — linq.test.ts
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { LinqProvider, normaliseLinqInbound, type LinqWebhookBody } from '../linq';
import { installMessagingMock, uninstallMessagingMock } from '../test-hooks';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const CREDS = {
  LINQ_API_KEY_ID: 'test-key-id',
  LINQ_API_SECRET_KEY: 'test-secret-key',
};

const MSG = {
  toE164: '+15555550199',
  fromE164: '+15555550100',
  body: 'hello from odesa',
};

function makeOkFetchResponse(json: unknown = {}) {
  return {
    status: 200,
    ok: true,
    json: async () => json,
    text: async () => JSON.stringify(json),
  } as unknown as Response;
}

function makeErrFetchResponse(status: number, body: string) {
  return {
    status,
    ok: false,
    json: async () => ({}),
    text: async () => body,
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// LinqProvider
// ---------------------------------------------------------------------------

describe('LinqProvider', () => {
  describe('send', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      uninstallMessagingMock();
    });

    it('should return SendSuccess from mock state without calling fetch when mock is active', async () => {
      installMessagingMock();
      const fetchSpy = vi.spyOn(global, 'fetch');
      const provider = new LinqProvider();
      const result = await provider.send(MSG);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.provider).toBe('linq');
        expect(result.providerMessageId).toMatch(/linq-mock-/);
      }
    });

    it('should return SendFailure with missing creds error when env vars are not set', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');
      const provider = new LinqProvider();
      const result = await provider.send(MSG);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('LINQ_API_KEY_ID / LINQ_API_SECRET_KEY not set');
      }
    });

    it('should return SendSuccess with providerMessageId when fetch resolves 200 with message_handle', async () => {
      vi.stubEnv('LINQ_API_KEY_ID', CREDS.LINQ_API_KEY_ID);
      vi.stubEnv('LINQ_API_SECRET_KEY', CREDS.LINQ_API_SECRET_KEY);
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
        makeOkFetchResponse({ message_handle: 'abc123' }),
      );
      const provider = new LinqProvider();
      const result = await provider.send(MSG);

      // Assert request shape
      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.sendblue.co/api/send-message');
      const headers = init.headers as Record<string, string>;
      expect(headers['sb-api-key-id']).toBe(CREDS.LINQ_API_KEY_ID);
      expect(headers['sb-api-secret-key']).toBe(CREDS.LINQ_API_SECRET_KEY);
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Accept']).toBe('application/json');
      expect(JSON.parse(init.body as string)).toEqual({
        number: MSG.toE164,
        content: MSG.body,
        from_number: MSG.fromE164,
      });

      // Assert result
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.provider).toBe('linq');
        expect(result.providerMessageId).toBe('abc123');
      }
    });

    it('should return SendFailure mentioning missing handle when 200 response has no message_handle', async () => {
      vi.stubEnv('LINQ_API_KEY_ID', CREDS.LINQ_API_KEY_ID);
      vi.stubEnv('LINQ_API_SECRET_KEY', CREDS.LINQ_API_SECRET_KEY);
      vi.spyOn(global, 'fetch').mockResolvedValue(makeOkFetchResponse({}));
      const provider = new LinqProvider();
      const result = await provider.send(MSG);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Sendblue 200 missing message_handle');
      }
    });

    it('should return SendFailure with status and body when fetch resolves 401', async () => {
      vi.stubEnv('LINQ_API_KEY_ID', CREDS.LINQ_API_KEY_ID);
      vi.stubEnv('LINQ_API_SECRET_KEY', CREDS.LINQ_API_SECRET_KEY);
      vi.spyOn(global, 'fetch').mockResolvedValue(makeErrFetchResponse(401, 'unauthorized'));
      const provider = new LinqProvider();
      const result = await provider.send(MSG);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Sendblue 401: unauthorized');
      }
    });

    it('should return SendFailure mentioning 503 when fetch resolves with 503', async () => {
      vi.stubEnv('LINQ_API_KEY_ID', CREDS.LINQ_API_KEY_ID);
      vi.stubEnv('LINQ_API_SECRET_KEY', CREDS.LINQ_API_SECRET_KEY);
      vi.spyOn(global, 'fetch').mockResolvedValue(
        makeErrFetchResponse(503, 'service unavailable'),
      );
      const provider = new LinqProvider();
      const result = await provider.send(MSG);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('503');
      }
    });

    it('should return SendFailure mentioning the thrown error message when fetch throws', async () => {
      vi.stubEnv('LINQ_API_KEY_ID', CREDS.LINQ_API_KEY_ID);
      vi.stubEnv('LINQ_API_SECRET_KEY', CREDS.LINQ_API_SECRET_KEY);
      vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const provider = new LinqProvider();
      const result = await provider.send(MSG);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('ECONNREFUSED');
        expect(result.error).toMatch(/^Sendblue fetch failed:/);
      }
    });

    it('should return SendFailure mentioning abort or timeout when fetch is aborted by AbortController', async () => {
      vi.stubEnv('LINQ_API_KEY_ID', CREDS.LINQ_API_KEY_ID);
      vi.stubEnv('LINQ_API_SECRET_KEY', CREDS.LINQ_API_SECRET_KEY);
      vi.useFakeTimers();

      // Simulate a slow fetch that the AbortController will cancel
      let rejectFetch!: (err: Error) => void;
      vi.spyOn(global, 'fetch').mockReturnValue(
        new Promise<Response>((_resolve, reject) => {
          rejectFetch = reject;
        }),
      );

      const provider = new LinqProvider();
      const sendPromise = provider.send(MSG);

      // Advance past the 10s AbortController timeout
      await vi.advanceTimersByTimeAsync(11_000);

      // Now reject the pending fetch with an abort error (simulating what the
      // runtime does when the AbortSignal fires)
      rejectFetch(new DOMException('The operation was aborted.', 'AbortError'));

      const result = await sendPromise;
      vi.useRealTimers();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        // The error must come from the fetch-throws branch
        expect(result.error).toMatch(/Sendblue fetch failed:|abort|timeout/i);
      }
    });
  });

  // -------------------------------------------------------------------------
  // sendTypingIndicator
  // -------------------------------------------------------------------------

  describe('sendTypingIndicator', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      uninstallMessagingMock();
    });

    it('should POST to URL containing send-typing-indicator with URL-encoded toE164 and send auth headers', async () => {
      vi.stubEnv('LINQ_API_KEY_ID', CREDS.LINQ_API_KEY_ID);
      vi.stubEnv('LINQ_API_SECRET_KEY', CREDS.LINQ_API_SECRET_KEY);
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({}),
        text: async () => '',
      } as unknown as Response);

      const provider = new LinqProvider();
      await provider.sendTypingIndicator(MSG.toE164);

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/send-typing-indicator?number=');
      expect(url).toContain(encodeURIComponent(MSG.toE164));
      const headers = init.headers as Record<string, string>;
      expect(headers['sb-api-key-id']).toBe(CREDS.LINQ_API_KEY_ID);
      expect(headers['sb-api-secret-key']).toBe(CREDS.LINQ_API_SECRET_KEY);
    });

    it('should swallow fetch errors without throwing when typing indicator request fails', async () => {
      vi.stubEnv('LINQ_API_KEY_ID', CREDS.LINQ_API_KEY_ID);
      vi.stubEnv('LINQ_API_SECRET_KEY', CREDS.LINQ_API_SECRET_KEY);
      vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('network error'));

      const provider = new LinqProvider();
      // Must resolve without throwing
      await expect(provider.sendTypingIndicator(MSG.toE164)).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // verifyInbound
  // -------------------------------------------------------------------------

  describe('verifyInbound', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      uninstallMessagingMock();
    });

    it('should return ok when sb-signing-secret header matches the env secret', () => {
      vi.stubEnv('LINQ_WEBHOOK_SECRET', 'my-webhook-secret');
      const provider = new LinqProvider();
      const result = provider.verifyInbound({
        url: 'http://localhost/api/messaging/inbound/linq',
        headers: { 'sb-signing-secret': 'my-webhook-secret' },
        rawBody: '',
      });
      expect(result).toEqual({ ok: true });
    });

    it('should return Signature mismatch when sb-signing-secret header does not match', () => {
      vi.stubEnv('LINQ_WEBHOOK_SECRET', 'my-webhook-secret');
      const provider = new LinqProvider();
      const result = provider.verifyInbound({
        url: 'http://localhost/api/messaging/inbound/linq',
        headers: { 'sb-signing-secret': 'wrong-secret' },
        rawBody: '',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('Signature mismatch');
      }
    });

    it('should return Missing signature when no recognized signature header is present', () => {
      const provider = new LinqProvider();
      const result = provider.verifyInbound({
        url: 'http://localhost/api/messaging/inbound/linq',
        headers: {},
        rawBody: '',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/[Mm]issing/);
      }
    });

    it('should return ok when legacy x-linq-signature header matches env secret for backward compat', () => {
      vi.stubEnv('LINQ_WEBHOOK_SECRET', 'my-webhook-secret');
      const provider = new LinqProvider();
      const result = provider.verifyInbound({
        url: 'http://localhost/api/messaging/inbound/linq',
        headers: { 'x-linq-signature': 'my-webhook-secret' },
        rawBody: '',
      });
      expect(result).toEqual({ ok: true });
    });

    it('should reject the source-known deterministic secret when no real secret or test state exists', () => {
      const provider = new LinqProvider();
      expect(provider.verifyInbound({
        url: 'http://localhost/api/messaging/inbound/linq',
        headers: { 'sb-signing-secret': 'linq-test-secret' },
        rawBody: '',
      })).toEqual({
        ok: false,
        reason: 'Linq webhook secret not configured',
      });
    });

    it('should permit the deterministic secret only under explicit messaging mock state', () => {
      installMessagingMock();
      const provider = new LinqProvider();
      expect(provider.verifyInbound({
        url: 'http://localhost/api/messaging/inbound/linq',
        headers: { 'sb-signing-secret': 'linq-test-secret' },
        rawBody: '',
      })).toEqual({ ok: true });
    });
  });
});

// ---------------------------------------------------------------------------
// normaliseLinqInbound
// ---------------------------------------------------------------------------

describe('normaliseLinqInbound', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    uninstallMessagingMock();
  });

  it('should map a valid Sendblue webhook body to an InboundMessage', () => {
    const body: LinqWebhookBody = {
      number: '+15555550101',
      from_number: '+15555550101',
      to_number: '+15555550100',
      content: '  hello world  ',
      message_handle: 'handle-xyz',
      date_sent: '2026-05-04T10:00:00Z',
      is_outbound: false,
    };
    const result = normaliseLinqInbound(body);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.fromE164).toBe('+15555550101');
      expect(result.toE164).toBe('+15555550100');
      expect(result.body).toBe('hello world');
      expect(result.providerMessageId).toBe('handle-xyz');
      expect(result.provider).toBe('linq');
      expect(result.receivedAt).toBe('2026-05-04T10:00:00Z');
    }
  });

  it('should return null when is_outbound is true (echo suppression)', () => {
    const body: LinqWebhookBody = {
      from_number: '+15555550101',
      to_number: '+15555550100',
      content: 'echo',
      is_outbound: true,
    };
    const result = normaliseLinqInbound(body);
    expect(result).toBeNull();
  });

  it('should return null when required fields are missing', () => {
    // Missing to_number and content
    const bodyMissingTo: LinqWebhookBody = { from_number: '+15555550101', content: 'hi' };
    expect(normaliseLinqInbound(bodyMissingTo)).toBeNull();

    // Missing from_number and number
    const bodyMissingFrom: LinqWebhookBody = { to_number: '+15555550100', content: 'hi' };
    expect(normaliseLinqInbound(bodyMissingFrom)).toBeNull();

    // Missing content
    const bodyMissingContent: LinqWebhookBody = {
      from_number: '+15555550101',
      to_number: '+15555550100',
    };
    expect(normaliseLinqInbound(bodyMissingContent)).toBeNull();
  });
});
