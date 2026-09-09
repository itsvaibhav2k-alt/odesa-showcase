import { describe, it, expect } from 'vitest';
import { deriveWatchHeadline } from '@/lib/today/watch-signals';
import type { WatchSignal } from '@/types/today';

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function signal(dotVariant: WatchSignal['dotVariant']): WatchSignal {
  return {
    channel: 'rent',
    title: 'Signal',
    meta: 'meta',
    dotVariant,
  };
}

// ---------------------------------------------------------------------
// deriveWatchHeadline — counts dot variants into a header label + tone
// ---------------------------------------------------------------------

describe('deriveWatchHeadline', () => {
  it("should report no elevated signals when no signal is amber or clay", () => {
    const result = deriveWatchHeadline([signal('green'), signal('muted')]);

    expect(result).toEqual({ label: 'No elevated signals', tone: 'green' });
  });

  it("should count attention signals when only amber signals exist", () => {
    const result = deriveWatchHeadline([signal('amber'), signal('green'), signal('muted')]);

    expect(result).toEqual({ label: '1 attention signal', tone: 'amber' });
  });

  it('should escalate to clay and count a single risk in the singular', () => {
    const result = deriveWatchHeadline([signal('clay'), signal('amber'), signal('green')]);

    expect(result).toEqual({ label: '1 elevated signal', tone: 'clay' });
  });

  it('should count multiple risks in the plural', () => {
    const result = deriveWatchHeadline([signal('clay'), signal('clay'), signal('amber')]);

    expect(result).toEqual({ label: '2 elevated signals', tone: 'clay' });
  });

  it('should treat an empty rail as having no elevated signals', () => {
    expect(deriveWatchHeadline([])).toEqual({
      label: 'No elevated signals',
      tone: 'green',
    });
  });
});
