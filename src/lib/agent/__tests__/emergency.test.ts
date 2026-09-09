import { describe, expect, it } from 'vitest';

import { detectEmergency } from '../emergency';

describe('detectEmergency', () => {
  const positives: Array<{ utterance: string; category: string }> = [
    { utterance: 'there is a water leak in my kitchen', category: 'water_leak' },
    { utterance: 'a pipe just burst under the sink', category: 'water_leak' },
    { utterance: 'my apartment is flooding', category: 'water_leak' },
    { utterance: 'no heat in my apartment, its freezing', category: 'no_heat_winter' },
    { utterance: 'the furnace is out', category: 'no_heat_winter' },
    { utterance: 'i smell smoke in the hallway', category: 'fire_smoke' },
    { utterance: 'the smoke alarm is going off', category: 'fire_smoke' },
    { utterance: 'i smell gas, like rotten eggs', category: 'gas_smell' },
    { utterance: 'i think there is a gas leak', category: 'gas_smell' },
    { utterance: 'i am locked out of my unit', category: 'lockout' },
    { utterance: "i lost my keys, can't get in", category: 'lockout' },
    { utterance: 'sewage is backing up into the tub', category: 'sewage_backup' },
  ];

  it.each(positives)(
    'detects "$utterance" as $category',
    ({ utterance, category }) => {
      const m = detectEmergency(utterance);
      expect(m.emergency).toBe(true);
      expect(m.category).toBe(category);
      expect(m.matchedPhrase).not.toBeNull();
    },
  );

  it.each([
    'my rent balance please',
    'when is trash day',
    'i wanted to ask about parking',
    '',
    '   ',
  ])('does not flag "%s" as emergency', (utterance) => {
    const m = detectEmergency(utterance);
    expect(m.emergency).toBe(false);
    expect(m.category).toBeNull();
  });
});
