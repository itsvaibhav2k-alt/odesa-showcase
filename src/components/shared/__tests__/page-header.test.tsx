import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PageHeader } from '@/components/shared/page-header';

describe('PageHeader', () => {
  describe('rendering', () => {
    it('should render the title text', () => {
      render(<PageHeader title='Properties' />);

      expect(screen.getByText('Properties')).toBeInTheDocument();
    });

    it('should render the root as a <header> with data-slot', () => {
      const { container } = render(<PageHeader title='Settings' />);

      const root = container.firstChild as HTMLElement;
      expect(root.tagName).toBe('HEADER');
      expect(root.getAttribute('data-slot')).toBe('page-header');
    });
  });

  describe('eyebrow', () => {
    it('should render the eyebrow with .meta-label when provided', () => {
      render(<PageHeader eyebrow='Portfolio' title='Properties' />);

      const eyebrow = screen.getByText('Portfolio');
      expect(eyebrow.tagName).toBe('P');
      expect(eyebrow).toHaveClass('meta-label');
    });

    it('should not render the eyebrow when omitted', () => {
      render(<PageHeader title='Properties' />);

      expect(screen.queryByText('Portfolio')).not.toBeInTheDocument();
    });
  });

  describe('description', () => {
    it('should render the description when provided', () => {
      render(
        <PageHeader title='Properties' description='Manage your portfolio.' />,
      );

      const description = screen.getByText('Manage your portfolio.');
      expect(description.tagName).toBe('P');
      expect(description).toHaveClass('body-text-sm');
      expect(description).toHaveClass('max-w-[68ch]');
    });

    it('should not render the description when omitted', () => {
      render(<PageHeader title='Properties' />);

      expect(
        screen.queryByText('Manage your portfolio.'),
      ).not.toBeInTheDocument();
    });
  });

  describe('size', () => {
    it('should render <h1> with heading-1 font-serif-display when size is page', () => {
      render(<PageHeader title='Properties' size='page' />);

      const heading = screen.getByRole('heading', { level: 1 });
      expect(heading).toHaveTextContent('Properties');
      expect(heading).toHaveClass('heading-1');
      expect(heading).toHaveClass('font-serif-display');
    });

    it('should default size to page (renders <h1>)', () => {
      render(<PageHeader title='Properties' />);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });

    it('should render <h2> with heading-2 font-serif-display when size is section', () => {
      render(<PageHeader title='Activity' size='section' />);

      const heading = screen.getByRole('heading', { level: 2 });
      expect(heading).toHaveTextContent('Activity');
      expect(heading).toHaveClass('heading-2');
      expect(heading).toHaveClass('font-serif-display');
    });
  });

  describe('actions', () => {
    it('should render actions inside a flex wrapper when provided', () => {
      render(
        <PageHeader
          title='Properties'
          actions={<button type='button'>New</button>}
        />,
      );

      const button = screen.getByRole('button', { name: 'New' });
      expect(button).toBeInTheDocument();

      const wrapper = button.parentElement as HTMLElement;
      expect(wrapper).toHaveClass('flex');
      expect(wrapper).toHaveClass('items-center');
      expect(wrapper).toHaveClass('gap-2');
    });

    it('should switch root to a horizontal layout when actions are present', () => {
      const { container } = render(
        <PageHeader
          title='Properties'
          actions={<button type='button'>New</button>}
        />,
      );

      const root = container.firstChild as HTMLElement;
      expect(root).toHaveClass('sm:flex-row');
      expect(root).toHaveClass('sm:items-end');
      expect(root).toHaveClass('sm:justify-between');
    });

    it('should keep root as vertical column when actions are absent', () => {
      const { container } = render(<PageHeader title='Properties' />);

      const root = container.firstChild as HTMLElement;
      expect(root).toHaveClass('flex-col');
      expect(root).not.toHaveClass('sm:flex-row');
    });
  });

  describe('className', () => {
    it('should forward className onto the root <header>', () => {
      const { container } = render(
        <PageHeader title='Properties' className='custom-class' />,
      );

      const root = container.firstChild as HTMLElement;
      expect(root).toHaveClass('custom-class');
    });
  });
});
