/**
 * Unit tests for src/lib/messaging/system-prompt.ts.
 *
 * The prompt is pure (branding in, string out) so we assert structural
 * invariants:
 *   - assistant name interpolation works for arbitrary org branding
 *   - default branding (no arg) renders "Odesa"
 *   - the grounding rule is present and disqualifies training data
 *   - the canonical "checking with the landlord" escalation copy
 *     remains so deterministic tests downstream of `claude-draft.ts`
 *     keep matching their fallback regex
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ASSISTANT_NAME,
  SMS_TENANT_ASSISTANT_SYSTEM_PROMPT,
  buildSmsTenantSystemPrompt,
} from '../system-prompt';

describe('buildSmsTenantSystemPrompt', () => {
  it('should interpolate the org assistant name into the opening line', () => {
    const prompt = buildSmsTenantSystemPrompt({ assistantName: 'Concierge' });
    // First line introduces the assistant by the org-chosen name.
    expect(prompt.split('\n')[0]).toBe(
      'You are Concierge, a warm, concise, factual property manager',
    );
  });

  it('should default to "Odesa" when called with no arguments', () => {
    const prompt = buildSmsTenantSystemPrompt();
    expect(prompt.split('\n')[0]).toContain('You are Odesa');
  });

  it('should default to "Odesa" via DEFAULT_ASSISTANT_NAME export', () => {
    expect(DEFAULT_ASSISTANT_NAME).toBe('Odesa');
    const prompt = buildSmsTenantSystemPrompt({
      assistantName: DEFAULT_ASSISTANT_NAME,
    });
    expect(prompt).toContain('You are Odesa');
  });

  it('should match the static export when called with default branding', () => {
    expect(buildSmsTenantSystemPrompt()).toBe(SMS_TENANT_ASSISTANT_SYSTEM_PROMPT);
  });

  it('should render different prompts for different assistant names', () => {
    const a = buildSmsTenantSystemPrompt({ assistantName: 'Astro' });
    const b = buildSmsTenantSystemPrompt({ assistantName: 'Bex' });
    expect(a).not.toBe(b);
    expect(a).toContain('Astro');
    expect(b).toContain('Bex');
    expect(a).not.toContain('Bex');
    expect(b).not.toContain('Astro');
  });

  it('should include the grounding rule', () => {
    const prompt = buildSmsTenantSystemPrompt();
    expect(prompt).toMatch(/grounding rule/i);
    expect(prompt).toMatch(/training data is NOT a source/i);
    expect(prompt).toMatch(/Do not\s+invent timelines, prices, or policies/i);
  });

  it('should keep the "checking with the landlord" escalation copy', () => {
    // Downstream `claude-draft.ts` fallback path still expects this
    // canonical phrasing for tests that pattern-match on it.
    const prompt = buildSmsTenantSystemPrompt();
    expect(prompt).toMatch(/checking with the landlord/i);
    expect(prompt).toMatch(/follow up shortly/i);
  });

  it('should keep the no-PII rule', () => {
    const prompt = buildSmsTenantSystemPrompt();
    expect(prompt).toMatch(/Never share PII/i);
  });

  it('should keep the no-rent-waiver rule', () => {
    const prompt = buildSmsTenantSystemPrompt();
    expect(prompt).toMatch(/Never approve rent reductions/i);
    expect(prompt).toMatch(/defer\s+to the landlord/i);
  });
});

describe('SMS_TENANT_ASSISTANT_SYSTEM_PROMPT (default-branded)', () => {
  it('should be a non-empty string', () => {
    expect(typeof SMS_TENANT_ASSISTANT_SYSTEM_PROMPT).toBe('string');
    expect(SMS_TENANT_ASSISTANT_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it('should default to the "Odesa" brand', () => {
    expect(SMS_TENANT_ASSISTANT_SYSTEM_PROMPT).toContain('You are Odesa');
  });
});
