/**
 * Unit tests for system-prompt.ts.
 *
 * The builder is pure (string in, blocks out), so the tests assert
 * structural invariants:
 *   - first block is the static base, with cache_control attached
 *   - rules_text is rendered verbatim
 *   - facts are rendered with confidence + source + id
 *   - per-action_type instructions match the contract for the verb
 */

import { describe, expect, it } from 'vitest';

import {
  ACTION_CONTRACTS,
  WORKER_BASE_SYSTEM_PROMPT,
  buildWorkerSystemPrompt,
  flattenSystemPrompt,
  renderFactsBlock,
  renderRulebookBlock,
} from '../system-prompt';
import type { PropertyContext } from '../types';

const RULES = `Be direct.
Never waive late fees without owner approval.
Repairs above $500 must escalate when lease ends within 60 days.`;

function fixtureContext(): PropertyContext {
  return {
    property: {
      id: 'prop-1',
      organizationId: 'org-1',
      name: '1247 Castro Apartments',
      addressLine: '1247 Castro St, San Francisco, CA, 94114',
      timezone: 'America/Los_Angeles',
      rulesText: RULES,
      autonomyLevel: 0.45,
      privacyMode: 'hosted',
    },
    facts: [
      {
        id: 'fact-pete',
        factType: 'vendor_relationship',
        subjectId: 'vendor-pete',
        content: { acceptanceTrend: 'rising', last30dJobs: 4 },
        confidence: 0.85,
        source: 'observed',
        createdAt: '2026-04-20T10:00:00Z',
      },
      {
        id: 'fact-marcus',
        factType: 'tenant_pattern',
        subjectId: 'tenant-marcus',
        content: 'pays on day 5 of the month',
        confidence: 0.7,
        source: 'observed',
        createdAt: '2026-04-22T10:00:00Z',
      },
    ],
    recentTurns: [
      {
        conversationId: 'conv-1',
        channel: 'sms',
        direction: 'inbound',
        body: 'Sink is leaking',
        occurredAt: '2026-04-25T07:00:00Z',
      },
    ],
    vendors: [
      {
        id: 'vendor-pete',
        name: "Pete's Plumbing",
        category: 'plumbing',
        acceptanceRate: 0.92,
      },
    ],
    tenants: [
      {
        id: 'tenant-marcus',
        fullName: 'Marcus Lee',
        unitLabel: '2A',
        rentStatus: 'paid',
        rentAmount: 1200,
      },
    ],
    loadedAt: '2026-04-27T00:00:00Z',
  };
}

describe('buildWorkerSystemPrompt', () => {
  it('puts cache_control on the static base block by default', () => {
    const blocks = buildWorkerSystemPrompt(fixtureContext(), 'draft_sms_reply');
    expect(blocks[0].text).toBe(WORKER_BASE_SYSTEM_PROMPT);
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('omits cache_control when disabled', () => {
    const blocks = buildWorkerSystemPrompt(
      fixtureContext(),
      'draft_sms_reply',
      { withCacheControl: false },
    );
    expect(blocks[0].cache_control).toBeUndefined();
  });

  it('includes the rulebook verbatim', () => {
    const blocks = buildWorkerSystemPrompt(fixtureContext(), 'classify_intent');
    const rulebookBlock = blocks[1].text;
    // Verbatim — every line in RULES must appear
    for (const line of RULES.split('\n')) {
      expect(rulebookBlock).toContain(line);
    }
    expect(rulebookBlock).toContain('1247 Castro Apartments');
    expect(rulebookBlock).toContain('AUTONOMY_LEVEL: 0.45');
    expect(rulebookBlock).toContain('PRIVACY_MODE: hosted');
    expect(rulebookBlock).toContain('TIMEZONE: America/Los_Angeles');
  });

  it('renders facts with confidence + source + id', () => {
    const blocks = buildWorkerSystemPrompt(
      fixtureContext(),
      'dispatch_vendor',
    );
    const factsBlock = blocks[2].text;
    expect(factsBlock).toContain('vendor_relationship');
    expect(factsBlock).toContain('confidence=0.85');
    expect(factsBlock).toContain('source=observed');
    expect(factsBlock).toContain('id=fact-pete');
    expect(factsBlock).toContain('confidence=0.70');
    expect(factsBlock).toContain('id=fact-marcus');
    // JSON content rendered inline
    expect(factsBlock).toContain('acceptanceTrend');
    // String content rendered verbatim
    expect(factsBlock).toContain('pays on day 5 of the month');
  });

  it('renders the empty-facts message when no facts', () => {
    const ctx = fixtureContext();
    const blocks = buildWorkerSystemPrompt(
      { ...ctx, facts: [] },
      'classify_intent',
    );
    expect(blocks[2].text).toBe('MEMORY FACTS: (none recorded yet)');
  });

  it('attaches the per-action_type contract on the last block', () => {
    const verbs = [
      'draft_sms_reply',
      'classify_intent',
      'confirm_emergency',
      'polish_briefing',
      'dispatch_vendor',
      'update_rulebook',
    ] as const;
    for (const verb of verbs) {
      const blocks = buildWorkerSystemPrompt(fixtureContext(), verb);
      const last = blocks[blocks.length - 1];
      expect(last.text).toContain(ACTION_CONTRACTS[verb]);
      expect(last.text).toContain('NOW: 2026-04-27T00:00:00Z');
    }
  });

  it('always returns 6 blocks (base, rulebook, facts, turns, roster, task)', () => {
    const blocks = buildWorkerSystemPrompt(fixtureContext(), 'draft_sms_reply');
    expect(blocks).toHaveLength(6);
  });

  it('puts ActionProposal envelope rules in the base prompt', () => {
    expect(WORKER_BASE_SYSTEM_PROMPT).toContain('ActionProposal');
    expect(WORKER_BASE_SYSTEM_PROMPT).toContain('context_fact_ids');
    expect(WORKER_BASE_SYSTEM_PROMPT).toContain('confidence');
    // Privacy + safety baked in
    expect(WORKER_BASE_SYSTEM_PROMPT).toContain('confirm_emergency');
    expect(WORKER_BASE_SYSTEM_PROMPT).toContain('candidateVendorIds');
  });

  it('rulebook block falls back when rules_text is empty', () => {
    const ctx = fixtureContext();
    const text = renderRulebookBlock({
      ...ctx,
      property: { ...ctx.property, rulesText: '' },
    });
    expect(text).toContain('owner has not authored property rules yet');
  });

  it('renders the recent turns block oldest → newest as given', () => {
    const blocks = buildWorkerSystemPrompt(
      fixtureContext(),
      'draft_sms_reply',
    );
    const turns = blocks[3].text;
    expect(turns).toContain('Sink is leaking');
    expect(turns).toContain('inbound');
    expect(turns).toContain('sms');
  });

  it('renders the empty roster correctly', () => {
    const ctx = fixtureContext();
    const blocks = buildWorkerSystemPrompt(
      { ...ctx, vendors: [], tenants: [] },
      'draft_sms_reply',
    );
    expect(blocks[4].text).toContain('VENDORS: (none on roster)');
    expect(blocks[4].text).toContain('TENANTS: (no tenants on file');
  });

  it('renders facts block alone', () => {
    const ctx = fixtureContext();
    const text = renderFactsBlock(ctx);
    expect(text).toContain('MEMORY FACTS (2');
    expect(text).toContain('fact-pete');
  });
});

describe('flattenSystemPrompt', () => {
  it('joins blocks with --- separator', () => {
    const flat = flattenSystemPrompt([
      { type: 'text', text: 'A' },
      { type: 'text', text: 'B' },
    ]);
    expect(flat).toContain('A');
    expect(flat).toContain('B');
    expect(flat).toContain('---');
  });

  it('preserves order', () => {
    const flat = flattenSystemPrompt([
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second' },
      { type: 'text', text: 'third' },
    ]);
    const idxFirst = flat.indexOf('first');
    const idxSecond = flat.indexOf('second');
    const idxThird = flat.indexOf('third');
    expect(idxFirst).toBeLessThan(idxSecond);
    expect(idxSecond).toBeLessThan(idxThird);
  });
});
