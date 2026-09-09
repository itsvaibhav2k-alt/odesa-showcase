import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { AuthPanel } from '@/components/shared/auth-panel';

describe('AuthPanel', () => {
  describe('rendering', () => {
    it('should render the title text', () => {
      render(
        <AuthPanel title='Sign in'>
          <span>body</span>
        </AuthPanel>,
      );

      const heading = screen.getByRole('heading', { level: 2 });
      expect(heading).toHaveTextContent('Sign in');
    });

    it('should render the eyebrow when provided', () => {
      render(
        <AuthPanel eyebrow='Welcome back' title='Sign in'>
          <span>body</span>
        </AuthPanel>,
      );

      const eyebrow = screen.getByText('Welcome back');
      expect(eyebrow).toHaveClass('meta-label');
    });

    it('should render the description when provided', () => {
      render(
        <AuthPanel
          title='Sign in'
          description='Sign in to your Odesa workspace.'
        >
          <span>body</span>
        </AuthPanel>,
      );

      expect(
        screen.getByText('Sign in to your Odesa workspace.'),
      ).toBeInTheDocument();
    });

    it('should render children inside the body', () => {
      render(
        <AuthPanel title='Sign in'>
          <button type='button'>Continue</button>
        </AuthPanel>,
      );

      expect(
        screen.getByRole('button', { name: 'Continue' }),
      ).toBeInTheDocument();
    });
  });

  describe('footer', () => {
    it('should render footer content when provided', () => {
      render(
        <AuthPanel title='Sign in' footer={<span>New here? Sign up</span>}>
          <span>body</span>
        </AuthPanel>,
      );

      expect(screen.getByText('New here? Sign up')).toBeInTheDocument();
    });

    it('should omit the footer when not provided', () => {
      const { container } = render(
        <AuthPanel title='Sign in'>
          <span>body</span>
        </AuthPanel>,
      );

      expect(
        container.querySelector('[data-slot="card-footer"]'),
      ).toBeNull();
    });
  });

  describe('root', () => {
    it('should render the root with data-slot="auth-panel"', () => {
      const { container } = render(
        <AuthPanel title='Sign in'>
          <span>body</span>
        </AuthPanel>,
      );

      const root = container.firstChild as HTMLElement;
      expect(root.getAttribute('data-slot')).toBe('auth-panel');
    });

    it('should forward className onto the root', () => {
      const { container } = render(
        <AuthPanel title='Sign in' className='custom-class'>
          <span>body</span>
        </AuthPanel>,
      );

      const root = container.firstChild as HTMLElement;
      expect(root).toHaveClass('custom-class');
      expect(root).toHaveClass('max-w-xl');
      expect(root).toHaveClass('mx-auto');
    });
  });
});
