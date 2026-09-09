/**
 * Unit tests for deterministic intent extraction (src/lib/voice/intents.ts).
 * Pure string-in/array-out — no Supabase, no network, no jsdom.
 */

import { describe, expect, it } from 'vitest';

import { extractIntents } from '../intents';
import type { IntentId } from '../types';

/** Flow-3 handoff utterance: three intents in one breath. */
const FLOW_3_UTTERANCE =
  'My dishwasher stopped draining yesterday. Also I paid rent through Zelle ' +
  "but it still says I'm late, and I'm out of town Friday so maintenance " +
  'can only come tomorrow morning.';

const SINK_UTTERANCE =
  'My sink is leaking, also did my rent go through, and my brother needs to pick up keys';

describe('extractIntents', () => {
  describe('single-intent utterances', () => {
    const cases: Array<[IntentId, string]> = [
      ['rent_status', 'Did my rent go through this month?'],
      ['payment_dispute', "I already paid but it says I'm late."],
      ['late_rent_response', "I can't pay until Friday, will there be a late fee?"],
      ['maintenance_request', 'My kitchen sink is clogged and not working.'],
      ['emergency_maintenance', 'There is water flooding the bathroom right now.'],
      ['access_permission', "I'm out of town, please let them in on Friday."],
      ['lockout_or_keys', 'I locked myself out of the apartment.'],
      ['callback_request', 'Can you have the owner call me back?'],
      ['lease_question', 'Are pets allowed under my lease?'],
      ['move_out', "I want to give my 30-day notice, I'm moving out."],
      ['renewal', "I'd like to renew for another year."],
      ['complaint', "This is ridiculous, I'm really frustrated with how this was handled."],
      ['neighbor_issue', 'The upstairs neighbor plays loud music all night.'],
      ['vendor_status', 'This is Mike, the job is done but I need parts for the valve.'],
      ['owner_briefing', 'Catch me up on my portfolio this week.'],
      ['document_request', 'Could you send a copy of my ledger?'],
      ['unknown_general', 'Hey, just wanted to say hi.'],
    ];

    it.each(cases)('should include %s when the utterance mentions it', (intent, utterance) => {
      expect(extractIntents(utterance)).toContain(intent);
    });
  });

  describe('multi-intent extraction', () => {
    it('should extract maintenance, dispute, and access when given the Flow-3 utterance', () => {
      const intents = extractIntents(FLOW_3_UTTERANCE);
      expect(intents).toContain('maintenance_request');
      expect(intents).toContain('payment_dispute');
      expect(intents).toContain('access_permission');
    });

    it('should extract maintenance, rent status, and access when given the sink utterance', () => {
      const intents = extractIntents(SINK_UTTERANCE);
      expect(intents).toContain('maintenance_request');
      expect(intents).toContain('rent_status');
      expect(intents).toContain('access_permission');
    });

    it('should return intents in taxonomy order when multiple match', () => {
      const intents = extractIntents(SINK_UTTERANCE);
      const rentIdx = intents.indexOf('rent_status');
      const maintIdx = intents.indexOf('maintenance_request');
      const accessIdx = intents.indexOf('access_permission');
      expect(rentIdx).toBeLessThan(maintIdx);
      expect(maintIdx).toBeLessThan(accessIdx);
    });

    it('should not duplicate an intent when several of its patterns match', () => {
      const intents = extractIntents('The sink is clogged, the drain is broken, needs repair.');
      expect(intents).toEqual(['maintenance_request']);
    });
  });

  describe('fallback and empty input', () => {
    it('should return unknown_general when non-empty text matches nothing', () => {
      expect(extractIntents('blah blah completely unrelated words')).toEqual([
        'unknown_general',
      ]);
    });

    it('should return an empty array when text is empty', () => {
      expect(extractIntents('')).toEqual([]);
    });

    it('should return an empty array when text is whitespace only', () => {
      expect(extractIntents('   \n\t ')).toEqual([]);
    });
  });

  describe('determinism', () => {
    it('should return identical output when called twice with the same input', () => {
      expect(extractIntents(FLOW_3_UTTERANCE)).toEqual(extractIntents(FLOW_3_UTTERANCE));
      expect(extractIntents(SINK_UTTERANCE)).toEqual(extractIntents(SINK_UTTERANCE));
    });
  });
});
