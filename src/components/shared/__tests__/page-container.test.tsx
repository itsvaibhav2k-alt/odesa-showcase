import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PageContainer } from '../page-container';

describe('PageContainer', () => {
  describe('rendering', () => {
    it('should render children inside the container', () => {
      render(
        <PageContainer>
          <p>hello world</p>
        </PageContainer>,
      );

      expect(screen.getByText('hello world')).toBeInTheDocument();
    });

    it('should render a div with data-slot="page-container" as root', () => {
      const { container } = render(
        <PageContainer>
          <span>child</span>
        </PageContainer>,
      );

      const root = container.firstElementChild;
      expect(root).not.toBeNull();
      expect(root?.tagName).toBe('DIV');
      expect(root?.getAttribute('data-slot')).toBe('page-container');
    });
  });

  describe('width variants', () => {
    it('should apply default width when no width prop is provided', () => {
      const { container } = render(
        <PageContainer>
          <span>child</span>
        </PageContainer>,
      );

      const root = container.firstElementChild as HTMLElement;
      expect(root.className).toContain('max-w-[var(--page-width-default)]');
    });

    it('should apply narrow width when width="narrow"', () => {
      const { container } = render(
        <PageContainer width="narrow">
          <span>child</span>
        </PageContainer>,
      );

      const root = container.firstElementChild as HTMLElement;
      expect(root.className).toContain('max-w-[var(--page-width-narrow)]');
    });

    it('should apply default width when width="default"', () => {
      const { container } = render(
        <PageContainer width="default">
          <span>child</span>
        </PageContainer>,
      );

      const root = container.firstElementChild as HTMLElement;
      expect(root.className).toContain('max-w-[var(--page-width-default)]');
    });

    it('should apply wide width when width="wide"', () => {
      const { container } = render(
        <PageContainer width="wide">
          <span>child</span>
        </PageContainer>,
      );

      const root = container.firstElementChild as HTMLElement;
      expect(root.className).toContain('max-w-[var(--page-width-wide)]');
    });
  });

  describe('density variants', () => {
    it('should apply gap-6 by default (comfortable)', () => {
      const { container } = render(
        <PageContainer>
          <span>child</span>
        </PageContainer>,
      );

      const root = container.firstElementChild as HTMLElement;
      expect(root.className).toContain('gap-6');
      expect(root.className).not.toContain('gap-4');
    });

    it('should apply gap-6 when density="comfortable"', () => {
      const { container } = render(
        <PageContainer density="comfortable">
          <span>child</span>
        </PageContainer>,
      );

      const root = container.firstElementChild as HTMLElement;
      expect(root.className).toContain('gap-6');
    });

    it('should apply gap-4 when density="compact"', () => {
      const { container } = render(
        <PageContainer density="compact">
          <span>child</span>
        </PageContainer>,
      );

      const root = container.firstElementChild as HTMLElement;
      expect(root.className).toContain('gap-4');
      expect(root.className).not.toContain('gap-6');
    });
  });

  describe('layout fundamentals', () => {
    it('should always apply flex column, full width, centering, and page padding', () => {
      const { container } = render(
        <PageContainer>
          <span>child</span>
        </PageContainer>,
      );

      const root = container.firstElementChild as HTMLElement;
      expect(root.className).toContain('flex');
      expect(root.className).toContain('flex-col');
      expect(root.className).toContain('w-full');
      expect(root.className).toContain('mx-auto');
      expect(root.className).toContain('px-[var(--page-padding-x)]');
      expect(root.className).toContain('pt-[var(--page-padding-y-top)]');
      expect(root.className).toContain('pb-[var(--page-padding-y-bottom)]');
    });
  });

  describe('className forwarding', () => {
    it('should forward custom className onto the root', () => {
      const { container } = render(
        <PageContainer className="custom-class another-one">
          <span>child</span>
        </PageContainer>,
      );

      const root = container.firstElementChild as HTMLElement;
      expect(root.className).toContain('custom-class');
      expect(root.className).toContain('another-one');
    });

    it('should preserve variant classes alongside forwarded className', () => {
      const { container } = render(
        <PageContainer width="narrow" density="compact" className="custom-class">
          <span>child</span>
        </PageContainer>,
      );

      const root = container.firstElementChild as HTMLElement;
      expect(root.className).toContain('custom-class');
      expect(root.className).toContain('max-w-[var(--page-width-narrow)]');
      expect(root.className).toContain('gap-4');
    });
  });
});
