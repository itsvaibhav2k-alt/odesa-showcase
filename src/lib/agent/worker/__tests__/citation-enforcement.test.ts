import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateCitations, type ContextFact } from '../types';

// ---------------------------------------------------------------------------
// validateCitations — Phase A item 2 of the v1.8 cohesion wave
// ---------------------------------------------------------------------------
//
// The validator is intentionally heuristic — it inspects reasoning text
// for fact-shaped claims (named-entity + behavioural cue, historical
// condition, temporal anchor) and demands a non-empty `context_fact_ids`
// when one is present. False positives over-route to review (no harm);
// false negatives miss fabrications (real harm).

const NO_CONTEXT_FACTS: ReadonlyArray<ContextFact> = [];

function makeProposal(
  reasoning: string,
  contextFactIds: ReadonlyArray<string> = [],
) {
  return { reasoning, context_fact_ids: contextFactIds };
}

describe('validateCitations', () => {
  describe('happy path (no fact-shaped claim)', () => {
    it('should return ok when reasoning is generic and citations are empty', () => {
      const result = validateCitations(
        makeProposal('Acknowledging the message and routing to maintenance.'),
        NO_CONTEXT_FACTS,
      );
      expect(result.ok).toBe(true);
    });

    it('should return ok when reasoning quotes the rulebook without naming entities', () => {
      const result = validateCitations(
        makeProposal('The rulebook permits this rent grace period; I will respond accordingly.'),
        NO_CONTEXT_FACTS,
      );
      expect(result.ok).toBe(true);
    });

    it('should return ok when reasoning is empty', () => {
      const result = validateCitations(makeProposal(''), NO_CONTEXT_FACTS);
      expect(result.ok).toBe(true);
    });
  });

  describe('fact-shaped claim WITH citations', () => {
    it('should return ok for tenant-pattern claim when citations are provided', () => {
      const result = validateCitations(
        makeProposal(
          'Jessica Ramirez usually pays late, so we propose extending the grace window.',
          ['fact-1'],
        ),
        NO_CONTEXT_FACTS,
      );
      expect(result.ok).toBe(true);
    });

    it('should return ok for historical condition claim when cited', () => {
      const result = validateCitations(
        makeProposal(
          'The boiler had issues last winter; preemptively dispatching a check.',
          ['fact-boiler-1'],
        ),
        NO_CONTEXT_FACTS,
      );
      expect(result.ok).toBe(true);
    });

    it('should return ok for vendor-performance claim when cited', () => {
      const result = validateCitations(
        makeProposal(
          'Acme Plumbing is a reliable vendor for this category, dispatching them.',
          ['fact-vendor-acme'],
        ),
        NO_CONTEXT_FACTS,
      );
      expect(result.ok).toBe(true);
    });
  });

  describe('fact-shaped claim WITHOUT citations', () => {
    it('should fail for tenant-pattern claim with no citations', () => {
      const result = validateCitations(
        makeProposal(
          'Jessica Ramirez usually pays late, so we should send a firm reminder.',
        ),
        NO_CONTEXT_FACTS,
      );
      expect(result.ok).toBe(false);
      expect(result.reason).toBeTruthy();
      expect(result.reason).toMatch(/context_fact_ids/);
    });

    it('should fail for historical condition claim with no citations', () => {
      const result = validateCitations(
        makeProposal('The boiler had issues last winter; let me dispatch.'),
        NO_CONTEXT_FACTS,
      );
      expect(result.ok).toBe(false);
      expect(result.matchedClaim).toMatch(/last winter/);
    });

    it('should fail for vendor-performance claim with no citations', () => {
      const result = validateCitations(
        makeProposal(
          'Acme Plumbing is a reliable choice based on past dispatches.',
        ),
        NO_CONTEXT_FACTS,
      );
      expect(result.ok).toBe(false);
    });

    it('should fail for explicit ISO date temporal anchor', () => {
      const result = validateCitations(
        makeProposal('Per our records on 2024-03-15, this issue recurred.'),
        NO_CONTEXT_FACTS,
      );
      expect(result.ok).toBe(false);
    });

    it('should fail for "since X" temporal anchor', () => {
      const result = validateCitations(
        makeProposal('The tenant has been current since 2023.'),
        NO_CONTEXT_FACTS,
      );
      expect(result.ok).toBe(false);
    });

    it('should fail for "Month YYYY" temporal anchor', () => {
      const result = validateCitations(
        makeProposal('The lease was signed in March 2024.'),
        NO_CONTEXT_FACTS,
      );
      expect(result.ok).toBe(false);
    });
  });

  describe('false-positive guards (single-token names)', () => {
    it('should NOT flag a behavioural cue without a named entity (single-token)', () => {
      const result = validateCitations(
        makeProposal('The tenant tends to respond promptly.'),
        NO_CONTEXT_FACTS,
      );
      // No two-token capitalised name in reasoning — heuristic skips
      // tenant-pattern check. Returns ok despite a behavioural cue.
      expect(result.ok).toBe(true);
    });

    it('should NOT flag a vendor cue without a named entity', () => {
      const result = validateCitations(
        makeProposal('The vendor is reliable.'),
        NO_CONTEXT_FACTS,
      );
      expect(result.ok).toBe(true);
    });
  });

  describe('reason payload', () => {
    it('should include the matched cue in the reason', () => {
      const result = validateCitations(
        makeProposal('Jessica Ramirez usually pays late.'),
        NO_CONTEXT_FACTS,
      );
      expect(result.ok).toBe(false);
      expect(result.matchedClaim).toBe('usually pays');
    });

    it('should label temporal-anchor matches', () => {
      const result = validateCitations(
        makeProposal('Lease was signed in March 2024 with no issues since.'),
        NO_CONTEXT_FACTS,
      );
      expect(result.ok).toBe(false);
      expect(result.matchedClaim).toBe('temporal anchor');
    });
  });
});

// ---------------------------------------------------------------------------
// gateProposal × citation enforcement integration
// ---------------------------------------------------------------------------
//
// Black-box tests that the gate matrix actually flips reviewability when
// the validator says not-ok AND the action_type isn't on the safe-by-
// default list AND the feature flag is ON.

describe('gateProposal — citation enforcement', () => {
  const ORIGINAL_FLAG = process.env.ODESA_CITATION_ENFORCEMENT;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    if (ORIGINAL_FLAG === undefined) {
      delete process.env.ODESA_CITATION_ENFORCEMENT;
    } else {
      process.env.ODESA_CITATION_ENFORCEMENT = ORIGINAL_FLAG;
    }
  });

  // Re-import inside the describe so each test sees the flag value the
  // beforeEach set. Vitest's import cache hands back the same module so
  // we can read process.env.ODESA_CITATION_ENFORCEMENT live at call time.
  async function freshGate() {
    const mod = await import('../commit-gate');
    return mod;
  }

  describe('flag OFF (shadow mode)', () => {
    beforeEach(() => {
      delete process.env.ODESA_CITATION_ENFORCEMENT;
    });

    it('should NOT override outcome — only warn', async () => {
      const { gateProposal } = await freshGate();
      const decision = gateProposal(
        { action_type: 'create_property', confidence: 0.95 },
        0.95,
        'hosted',
        {
          reasoning: 'Jessica Ramirez usually pays late; sending a firm reply.',
          contextFactIds: [],
          contextFacts: [],
        },
      );
      expect(decision.outcome).toBe('auto');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toMatch(/citation-enforcement:shadow/);
    });

    it('should NOT warn when reasoning has no fact-shaped claim', async () => {
      const { gateProposal } = await freshGate();
      const decision = gateProposal(
        { action_type: 'create_property', confidence: 0.95 },
        0.95,
        'hosted',
        {
          reasoning: 'Acknowledging the message per the rulebook.',
          contextFactIds: [],
          contextFacts: [],
        },
      );
      expect(decision.outcome).toBe('auto');
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('flag ON (enforced)', () => {
    beforeEach(() => {
      process.env.ODESA_CITATION_ENFORCEMENT = 'true';
    });

    it('should force review for a fact-shaped uncited internal record', async () => {
      const { gateProposal } = await freshGate();
      const decision = gateProposal(
        { action_type: 'create_property', confidence: 0.95 },
        0.95,
        'hosted',
        {
          reasoning: 'Jessica Ramirez usually pays late; sending a firm reply.',
          contextFactIds: [],
          contextFacts: [],
        },
      );
      expect(decision.outcome).toBe('review');
      expect(decision.reason).toMatch(/citation enforcement/);
    });

    it('should leave outcome=auto when citation is provided', async () => {
      const { gateProposal } = await freshGate();
      const decision = gateProposal(
        { action_type: 'create_property', confidence: 0.95 },
        0.95,
        'hosted',
        {
          reasoning: 'Jessica Ramirez usually pays late; sending a firm reply.',
          contextFactIds: ['fact-1'],
          contextFacts: [],
        },
      );
      expect(decision.outcome).toBe('auto');
    });

    it('should leave outcome=auto when reasoning has no fact-shaped claim', async () => {
      const { gateProposal } = await freshGate();
      const decision = gateProposal(
        { action_type: 'create_property', confidence: 0.95 },
        0.95,
        'hosted',
        {
          reasoning: 'Acknowledging the rent inquiry; no payment due yet.',
          contextFactIds: [],
          contextFacts: [],
        },
      );
      expect(decision.outcome).toBe('auto');
    });

    it('should NOT override confirm_emergency (safe-by-default)', async () => {
      const { gateProposal } = await freshGate();
      const decision = gateProposal(
        { action_type: 'confirm_emergency', confidence: 0.95 },
        0.95,
        'hosted',
        {
          reasoning: 'Jessica Ramirez usually reports leaks; this matches.',
          contextFactIds: [],
          contextFacts: [],
        },
      );
      // confirm_emergency must NEVER be blocked by citation enforcement —
      // the 3am gas-leak path cannot wait for owner approval.
      expect(decision.outcome).toBe('auto');
    });

    it('should NOT change outcome when base decision is already review', async () => {
      const { gateProposal } = await freshGate();
      const decision = gateProposal(
        { action_type: 'create_property', confidence: 0.2 },
        0.95,
        'hosted',
        {
          reasoning: 'Jessica Ramirez usually pays late; sending a firm reply.',
          contextFactIds: [],
          contextFacts: [],
        },
      );
      // Confidence below 0.3 already routes to review on its own; the
      // citation enforcer doesn't double-stamp the reason.
      expect(decision.outcome).toBe('review');
      expect(decision.reason).not.toMatch(/citation enforcement/);
    });
  });

  describe('citation gate input is optional', () => {
    it('should behave identically to the legacy 3-arg call when citation is omitted', async () => {
      const { gateProposal } = await freshGate();
      const a = gateProposal(
        { action_type: 'create_property', confidence: 0.95 },
        0.95,
        'hosted',
      );
      const b = gateProposal(
        { action_type: 'create_property', confidence: 0.95 },
        0.95,
        'hosted',
      );
      expect(a).toEqual(b);
      expect(a.outcome).toBe('auto');
    });
  });
});
