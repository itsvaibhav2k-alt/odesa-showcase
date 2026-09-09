/**
 * PhoneCard — the "24/7 answering" honesty guard (Wave 6).
 *
 * The card must NOT claim "Odesa answers 24/7" just because a number string
 * exists. That claim is gated on voice readiness (src/lib/voice/readiness.ts):
 * only a production-live line (state 4 — external evidence) may make it. Every
 * earlier state shows the honest "not answering live calls yet" setup copy,
 * derived from the SAME readiness state label.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PhoneCard } from './phone-card';

const NUMBER = '+15715550123';

describe('PhoneCard', () => {
  describe('24/7 answering claim', () => {
    it('should NOT claim 24/7 answering when readiness is unspecified (honest floor)', () => {
      render(<PhoneCard odesaPhoneNumber={NUMBER} voiceEnabled={true} />);

      const caption = screen.getByTestId('settings-phone-caption');
      expect(caption).not.toHaveTextContent('24/7');
      expect(caption).toHaveTextContent('not answering live calls yet');
    });

    it('should NOT claim 24/7 answering below production-live even with voice enabled', () => {
      render(
        <PhoneCard odesaPhoneNumber={NUMBER} voiceEnabled={true} voiceReadinessState={2} />,
      );

      expect(screen.getByTestId('settings-phone-caption')).not.toHaveTextContent('24/7');
    });

    it('should claim 24/7 answering ONLY when production-live (state 4)', () => {
      render(
        <PhoneCard odesaPhoneNumber={NUMBER} voiceEnabled={true} voiceReadinessState={4} />,
      );

      expect(screen.getByTestId('settings-phone-caption')).toHaveTextContent(
        'Odesa answers 24/7',
      );
    });
  });

  describe('no number', () => {
    it('should render no caption when the number is not provisioned', () => {
      render(<PhoneCard odesaPhoneNumber={null} voiceEnabled={null} />);

      expect(screen.queryByTestId('settings-phone-caption')).toBeNull();
      expect(screen.getByTestId('settings-phone-placeholder')).toBeInTheDocument();
    });
  });
});
