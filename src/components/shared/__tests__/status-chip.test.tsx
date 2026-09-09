import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { StatusChip } from '@/components/shared/status-chip';

describe('StatusChip', () => {
  describe('label', () => {
    it('should render the label text when provided', () => {
      render(<StatusChip tone='green' label='Current' />);

      expect(screen.getByText('Current')).toBeInTheDocument();
    });
  });

  describe('tone', () => {
    it('should apply the green palette vars when tone is green', () => {
      render(<StatusChip tone='green' label='Paid' />);

      const chip = screen.getByText('Paid');
      expect(chip.style.background).toBe('var(--green-bg)');
      expect(chip.style.color).toBe('var(--green-ink)');
      expect(chip.style.borderColor).toBe('var(--green-border)');
      expect(chip.getAttribute('data-status-tone')).toBe('green');
    });

    it('should apply the amber-soft background var when tone is amber-soft', () => {
      render(<StatusChip tone='amber-soft' label='Watching' />);

      const chip = screen.getByText('Watching');
      expect(chip.style.background).toBe('var(--amber-bg-soft)');
      expect(chip.style.color).toBe('var(--amber-ink)');
      expect(chip.style.borderColor).toBe('var(--amber-border)');
    });

    it('should apply the gold dot var on the aria-hidden dot when tone is neutral-gold', () => {
      const { container } = render(
        <StatusChip tone='neutral-gold' label='Renewal' />,
      );

      const dot = container.querySelector('[aria-hidden="true"]') as HTMLElement;
      expect(dot).not.toBeNull();
      expect(dot.style.background).toBe('var(--gold)');
    });
  });

  describe('size', () => {
    it('should use the list pill font size when size is omitted', () => {
      render(<StatusChip tone='clay' label='Outstanding' />);

      expect(screen.getByText('Outstanding').style.fontSize).toBe('9.5px');
    });

    it('should use the queue font size when size is queue', () => {
      render(<StatusChip tone='clay' label='Escalated' size='queue' />);

      expect(screen.getByText('Escalated').style.fontSize).toBe('10.5px');
    });
  });
});
