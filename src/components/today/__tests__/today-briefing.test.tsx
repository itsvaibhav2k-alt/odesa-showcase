import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  TodayBriefing,
  type TodayBriefingProps,
} from '@/components/today/today-briefing';
import type { WatchChannel } from '@/types/today';

const channelCounts: Record<WatchChannel, number> = {
  lease: 0,
  maintenance: 1,
  rent: 2,
  inbox: 0,
  vendor: 0,
  documents: 0,
};

const baseProps: TodayBriefingProps = {
  checkedAgoLabel: '2m',
  sentence: { prefix: 'Your queue is ', italic: 'clear', suffix: '.' },
  bullets: [],
  cta: { label: 'View queue', href: '#queue' },
  secondaryLabel: null,
  changes: [],
  channelCounts,
  attentionChannel: 'rent' as const,
  portfolioCount: 2,
};

describe('TodayBriefing hierarchy', () => {
  it('keeps the owner orbit visible by default', () => {
    const { container } = render(<TodayBriefing {...baseProps} />);

    expect(container.querySelector('[data-orbit="true"]')).toBeInTheDocument();
  });

  it('hides repeated channel urgency in the VA shift briefing', () => {
    const { container } = render(
      <TodayBriefing {...baseProps} showOrbit={false} />,
    );

    expect(container.querySelector('[data-orbit="true"]')).not.toBeInTheDocument();
  });
});
