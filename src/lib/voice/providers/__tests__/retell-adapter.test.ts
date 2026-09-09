import crypto from 'crypto';
import { describe, expect, it } from 'vitest';

import {
  normalizeRetellToolRequest,
  parseRetellWebhookPayload,
  verifyRetellSignature,
} from '../retell-adapter';

// ---------------------------------------------------------------------------
// Deterministic signature fixtures — compute the expected HMAC in-test with a
// fixed key/body/timestamp so nothing depends on the wall clock. Mirrors
// retell-sdk Node v4.0.0 lib/webhook_auth.js: HMAC-SHA256(key, body + ms).
// ---------------------------------------------------------------------------

const API_KEY = 'key_test_webhook_badge_123';
const RAW_BODY = JSON.stringify({ event: 'call_ended', call: { call_id: 'abc' } });
const POSTSTAMP = 1_780_000_000_000; // fixed epoch ms

function sign(body: string, stamp: number, key: string): string {
  return crypto.createHmac('sha256', key).update(body + String(stamp)).digest('hex');
}

function header(body: string, stamp: number, key: string): string {
  return `v=${stamp},d=${sign(body, stamp, key)}`;
}

describe('verifyRetellSignature', () => {
  it('accepts a valid signature within the replay window', () => {
    const sig = header(RAW_BODY, POSTSTAMP, API_KEY);
    expect(verifyRetellSignature(RAW_BODY, sig, API_KEY, POSTSTAMP)).toBe(true);
  });

  it('accepts when now is within 5 minutes on either side of the poststamp', () => {
    const sig = header(RAW_BODY, POSTSTAMP, API_KEY);
    expect(verifyRetellSignature(RAW_BODY, sig, API_KEY, POSTSTAMP + 299_000)).toBe(true);
    expect(verifyRetellSignature(RAW_BODY, sig, API_KEY, POSTSTAMP - 299_000)).toBe(true);
  });

  it('rejects a wrong digest', () => {
    const sig = `v=${POSTSTAMP},d=${'0'.repeat(64)}`;
    expect(verifyRetellSignature(RAW_BODY, sig, API_KEY, POSTSTAMP)).toBe(false);
  });

  it('rejects a signature computed with a different key', () => {
    const sig = header(RAW_BODY, POSTSTAMP, 'wrong_key');
    expect(verifyRetellSignature(RAW_BODY, sig, API_KEY, POSTSTAMP)).toBe(false);
  });

  it('rejects when the raw body differs by a single byte', () => {
    const sig = header(RAW_BODY, POSTSTAMP, API_KEY);
    expect(verifyRetellSignature(RAW_BODY + ' ', sig, API_KEY, POSTSTAMP)).toBe(false);
  });

  it('rejects a poststamp older than the 5-minute window', () => {
    const sig = header(RAW_BODY, POSTSTAMP, API_KEY);
    expect(verifyRetellSignature(RAW_BODY, sig, API_KEY, POSTSTAMP + 300_001)).toBe(false);
  });

  it('rejects a poststamp too far in the future', () => {
    const sig = header(RAW_BODY, POSTSTAMP, API_KEY);
    expect(verifyRetellSignature(RAW_BODY, sig, API_KEY, POSTSTAMP - 300_001)).toBe(false);
  });

  it('rejects a null or empty header (fail closed)', () => {
    expect(verifyRetellSignature(RAW_BODY, null, API_KEY, POSTSTAMP)).toBe(false);
    expect(verifyRetellSignature(RAW_BODY, '', API_KEY, POSTSTAMP)).toBe(false);
  });

  it('rejects an empty api key (fail closed)', () => {
    const sig = header(RAW_BODY, POSTSTAMP, API_KEY);
    expect(verifyRetellSignature(RAW_BODY, sig, '', POSTSTAMP)).toBe(false);
  });

  it('rejects a malformed header that does not match v=,d=', () => {
    expect(verifyRetellSignature(RAW_BODY, 'not-a-signature', API_KEY, POSTSTAMP)).toBe(false);
    expect(verifyRetellSignature(RAW_BODY, `d=${sign(RAW_BODY, POSTSTAMP, API_KEY)}`, API_KEY, POSTSTAMP)).toBe(false);
  });

  it('REJECTS the old plain-hex(body-only) format — no v=,d= wrapper', () => {
    const oldHeader = crypto.createHmac('sha256', API_KEY).update(RAW_BODY).digest('hex');
    expect(verifyRetellSignature(RAW_BODY, oldHeader, API_KEY, POSTSTAMP)).toBe(false);
  });

  it('REJECTS a wrapped digest computed over body-only (proves body+timestamp is required)', () => {
    const bodyOnly = crypto.createHmac('sha256', API_KEY).update(RAW_BODY).digest('hex');
    const sig = `v=${POSTSTAMP},d=${bodyOnly}`;
    expect(verifyRetellSignature(RAW_BODY, sig, API_KEY, POSTSTAMP)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Webhook lifecycle parsing
// ---------------------------------------------------------------------------

const CALL_BASE = {
  call_type: 'phone_call',
  call_id: 'Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6',
  from_number: '+12137771234',
  to_number: '+12137771235',
  direction: 'inbound',
};

describe('parseRetellWebhookPayload', () => {
  it('parses call_started', () => {
    const result = parseRetellWebhookPayload({ event: 'call_started', call: CALL_BASE });
    expect(result).toEqual({
      kind: 'event',
      event: {
        event: 'call_started',
        call: {
          call_id: CALL_BASE.call_id,
          direction: 'inbound',
          from_number: CALL_BASE.from_number,
          to_number: CALL_BASE.to_number,
        },
      },
    });
  });

  it('parses call_ended and carries the transcript', () => {
    const result = parseRetellWebhookPayload({
      event: 'call_ended',
      call: { ...CALL_BASE, transcript: 'Agent: hi\nUser: hello' },
    });
    expect(result.kind).toBe('event');
    if (result.kind !== 'event') throw new Error('expected event');
    expect(result.event.event).toBe('call_ended');
    expect(result.event.call.transcript).toBe('Agent: hi\nUser: hello');
  });

  it('maps call_analyzed to internal call_ended and carries call_analysis through', () => {
    const analysis = { call_summary: 'resolved', user_sentiment: 'Neutral', call_successful: true };
    const result = parseRetellWebhookPayload({
      event: 'call_analyzed',
      call: { ...CALL_BASE, transcript: 'Agent: hi', call_analysis: analysis },
    });
    expect(result.kind).toBe('event');
    if (result.kind !== 'event') throw new Error('expected event');
    expect(result.event.event).toBe('call_ended');
    expect((result.event.call as { call_analysis?: unknown }).call_analysis).toEqual(analysis);
  });

  it('does not attach call_analysis when absent', () => {
    const result = parseRetellWebhookPayload({ event: 'call_ended', call: CALL_BASE });
    if (result.kind !== 'event') throw new Error('expected event');
    expect('call_analysis' in result.event.call).toBe(false);
  });

  it.each(['transcript_updated', 'transfer_initiated', 'chat_started', 'agent_response'])(
    'ignores recognized-but-unhandled event %s',
    (eventName) => {
      const result = parseRetellWebhookPayload({ event: eventName, call: CALL_BASE });
      expect(result).toEqual({ kind: 'ignored', eventName });
    },
  );

  it('throws on a non-object body', () => {
    expect(() => parseRetellWebhookPayload(null)).toThrow();
    expect(() => parseRetellWebhookPayload('garbage')).toThrow();
    expect(() => parseRetellWebhookPayload([{ event: 'call_started' }])).toThrow();
  });

  it('throws when event is not a string', () => {
    expect(() => parseRetellWebhookPayload({ event: 42, call: CALL_BASE })).toThrow();
    expect(() => parseRetellWebhookPayload({ call: CALL_BASE })).toThrow();
  });

  it('throws when a handled event is missing its call object', () => {
    expect(() => parseRetellWebhookPayload({ event: 'call_ended' })).toThrow();
    expect(() => parseRetellWebhookPayload({ event: 'call_started', call: 'nope' })).toThrow();
  });

  it('throws when a phone-only event is missing from_number/to_number', () => {
    const { from_number, ...noFrom } = CALL_BASE;
    void from_number;
    expect(() => parseRetellWebhookPayload({ event: 'call_started', call: noFrom })).toThrow();
    const { to_number, ...noTo } = CALL_BASE;
    void to_number;
    expect(() => parseRetellWebhookPayload({ event: 'call_ended', call: noTo })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Tool request normalization
// ---------------------------------------------------------------------------

describe('normalizeRetellToolRequest', () => {
  const ARGS = { reason: 'leak', severity: 'high' };

  it('normalizes the flat internal shape', () => {
    const result = normalizeRetellToolRequest({
      call_id: 'test-call-1',
      from_number: '+12137771234',
      to_number: '+12137771235',
      args: ARGS,
    });
    expect(result).toEqual({
      call_id: 'test-call-1',
      from_number: '+12137771234',
      to_number: '+12137771235',
      args: ARGS,
    });
  });

  it('normalizes the nested real Retell shape identically to the flat shape', () => {
    const flat = normalizeRetellToolRequest({
      call_id: 'Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6',
      from_number: '+12137771234',
      to_number: '+12137771235',
      args: ARGS,
    });
    const nested = normalizeRetellToolRequest({
      name: 'create_work_order',
      args: ARGS,
      call: {
        call_type: 'phone_call',
        call_id: 'Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6',
        from_number: '+12137771234',
        to_number: '+12137771235',
        agent_id: 'agent_x',
      },
    });
    expect(nested).toEqual(flat);
  });

  it('defaults args to {} when absent (read tools like get_rent_status send none)', () => {
    const flat = normalizeRetellToolRequest({
      call_id: 'c1',
      from_number: '+12137771234',
      to_number: '+12137771235',
    });
    expect(flat.args).toEqual({});
    const nested = normalizeRetellToolRequest({
      name: 'get_rent_status',
      call: { call_id: 'c1', from_number: '+12137771234', to_number: '+12137771235' },
    });
    expect(nested.args).toEqual({});
  });

  it('rejects a nested web_call missing from_number/to_number (phone-only)', () => {
    expect(() =>
      normalizeRetellToolRequest({
        name: 'get_rent_status',
        args: {},
        call: { call_type: 'web_call', call_id: 'web1' },
      }),
    ).toThrow();
  });

  it('rejects a flat body missing required fields', () => {
    expect(() => normalizeRetellToolRequest({ from_number: '+1', to_number: '+2' })).toThrow();
    expect(() => normalizeRetellToolRequest({ call_id: 'c', to_number: '+2' })).toThrow();
    expect(() => normalizeRetellToolRequest({ call_id: 'c', from_number: '+1' })).toThrow();
  });

  it('rejects a non-object body', () => {
    expect(() => normalizeRetellToolRequest(null)).toThrow();
    expect(() => normalizeRetellToolRequest('nope')).toThrow();
  });

  it('leaves tool_call_key undefined for the verified standard body (no id present)', () => {
    const result = normalizeRetellToolRequest({
      name: 'get_rent_status',
      args: {},
      call: { call_id: 'c1', from_number: '+12137771234', to_number: '+12137771235' },
    });
    expect(result.tool_call_key).toBeUndefined();
    expect('tool_call_key' in result).toBe(false);
  });

  it('extracts tool_call_key defensively when a payload provides one', () => {
    const result = normalizeRetellToolRequest({
      name: 'create_work_order',
      args: {},
      tool_call_id: 'tool_call_abc123',
      call: { call_id: 'c1', from_number: '+12137771234', to_number: '+12137771235' },
    });
    expect(result.tool_call_key).toBe('tool_call_abc123');
  });
});
