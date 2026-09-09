import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PageSection } from '@/components/shared/page-section';

describe('PageSection', () => {
  describe('rendering', () => {
    it('should render children', () => {
      render(
        <PageSection>
          <p>Body content</p>
        </PageSection>,
      );

      expect(screen.getByText('Body content')).toBeInTheDocument();
    });

    it('should render the root as a <section> with data-slot', () => {
      const { container } = render(
        <PageSection>
          <p>Body</p>
        </PageSection>,
      );

      const root = container.firstChild as HTMLElement;
      expect(root.tagName).toBe('SECTION');
      expect(root.getAttribute('data-slot')).toBe('page-section');
    });

    it('should apply flex flex-col gap-6 on the root', () => {
      const { container } = render(
        <PageSection>
          <p>Body</p>
        </PageSection>,
      );

      const root = container.firstChild as HTMLElement;
      expect(root).toHaveClass('flex');
      expect(root).toHaveClass('flex-col');
      expect(root).toHaveClass('gap-6');
    });

    it('should wrap children in a flex flex-col gap-4 body', () => {
      render(
        <PageSection>
          <p>Body content</p>
        </PageSection>,
      );

      const body = screen.getByText('Body content').parentElement as HTMLElement;
      expect(body).toHaveClass('flex');
      expect(body).toHaveClass('flex-col');
      expect(body).toHaveClass('gap-4');
    });
  });

  describe('header', () => {
    it('should render PageHeader when title is present', () => {
      render(
        <PageSection title='Activity'>
          <p>Body</p>
        </PageSection>,
      );

      const heading = screen.getByRole('heading', { level: 2 });
      expect(heading).toHaveTextContent('Activity');
      expect(heading).toHaveClass('heading-2');
      expect(heading).toHaveClass('font-serif-display');
    });

    it('should pass eyebrow, description, and actions through to PageHeader', () => {
      render(
        <PageSection
          eyebrow='Section'
          title='Activity'
          description='Recent events.'
          actions={<button type='button'>Refresh</button>}
        >
          <p>Body</p>
        </PageSection>,
      );

      expect(screen.getByText('Section')).toHaveClass('meta-label');
      expect(screen.getByText('Recent events.')).toHaveClass('body-text-sm');
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    });

    it('should omit the header when title is absent', () => {
      render(
        <PageSection eyebrow='Section' description='Lone description.'>
          <p>Body</p>
        </PageSection>,
      );

      expect(screen.queryByRole('heading')).not.toBeInTheDocument();
      expect(screen.queryByText('Section')).not.toBeInTheDocument();
      expect(screen.queryByText('Lone description.')).not.toBeInTheDocument();
    });

    it('should render only children when no header props are provided', () => {
      render(
        <PageSection>
          <p>Body content</p>
        </PageSection>,
      );

      expect(screen.queryByRole('heading')).not.toBeInTheDocument();
      expect(screen.getByText('Body content')).toBeInTheDocument();
    });
  });

  describe('className', () => {
    it('should forward className onto the root <section>', () => {
      const { container } = render(
        <PageSection className='custom-class'>
          <p>Body</p>
        </PageSection>,
      );

      const root = container.firstChild as HTMLElement;
      expect(root).toHaveClass('custom-class');
      expect(root).toHaveClass('flex');
      expect(root).toHaveClass('flex-col');
      expect(root).toHaveClass('gap-6');
    });
  });
});
