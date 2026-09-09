import { describe, expect, it } from 'vitest';

import {
  classifyIntent,
  isAutonomousIntent,
  isHardEscalateIntent,
} from '../whitelist';
import type { IntentId } from '../types';

describe('classifyIntent', () => {
  const cases: Array<{
    utterance: string;
    intent: IntentId;
    autonomous: boolean;
  }> = [
    // rent_balance — autonomous
    { utterance: 'what is my rent balance?', intent: 'rent_balance', autonomous: true },
    { utterance: 'how much do i owe this month', intent: 'rent_balance', autonomous: true },
    { utterance: 'when is rent due', intent: 'rent_balance', autonomous: true },
    { utterance: 'is there a late fee on my payment', intent: 'rent_balance', autonomous: true },
    { utterance: 'do i have an outstanding balance', intent: 'rent_balance', autonomous: true },

    // office_hours_and_contact — autonomous
    { utterance: 'what are your office hours', intent: 'office_hours_and_contact', autonomous: true },
    { utterance: 'when are you open this week', intent: 'office_hours_and_contact', autonomous: true },
    { utterance: 'how do i reach the landlord', intent: 'office_hours_and_contact', autonomous: true },
    { utterance: 'what is your phone number', intent: 'office_hours_and_contact', autonomous: true },
    { utterance: 'what is your email address', intent: 'office_hours_and_contact', autonomous: true },

    // emergency_detection — autonomous
    { utterance: 'there is a water leak in the kitchen', intent: 'emergency_detection', autonomous: true },
    { utterance: 'i have no heat', intent: 'emergency_detection', autonomous: true },
    { utterance: 'i smell gas', intent: 'emergency_detection', autonomous: true },
    { utterance: 'i got locked out of my apartment', intent: 'emergency_detection', autonomous: true },
    { utterance: 'there is a burst pipe', intent: 'emergency_detection', autonomous: true },
    { utterance: 'there is sewage in the bathroom', intent: 'emergency_detection', autonomous: true },
    { utterance: 'i see smoke in the hallway', intent: 'emergency_detection', autonomous: true },
    { utterance: 'flooding in the basement', intent: 'emergency_detection', autonomous: true },

    // general_callback — autonomous
    { utterance: 'have someone call me back tomorrow', intent: 'general_callback', autonomous: true },
    { utterance: 'i need to talk to the landlord', intent: 'general_callback', autonomous: true },
    { utterance: 'can i speak to someone in person', intent: 'general_callback', autonomous: true },
    { utterance: 'please call back this afternoon', intent: 'general_callback', autonomous: true },

    // maintenance_request — shadow
    { utterance: 'the dishwasher is not working', intent: 'maintenance_request', autonomous: false },
    { utterance: 'my ac is broken', intent: 'maintenance_request', autonomous: false },
    { utterance: 'the sink is clogged', intent: 'maintenance_request', autonomous: false },
    { utterance: 'my refrigerator stopped running', intent: 'maintenance_request', autonomous: false },
    { utterance: 'can you fix the stove', intent: 'maintenance_request', autonomous: false },
    { utterance: 'the air conditioning stopped working', intent: 'maintenance_request', autonomous: false },

    // lease_question — shadow
    { utterance: 'when does my lease end', intent: 'lease_question', autonomous: false },
    { utterance: 'i want to discuss renewal', intent: 'lease_question', autonomous: false },
    { utterance: 'what is the end date on my lease', intent: 'lease_question', autonomous: false },

    // payment_plan — shadow
    { utterance: "i can't pay the full amount this month", intent: 'payment_plan', autonomous: false },
    { utterance: 'can we set up a payment plan', intent: 'payment_plan', autonomous: false },
    { utterance: 'i am short on rent', intent: 'payment_plan', autonomous: false },
    { utterance: 'can we split the rent into installments', intent: 'payment_plan', autonomous: false },

    // move_out_notice — shadow
    { utterance: 'i am moving out next month', intent: 'move_out_notice', autonomous: false },
    { utterance: 'giving notice that i will be vacating', intent: 'move_out_notice', autonomous: false },
    { utterance: 'this is my move out notice', intent: 'move_out_notice', autonomous: false },

    // general_property_info — shadow
    { utterance: 'when is trash day', intent: 'general_property_info', autonomous: false },
    { utterance: 'is there a gym', intent: 'general_property_info', autonomous: false },
    { utterance: 'where is the laundry room', intent: 'general_property_info', autonomous: false },
    { utterance: 'can you tell me about parking', intent: 'general_property_info', autonomous: false },
    { utterance: 'where do we put the recycling', intent: 'general_property_info', autonomous: false },

    // eviction_discussion — escalate_always
    { utterance: 'are you going to start the eviction', intent: 'eviction_discussion', autonomous: false },
    { utterance: 'i got a notice to quit', intent: 'eviction_discussion', autonomous: false },

    // legal_threat — escalate_always
    { utterance: 'i am going to sue you', intent: 'legal_threat', autonomous: false },
    { utterance: 'my lawyer will be in touch', intent: 'legal_threat', autonomous: false },
    { utterance: 'we are taking this to court', intent: 'legal_threat', autonomous: false },

    // aggression — escalate_always
    { utterance: 'this is absolute bullshit', intent: 'aggression', autonomous: false },
    { utterance: 'i am fucking pissed', intent: 'aggression', autonomous: false },

    // unknown — no match at all
    { utterance: 'hello how are you today', intent: 'unknown', autonomous: false },
    { utterance: 'just calling to say hi', intent: 'unknown', autonomous: false },
  ];

  it.each(cases)(
    'classifies "$utterance" as $intent (autonomous=$autonomous)',
    ({ utterance, intent, autonomous }) => {
      const match = classifyIntent(utterance);
      expect(match.intent).toBe(intent);
      expect(match.autonomous).toBe(autonomous);
    },
  );

  it('returns unknown for empty input', () => {
    expect(classifyIntent('').intent).toBe('unknown');
    expect(classifyIntent('   ').intent).toBe('unknown');
  });

  it('exposes predicate helpers consistent with classification', () => {
    expect(isAutonomousIntent('rent_balance')).toBe(true);
    expect(isAutonomousIntent('maintenance_request')).toBe(false);
    expect(isHardEscalateIntent('eviction_discussion')).toBe(true);
    expect(isHardEscalateIntent('rent_balance')).toBe(false);
  });
});
