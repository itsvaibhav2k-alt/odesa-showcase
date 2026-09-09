/**
 * Content tests for RETELL_AGENT_PROMPT.
 *
 * WHY test a string: the prompt is the first line of the safety surface and
 * is copy-pasted into the Retell dashboard. These assertions pin the
 * load-bearing honesty phrases, the never-do vocabulary, and the absence of
 * the exact promises the policy layer forbids — so a well-meaning rewording
 * cannot silently reopen a hole policy.ts guards against.
 */

import { describe, expect, it } from 'vitest';

import { buildVoiceAgentPrompt, RETELL_AGENT_PROMPT } from '../agent-prompt';
import { defaultSettings } from '../settings';

const prompt = RETELL_AGENT_PROMPT;
const lower = prompt.toLowerCase();

describe('RETELL_AGENT_PROMPT', () => {
  describe('honesty rules', () => {
    it('should use ledger-honest rent wording when reporting rent', () => {
      expect(lower).toContain('the ledger currently shows');
    });

    it('should use ask-the-owner phrasing when handling callbacks', () => {
      expect(lower).toContain("i'll ask the owner to follow up");
    });

    it('should state the never-scheduled rule when discussing scheduling', () => {
      expect(lower).toMatch(/never tell a caller they are scheduled/);
    });

    it('should escalate rather than promise dispatch when handling emergencies', () => {
      expect(lower).toMatch(/never\s+promise\s+that a plumber, technician, or any responder/);
    });
  });

  describe('never-do list', () => {
    it.each([
      ['eviction'],
      ['waive'],
      ['payment plan'],
      ['legal threats'],
      ['payment'],
      ['lease'],
    ])('should forbid %s when listing hard limits', (concept) => {
      expect(lower).toContain(concept);
    });
  });

  describe('forbidden promises', () => {
    it.each([
      ["you're scheduled"],
      ['you are scheduled'],
      ['your payment cleared'],
      ['payment cleared on'],
    ])('should never contain "%s" when the agent speaks commitments', (phrase) => {
      expect(lower).not.toContain(phrase);
    });
  });

  describe('tool protocol', () => {
    const section = prompt.split('## Tool protocol')[1]!.split('\n## ')[0]!;

    it.each([
      ['lookup_tenant_by_phone'],
      ['get_rent_status'],
      ['get_lease_details'],
      ['create_work_order'],
      ['confirm_emergency'],
      ['schedule_callback'],
      ['create_followup_sms_draft'],
      ['get_owner_briefing'],
      ['get_vendor_jobs'],
      ['report_intents'],
    ])('should mention %s exactly once when listing the tool protocol', (tool) => {
      const count = section.split(tool).length - 1;
      expect(count).toBe(1);
    });

    it.each([
      ['send_sms_followup'],
      ['escalate_to_landlord'],
    ])('should omit %s from the default messaging-dark prompt and tool protocol', (tool) => {
      const messagingDarkPrompt = buildVoiceAgentPrompt(defaultSettings('prompt-test'));
      expect(messagingDarkPrompt).not.toContain(tool);
      expect(section).not.toContain(tool);
    });

    it.each([
      ['send_sms_followup'],
      ['escalate_to_landlord'],
    ])('should mention approved direct-messaging tool %s exactly once', (tool) => {
      const approvedPrompt = buildVoiceAgentPrompt(defaultSettings('prompt-test'), {
        directMessagingApproved: true,
      });
      expect(approvedPrompt.split(tool).length - 1).toBe(1);
    });

    it('should instruct following the platform decision when a tool is blocked', () => {
      expect(lower).toContain('never retry a blocked action');
    });
  });

  describe('size budget', () => {
    it('should stay under 12000 chars when serialized', () => {
      expect(prompt.length).toBeLessThan(12000);
    });
  });
});
